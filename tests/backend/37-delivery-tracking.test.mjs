import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {prepareOrderSave} from '../../assets/ordering/order-edit-save.js';

export default async function({db,check,state}){
 const h=state.harness,{api,ids,fixture,checkout,action,proof,scalar,service}=h;
 const linkA='https://share.lalamove.com/tracking?rider=first',linkB='https://tracking.grab.com/delivery/second';
 const events=id=>db.query('select * from tlb.outbox where order_id=$1 order by created_at,id',[id]).then(r=>r.rows);
 async function delivery({paid=false,dispatch=false,trackingInjection}={}){
  const {product,date}=await fixture(4),locality='QA Tracking '+randomUUID();
  await api('save_zone',{zone:{name:locality,localities:[locality],fee_cents:10000,active:true}},ids.owner);
  let order=await api('create_order',checkout(product,date,{method:'delivery',address:{line1:'123 Test Street',locality,postal_code:'1111'},...(trackingInjection===undefined?{}:{delivery_tracking_url:trackingInjection})}),ids.customer);
  if(paid)order=await action('approve_payment',await proof(order,{user_id:ids.customer}));
  if(dispatch)order=await action('set_fulfillment',order,{status:'out_for_delivery'});
  return order;
 }
 const edit=(o,url,extra={})=>action('edit_order',o,{reason:'Update courier tracking',changes:{delivery_tracking_url:url},...extra});

 await check('delivery tracking uses authorized order edits and preserves private access, prices, stock and audit snapshots',async()=>{
  const submitted=await delivery();
  const allocations=await h.allocations(submitted.id),emailCount=(await events(submitted.id)).length;
  const payload=await prepareOrderSave({order:submitted,changes:{delivery_tracking_url:linkA},idempotencyKey:randomUUID(),preview:p=>api('preview_edit_order',p,ids.staff),confirmTotalChange:()=>assert.fail('Tracking must not change an order total.')});
  const saved=await api('edit_order',payload,ids.staff);
  assert.equal(saved.delivery_tracking_url,linkA);assert.equal(saved.total_cents,submitted.total_cents);assert.equal(saved.revision,submitted.revision+1);
  assert.deepEqual(await h.allocations(submitted.id),allocations);assert.equal((await events(submitted.id)).length,emailCount);
  const audit=(await db.query("select before_data,after_data from tlb.history where order_id=$1 and action='edit_order' order by id desc limit 1",[saved.id])).rows[0];
  assert.equal(audit.before_data.delivery_tracking_url,undefined);assert.equal(audit.after_data.delivery_tracking_url,linkA);
  assert.equal((await api('get_order',{order_id:saved.id},ids.customer)).delivery_tracking_url,linkA);
  assert.equal((await api('get_order',{order_id:saved.id},null,submitted.access_token)).delivery_tracking_url,linkA);
  for(const user of [null,ids.stranger])await assert.rejects(api('get_order',{order_id:saved.id},user),/not authorized/i);
  for(const user of [null,ids.customer,ids.stranger])await assert.rejects(api('edit_order',{...payload,idempotency_key:randomUUID(),revision:saved.revision},user),/authorized|staff/i);
  assert.equal(JSON.stringify(await api('catalog')).includes(linkA),false);
  assert.equal((await api('edit_order',payload,ids.staff)).revision,saved.revision);
  await assert.rejects(api('edit_order',{...payload,idempotency_key:randomUUID()},ids.staff),/changed/);
 })();

 await check('tracking URLs reject unsafe input, pickup links and customer injection, with removal when delivery becomes pickup',async()=>{
  let order=await delivery();
  const bad=[null,true,{},'http://tracking.example.test/a','https://user:pass@example.test/a','https://example.test/\r\nInjected','https://example.test/a b','https://example.test/<tag>','https://example.test/"quote','https://example.test/\\path','https://','javascript:alert(1)','https://example.test:99999/a','https://example.test/'+ 'a'.repeat(2048)];
  for(const value of bad)await assert.rejects(edit(order,value),/tracking|HTTPS|text|characters|port/i);
  assert.equal((await h.order(order.id)).revision,order.revision);
  order=await edit(order,'HTTPS://TRACKING.EXAMPLE.TEST:443');assert.equal(order.delivery_tracking_url,'https://tracking.example.test/');
  order=await action('edit_order',order,{reason:'Customer changed to pickup',changes:{method:'pickup'}});assert.equal(order.delivery_tracking_url,undefined);
  await assert.rejects(edit(order,linkA),/delivery orders only/);
  const {product,date}=await fixture();
  const injected=await api('create_order',checkout(product,date,{delivery_tracking_url:linkA}));assert.equal(injected.delivery_tracking_url,undefined);
  const injectedDelivery=await delivery({trackingInjection:linkA});assert.equal(injectedDelivery.delivery_tracking_url,undefined);
  const injectedEmails=await events(injectedDelivery.id);assert.equal(injectedEmails.filter(e=>e.event_type==='delivery_tracking_updated').length,0);assert.equal(injectedEmails.find(e=>e.event_type==='order_submitted').payload.order.delivery_tracking_url,undefined);
  await db.query("update tlb.orders set data=data||jsonb_build_object('delivery_tracking_url',$2::text) where id=$1",[injected.id,linkA]);
  assert.equal((await api('get_order',{order_id:injected.id},null,injected.access_token)).delivery_tracking_url,undefined);
  assert.equal(await scalar("select has_function_privilege('anon','tlb.delivery_tracking_url(jsonb)','execute')"),false);
  assert.equal(await scalar("select has_function_privilege('authenticated','tlb.queue_delivery_tracking_update(uuid,jsonb)','execute')"),false);
 })();

 await check('first tracking link waits for dispatch and late additions coalesce into one unattempted dispatch email',async()=>{
  let order=await delivery({paid:true});order=await edit(order,linkA);
  assert.equal((await events(order.id)).filter(e=>e.event_type==='delivery_tracking_updated').length,0);
  order=await action('set_fulfillment',order,{status:'out_for_delivery'});
  let dispatch=(await events(order.id)).find(e=>e.event_type==='out_for_delivery');assert.equal(dispatch.payload.order.delivery_tracking_url,linkA);
  order=await edit(order,linkB);const next=(await events(order.id)).filter(e=>['out_for_delivery','delivery_tracking_updated'].includes(e.event_type));
  assert.equal(next.length,1);assert.equal(next[0].id,dispatch.id);assert.equal(next[0].payload.order.delivery_tracking_url,linkB);
  assert.equal(next[0].payload.order.proof_path,null);assert.deepEqual(next[0].payload.old_order,{delivery_tracking_url:linkA});
  const count=(await events(order.id)).length;order=await edit(order,'HTTPS://TRACKING.GRAB.COM:443/delivery/second');assert.equal((await events(order.id)).length,count);
  let late=await delivery({paid:true,dispatch:true});late=await edit(late,linkA);dispatch=(await events(late.id)).find(e=>e.event_type==='out_for_delivery');
  assert.equal(dispatch.payload.order.delivery_tracking_url,linkA);assert.equal((await events(late.id)).filter(e=>e.event_type==='delivery_tracking_updated').length,0);
 })();

 await check('replacement and removal notify before dispatch, coalesce safely, and leave attempted or sent emails immutable',async()=>{
  let order=await delivery({paid:true});order=await edit(order,linkA);order=await edit(order,linkB);
  let update=(await events(order.id)).find(e=>e.event_type==='delivery_tracking_updated');assert.ok(update);assert.equal(update.payload.order.delivery_tracking_url,linkB);
  assert.match(update.subject,/delivery tracking has been updated/);assert.match(update.event_key,new RegExp(`${order.id}:${order.revision}$`));
  const key=update.id;
  order=await edit(order,'');update=(await events(order.id)).find(e=>e.id===key);assert.equal(update.payload.order.delivery_tracking_url,'');
  // Simulate provider acceptance locally. Source payload and event key must never change.
  await db.query("update tlb.outbox set status='sent',attempts=1,first_attempt_at=now(),sent_at=now() where id=$1",[key]);
  const sent=await scalar('select payload from tlb.outbox where id=$1',[key]);
  order=await edit(order,linkA);assert.equal((await events(order.id)).filter(e=>e.event_type==='delivery_tracking_updated').length,1);
  order=await edit(order,linkB);let pending=(await events(order.id)).find(e=>e.event_type==='delivery_tracking_updated'&&e.id!==key);assert.ok(pending);
  assert.deepEqual(await scalar('select payload from tlb.outbox where id=$1',[key]),sent);
  await db.query("update tlb.outbox set attempts=1,first_attempt_at=now() where id=$1",[pending.id]);
  const attempted=await scalar('select payload from tlb.outbox where id=$1',[pending.id]);
  order=await edit(order,linkA);assert.equal((await events(order.id)).filter(e=>e.event_type==='delivery_tracking_updated').length,3);
  assert.deepEqual(await scalar('select payload from tlb.outbox where id=$1',[pending.id]),attempted);
  assert.equal((await api('get_order',{order_id:order.id},ids.customer)).delivery_tracking_url,linkA);
 })();

 await check('queued tracking follow-ups recheck active delivery before first send and retries retain frozen payloads',async()=>{
  await db.exec("update tlb.outbox set status='skipped',lease_token=null,leased_until=null where status in ('pending','sending')");
  let order=await delivery({paid:true});order=await edit(order,linkA);order=await edit(order,linkB);
  await db.query("update tlb.outbox set status='skipped' where order_id=$1 and event_type<>'delivery_tracking_updated'",[order.id]);
  const claimed=(await service('claim_emails',{limit:10})).find(e=>e.event_type==='delivery_tracking_updated'||e.payload.event_type==='delivery_tracking_updated');assert.ok(claimed);
  await action('cancel_order',order,{reason:'Rider cancelled and customer cancelled order',restore_stock:true});
  assert.equal((await service('prepare_email',{id:claimed.id,lease_token:claimed.lease_token})).skip,true);
  order=await delivery({paid:true});order=await edit(order,linkA);order=await edit(order,linkB);
  await db.query("update tlb.outbox set status='skipped' where order_id=$1 and event_type<>'delivery_tracking_updated'",[order.id]);
  const first=(await service('claim_emails',{limit:10})).find(e=>e.payload.event_type==='delivery_tracking_updated');assert.ok(first);
  const initial=await service('prepare_email',{id:first.id,lease_token:first.lease_token});
  await service('email_failed',{id:first.id,lease_token:first.lease_token,error:'Local simulated retry'});
  order=await edit(order,linkA);
  await db.query("update tlb.outbox set available_at=now()-interval '1 minute' where id=$1",[first.id]);
  const retry=(await service('claim_emails',{limit:10})).find(e=>e.id===first.id);assert.ok(retry);
  const prepared=await service('prepare_email',{id:retry.id,lease_token:retry.lease_token});
  assert.deepEqual(prepared.payload,initial.payload);assert.equal(prepared.event_key,initial.event_key);
 })();

 await check('closed or refunded deliveries stay quiet and tracking migration replays without changing orders or emails',async()=>{
  for(const state of ['completed','cancelled','refunded']){
   let order=await delivery({paid:true});order=await edit(order,linkA);
   if(state==='refunded')order=await action('set_refund_label',order,{enabled:true});
   else if(state==='cancelled')order=await action('cancel_order',order,{reason:'Local closed-order check',restore_stock:true});
   else order=await action('set_fulfillment',order,{status:'completed'});
   const count=(await events(order.id)).length;order=await edit(order,linkB);assert.equal((await events(order.id)).length,count);assert.equal(order.delivery_tracking_url,linkB);
  }
  const before=await scalar('select count(*)::int from tlb.outbox');
  const orderCount=await scalar('select count(*)::int from tlb.orders');
  await db.exec(await readFile(new URL('../../supabase/migrations/20260926041959_delivery_tracking_links.sql',import.meta.url),'utf8'));
  assert.equal(await scalar('select count(*)::int from tlb.outbox'),before);assert.equal(await scalar('select count(*)::int from tlb.orders'),orderCount);
 })();
}
