import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}){
 const h=state.harness,{product,date}=await h.fixture(20);
 const service=(action,payload={})=>h.as(null,async()=> (await db.query('select public.shop_calendar_service($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result,'service_role');
 let order=await h.api('create_order',h.checkout(product,date));
 const row=()=>h.scalar('select (select to_jsonb(e) from tlb.calendar_events e where order_id=$1)',[order.id]);
 await check('Calendar: only verified staff can see paid confirmed schedules',async()=>{
  for(const who of [null,h.ids.customer,h.ids.unverified])await assert.rejects(h.api('calendar_list',{from:date,to:date},who));
  assert.equal(await row(),null);
  order=await h.action('approve_payment',await h.proof(order));
  const report=await h.api('calendar_list',{from:date,to:date},h.ids.staff),entry=report.orders.find(o=>o.id===order.id);
  assert.equal(entry.reference,order.reference);assert.equal(entry.total_cents,order.total_cents);
  assert.equal(entry.buyer.phone,'09171234567');assert.equal(entry.date,date);
  for(const name of ['access_token','staff_notes','proof_path','payment_options','payment_reference'])assert.equal(entry[name],undefined);
  assert.deepEqual(entry.items[0].selection_labels,order.items[0].selection_labels||[]);
  await assert.rejects(h.api('calendar_list',{from:'2026-01-01',to:'2026-12-31'},h.ids.owner),/63 calendar days/i);
 })();
 await check('Calendar: configuration is owner-only and the service RPC is private',async()=>{
  for(const user_id of [null,h.ids.customer,h.ids.staff,h.ids.unverified])await assert.rejects(service('calendar_owner_access',{user_id}));
  for(const role of ['anon','authenticated'])assert.equal(await h.scalar("select has_function_privilege($1,'public.shop_calendar_service(text,jsonb)','EXECUTE')",[role]),false);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.calendar_service(text,jsonb)','EXECUTE')",[role]),false);
  const access=await service('calendar_owner_access',{user_id:h.ids.owner});assert.equal(access.allowed,true);
  await service('calendar_configuration',{configured:true,service_account_email:'calendar@fixture.iam.gserviceaccount.com'});
  await service('calendar_connect',{user_id:h.ids.owner,calendar_id:'tlb@example.test'});
  await assert.rejects(service('calendar_connect',{user_id:h.ids.owner,calendar_id:'other@example.test'}),/different calendar/i);
 })();
 await check('Calendar: worker leases, concurrent edits, retries and Google changes preserve the order',async()=>{
  const started=await service('calendar_begin'),lease={lease_token:started.lease_token};
  assert.equal((await service('calendar_begin')).busy,true);
  await assert.rejects(service('calendar_jobs',{lease_token:randomUUID()}),/lease/i);
  const before=await row();
  await db.query("update tlb.orders set fulfillment_status='preparing' where id=$1",[order.id]);
  await service('calendar_ack',{...lease,order_id:order.id,event_id:before.event_id,revision:before.revision,etag:'old'});
  const after=await row();assert.equal(after.event_id,before.event_id);assert.ok(after.revision>after.synced_revision);
  await service('calendar_fail',{...lease,order_id:order.id,event_id:after.event_id,revision:after.revision,error:'quota'});
  assert.equal((await row()).last_error,'quota');
  await h.api('calendar_sync_now',{},h.ids.staff);
  await service('calendar_ack',{...lease,order_id:order.id,event_id:after.event_id,revision:after.revision,etag:'current'});
  await service('calendar_scan',{...lease,changes:[{event_id:after.event_id,etag:'google-edited'}],next_sync:'cursor'});
  assert.ok((await row()).revision>after.revision);assert.equal((await h.order(order.id)).fulfillment_date,date);
  await service('calendar_scan',{...lease,changes:[{event_id:after.event_id,deleted:true}],next_page:'next'});
  assert.notEqual((await row()).event_id,after.event_id);
  await service('calendar_scan_reset',lease);assert.equal(await h.scalar('select sync_token from tlb.calendar_connection'),null);
  await service('calendar_finish',lease);
 })();
 await check('Calendar: completed orders remain; cancelled, refunded and deleted orders leave tombstones',async()=>{
  const id=(await row()).event_id;
  await db.query("update tlb.orders set fulfillment_status='completed' where id=$1",[order.id]);
  assert.equal((await row()).desired.status,'completed');assert.equal((await row()).event_id,id);
  await db.query('update tlb.orders set refund_label=true where id=$1',[order.id]);assert.equal((await row()).desired,null);
  await db.query("update tlb.orders set refund_label=false,fulfillment_status='cancelled' where id=$1",[order.id]);assert.equal((await row()).desired,null);
  const dependencies=(await db.query("select conrelid::regclass::text as name from pg_constraint where contype='f' and confrelid='tlb.orders'::regclass")).rows;
  for(const {name} of dependencies)await db.query(`delete from ${name} where order_id=$1`,[order.id]);
  await db.query('delete from tlb.orders where id=$1',[order.id]);assert.equal((await row()).desired,null);
 })();
 await check('Calendar: paid direct edits update date, total and flavors without another Google identity',async()=>{
  const p={source:'direct_message',method:'delivery',fulfillment_date:date,override_dates:true,override_reason:'Owner date',buyer:{name:'Direct client'},items:[{name:'Custom cake',description:'Chocolate',quantity:1,unit_price_cents:10000}],discount:{kind:'none'},delivery_cents:1200,email_notifications:false};
  let q=await h.api('pos_quote',p,h.ids.owner);
  order=await h.api('pos_create_order',{...p,expected_quote:q,idempotency_key:randomUUID(),payment:{method:'gcash',amount_cents:q.total_cents,received_cents:q.total_cents}},h.ids.owner);
  const first=await row();assert.equal(first.desired.total_cents,11200);
  const edit={...p,order_id:order.id,revision:order.revision,fulfillment_date:await h.day(42),items:[{...p.items[0],quantity:2}]};q=await h.api('pos_preview_edit',edit,h.ids.owner);
  order=await h.api('pos_update_order',{...edit,expected_quote:q,idempotency_key:randomUUID()},h.ids.owner);
  const changed=await row();assert.equal(changed.event_id,first.event_id);assert.equal(changed.desired.date,edit.fulfillment_date);assert.equal(changed.desired.total_cents,21200);
  assert.equal(changed.desired.items[0].description,'Chocolate');
  assert.equal(await h.scalar("select tlb.calendar_order(jsonb_populate_record(null::tlb.orders,to_jsonb(o)||jsonb_build_object('source','popup'))) from tlb.orders o where id=$1",[order.id]),null,'In-person counter sales are excluded');
  assert.equal(await h.scalar("select count(*)::int from tlb.calendar_events e join tlb.orders o on o.id=e.order_id where o.source='popup' and e.desired is not null"),0);
 })();
}
