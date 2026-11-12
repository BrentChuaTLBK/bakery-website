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
  const dependencies=(await db.query("select c.conrelid::regclass::text as name,quote_ident(a.attname) as column_name from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] where c.contype='f' and c.confrelid='tlb.orders'::regclass")).rows;
  for(const {name,column_name} of dependencies)await db.query(`delete from ${name} where ${column_name}=$1`,[order.id]);
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
 await check('Private direct order email is token-bound, write-once, and enables later updates',async()=>{
  const payload = { source:'direct_message', method:'pickup', fulfillment_date:date, override_dates:true,
   buyer:{ name:'Direct pickup', email:'' }, instructions:'Blue ribbon\nCall on pickup',
   items:[{ name:'Custom order', quantity:1, unit_price_cents:10000 }], discount:{ kind:'none' }, email_notifications:false };
  const expected = await h.api('pos_quote',payload,h.ids.owner);
  order = await h.api('pos_create_order',{ ...payload, expected_quote:expected,idempotency_key:randomUUID(),
   payment:{ method:'gcash',amount_cents:10000,received_cents:10000 } },h.ids.owner);
  const request = { order_id:order.id,email:' PickUp@Example.test ' };
  for (const token of [null, '0'.repeat(64)]) {
   await assert.rejects(h.api('add_order_email',request,h.ids.owner,token),/access/i);
  }
  await assert.rejects(h.api('add_order_email',{...request,email:'invalid'},null,order.access_token),/valid email/i);
  assert.deepEqual(await h.api('add_order_email',request,null,order.access_token),
   {email:'pickup@example.test',email_notifications:true});
  const after = await h.order(order.id);
  assert.equal(after.buyer.email,'pickup@example.test');
  assert.equal(after.email_notifications,true);
  assert.equal(after.revision,order.revision+1);
  assert.equal(after.instructions,payload.instructions);
  await h.api('add_order_email',request,null,order.access_token);
  assert.equal((await h.order(order.id)).revision,after.revision,'Retry does not create another revision');
  await assert.rejects(h.api('add_order_email',{...request,email:'else@example.test'},null,order.access_token),/already/i);
  await db.query("select tlb.queue_email($1,'ready_for_pickup',$2)",[order.id,'order-email-test:'+order.id]);
  assert.equal(await h.scalar("select to_email from tlb.outbox where event_key=$1",['order-email-test:'+order.id]),'pickup@example.test');
  const entry = (await h.api('calendar_list',{from:date,to:date},h.ids.staff)).orders.find(value=>value.id===order.id);
  assert.equal(entry.instructions,payload.instructions);
 })();
 await check('Order photos are staff-managed, album-only, and revoked after the last removal',async()=>{
  const scope = { order_id:order.id, user_id:h.ids.staff };
  await assert.rejects(h.service('order_photo_list',{ ...scope,user_id:h.ids.customer }),/access/i);
  const photoId = randomUUID(), path = `${order.id}/${photoId}.png`, hash = 'b'.repeat(64);
  const photo = { ...scope,photo_id:photoId,storage_path:path,sha256:hash,mime_type:'image/png',filename:'reference.png' };
  await assert.rejects(h.service('order_photo_attach',photo),/missing/i);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('order-photos',$1,'{}')",[path]);
  assert.equal((await h.service('order_photo_attach',photo)).accepted,true);
  assert.equal((await h.service('order_photo_attach',{...photo,photo_id:randomUUID(),storage_path:'retry'})).id,photoId);
  assert.equal((await h.service('order_photo_list',scope)).length,1);
  const event = await row(), token = event.desired.photo_share;
  assert.match(token,/^[0-9a-f]{64}$/);
  assert.equal(event.desired.photo_count,1);
  assert.notEqual(token,order.access_token);
  assert.deepEqual(await h.service('order_photo_shared',{token}),[{id:photoId,storage_path:path}]);
  assert.deepEqual(await h.service('order_photo_shared',{token:order.access_token}),[]);
  const publicOrder = await h.api('get_order',{order_id:order.id},null,order.access_token);
  assert.doesNotMatch(JSON.stringify(publicOrder),/photo_share|reference\.png|order_photo_added/);
  const calendar = (await h.api('calendar_list',{from:date,to:date},h.ids.staff)).orders.find(value=>value.id===order.id);
  assert.equal(calendar.photo_count,1);
  assert.equal(calendar.photo_share,undefined);
  assert.equal(await h.scalar("select public from storage.buckets where id='order-photos'"),false);
  for (const role of ['anon','authenticated','service_role']) {
   assert.equal(await h.scalar("select has_table_privilege($1,'tlb.order_photos','select')",[role]),false);
   assert.equal(await h.scalar("select has_function_privilege($1,'tlb.shared_order_photos(text)','execute')",[role]),false);
  }
  assert.equal((await h.service('order_photo_detach',{...scope,photo_id:photoId})).storage_path,path);
  assert.deepEqual(await h.service('order_photo_shared',{token}),[]);
  assert.equal((await row()).desired.photo_count,0);
  assert.equal((await row()).desired.photo_share,undefined);
 })();
}
