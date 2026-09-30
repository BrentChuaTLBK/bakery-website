import assert from 'node:assert/strict';
import {makeHarness} from './helpers.mjs';
export default async function({db,check,state}){
 const h=await makeHarness(db),{api,ids,scalar}=h;let revision=1;
 const initial=await api('admin_bootstrap',{},ids.owner);await api('save_settings',{settings:{...initial.settings,paused:false,pickup_address:'QA test address',payment_instructions:'QA fixture instructions',owner_email:'owner@example.test',contact_email:'owner@example.test',site_url:'https://example.test'}},ids.owner);
 const settings={mode:'off',announce:false,pause_uploads:true,message:'Planned website improvements.',starts_at:null,ends_at:null};
 const save=async changes=>{const r=await api('save_maintenance',{revision,settings:{...settings,...changes}},ids.owner);revision=r.revision;return r;};
 await check('maintenance is off by default, public status is safe and only owners may edit it',async()=>{
  assert.equal((await api('site_status')).active,false);
  assert(!JSON.stringify(await api('site_status')).includes('created_by'));
  for(const user of [null,ids.customer,ids.staff])await assert.rejects(api('maintenance_admin',{},user),/owner|authorized/i);
  for(const role of ['anon','authenticated','service_role'])for(const table of ['website_maintenance','maintenance_windows'])assert.equal(await scalar('select has_table_privilege($1,$2,\'select,insert,update,delete\')',[role,'tlb.'+table]),false);
  await assert.rejects(api('save_maintenance',{revision:0,settings},ids.owner),/changed/i);
  await assert.rejects(save({mode:'scheduled'}),/start.*future end/i);
  await assert.rejects(save({announce:true}),/planned start/i);
 })();
 await check('manual maintenance blocks new orders and both upload stages but keeps existing orders and idempotent retries accessible',async()=>{
  const f=await h.fixture(),payload=h.checkout(f.product,f.date),order=await api('create_order',payload,ids.customer);
  assert.equal((await save({mode:'manual'})).status.active,true,'Saving manual mode returns its active state immediately');assert.equal((await api('site_status')).uploads_paused,true);
  await assert.rejects(api('quote',payload,ids.customer),/maintenance/i);
  await assert.rejects(api('create_order',{...payload,idempotency_key:crypto.randomUUID()},ids.customer),/maintenance/i);
  assert.equal((await api('create_order',payload,ids.customer)).id,order.id);
  assert.equal((await h.order(order.id)).uploads_paused,true);
  await assert.rejects(h.service('authorize_upload',{kind:'proof',order_id:order.id,user_id:ids.customer}),/paused.*maintenance/i);
  await assert.rejects(h.proof(order),/paused.*maintenance/i);
  const windows=await scalar('select count(*)::int from tlb.maintenance_windows');
  await save({mode:'manual',message:'Updated announcement'});assert.equal(await scalar('select count(*)::int from tlb.maintenance_windows'),windows,'Copy changes do not restart the clock');
  await save({mode:'manual',pause_uploads:false});assert.equal((await api('site_status')).uploads_paused,false);
  await h.proof(order);assert.equal((await h.order(order.id)).payment_status,'under_review');
  await save({mode:'off'});
 })();
 await check('scheduled maintenance and its announcement follow exact start/end times without cron',async()=>{
  const start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString();
  await save({mode:'scheduled',announce:true,starts_at:start,ends_at:end});
  let status=await api('site_status');assert.equal(status.active,false);assert.equal(status.announce,true);
  status=await scalar('select tlb.maintenance_state($1::timestamptz)',[start]);assert.equal(status.active,true);assert.equal(status.uploads_paused,true);
  status=await scalar('select tlb.maintenance_state($1::timestamptz)',[end]);assert.equal(status.active,false);assert.equal(status.announce,false);
  await save({mode:'off'});assert.equal((await scalar('select tlb.maintenance_state($1::timestamptz)',[start])).active,false,'Cancelled future windows do not activate');
 })();
 await check('staff can create direct orders during closure; deferred delivery proofs pause and resume without inventing a deadline',async()=>{
  await save({mode:'manual'});
  const payload={source:'direct_message',method:'delivery',fulfillment_date:await h.day(30),delivery_fee_pending:true,override_dates:true,items:[{name:'QA custom cake',quantity:1,unit_price_cents:10000}],buyer:{},email_notifications:false,payment:{method:'gcash',amount_cents:10000,received_cents:10000}};
  const quote=await api('pos_quote',payload,ids.owner);
  let order=await api('pos_create_order',{...payload,expected_quote:quote,idempotency_key:crypto.randomUUID()},ids.owner);
  order=await h.action('pos_delivery_fee',order,{amount_cents:1200});
  assert.equal(order.uploads_paused,true);assert.equal(order.payment_deadline,null);assert.equal(order.payment_seconds_remaining,null);
  const proof={order_id:order.id,token:order.access_token,user_id:null,payment_stage:'delivery',delivery_fee_cents:1200,path:order.id+'/'+crypto.randomUUID()+'.webp'};
  await assert.rejects(h.service('authorize_upload',{...proof,kind:'proof'}),/paused.*maintenance/i);
  await assert.rejects(h.service('commit_proof',proof),/paused.*maintenance/i);
  await save({mode:'off'});
  assert.equal((await h.service('authorize_upload',{...proof,kind:'proof'})).allowed,true);
  order=await h.service('commit_proof',proof);assert.equal(order.payment_status,'paid');assert.equal(order.delivery_payment_status,'under_review');
 })();
 await check('ending maintenance preserves the independent shop pause setting',async()=>{
  await save({mode:'manual',pause_uploads:false});
  await db.exec("update tlb.settings set data=data||'{\"paused\":true}'::jsonb where id");
  await save({mode:'off'});
  const f=await h.fixture();assert.equal((await api('site_status')).active,false);
  await assert.rejects(api('quote',h.checkout(f.product,f.date)),/Ordering setup is in progress/i);
  await db.exec("update tlb.settings set data=data||'{\"paused\":false}'::jsonb where id");
 })();
 await check('an eight-minute payment remainder survives a long upload pause and is accepted after reopening',async()=>{
  const f=await h.fixture(),order=await api('create_order',h.checkout(f.product,f.date),ids.customer);
  await db.query("update tlb.orders set created_at=statement_timestamp()-interval '27 minutes',payment_deadline=statement_timestamp()-interval '12 minutes' where id=$1",[order.id]);
  await db.query("insert into tlb.maintenance_windows(starts_at,pause_uploads,created_by) values(statement_timestamp()-interval '20 minutes',true,$1)",[ids.owner]);
  let current=await h.order(order.id);assert.equal(current.fulfillment_status,'pending_confirmation');assert.equal(current.uploads_paused,true);assert(Math.abs(current.payment_seconds_remaining-480)<=2);
  await h.service('maintenance');assert.equal((await h.order(order.id)).fulfillment_status,'pending_confirmation');
  await db.exec('update tlb.maintenance_windows set ends_at=statement_timestamp() where ends_at is null');
  current=await h.order(order.id);assert.equal(current.uploads_paused,false);assert(Math.abs((Date.parse(current.payment_deadline)-Date.now())/1000-480)<=2);
  await h.proof(order);assert.equal((await h.order(order.id)).payment_status,'under_review');
 })();
 await check('payment-clock math combines pauses once and never revives an already-expired deadline',async()=>{
  await db.query("insert into tlb.maintenance_windows(starts_at,ends_at,pause_uploads,created_by) values ('2020-01-01T10:07Z','2020-01-01T11:00Z',true,$1),('2020-01-01T10:30Z','2020-01-01T11:00Z',true,$1),('2020-01-01T11:03Z','2020-01-01T11:30Z',true,$1)",[ids.owner]);
  const calc=async deadline=>new Date(await scalar("select tlb.maintenance_deadline($1,'2020-01-01T10:00Z','2020-01-01T12:00Z')",[deadline])).toISOString();
  assert.equal(await calc('2020-01-01T10:15Z'),'2020-01-01T11:35:00.000Z');
  assert.equal(await calc('2020-01-01T10:05Z'),'2020-01-01T10:05:00.000Z');
  await db.exec('delete from tlb.maintenance_windows');
  const f=await h.fixture(),late=await api('create_order',h.checkout(f.product,f.date),ids.customer);
  await db.query("update tlb.orders set created_at=statement_timestamp()-interval '5 minutes',payment_deadline=statement_timestamp()-interval '1 minute' where id=$1",[late.id]);
  await save({mode:'manual'});assert.equal((await h.order(late.id)).fulfillment_status,'expired');await save({mode:'off'});
 })();
}
