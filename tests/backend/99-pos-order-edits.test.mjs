import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {buildAnalytics} from '../../assets/ordering/analytics.js';

export default async function({db,check,state}){
 const h=state.harness,date=await h.day(40),next=await h.day(41),today=await h.day(0);
 const product=await h.product({price_cents:10000}),custom={name:'Custom cake',description:'Made to order',quantity:1,unit_price_cents:5000};
 await h.inventory(product,date,6);await h.inventory(product,next,5);
 const base={source:'direct_message',method:'pickup',fulfillment_date:date,override_dates:true,override_reason:'Owner arranged date',buyer:{},items:[h.item(product,3),custom],discount:{kind:'none'},email_notifications:false};
 const create=async(p=base)=>{const expected_quote=await h.api('pos_quote',p,h.ids.owner);return h.api('pos_create_order',{...p,expected_quote,idempotency_key:randomUUID()},h.ids.owner)};
 const request=(o,extra={})=>({...base,order_id:o.id,revision:o.revision,...extra});
 const edit=async(o,extra={})=>{const p=request(o,extra),expected_quote=await h.api('pos_preview_edit',p,h.ids.owner);return h.api('pos_update_order',{...p,expected_quote,idempotency_key:randomUUID()},h.ids.owner)};
 const pay=(n,method='gcash',received=n)=>({method,amount_cents:n,received_cents:received});
 let order=await create(),paid;
 await check('Direct edits: preview excludes the existing stock reservation and makes no changes',async()=>{
  await create({...base,items:[h.item(product,2)]});
  const q=await h.api('pos_preview_edit',request(order,{items:[h.item(product,4),custom]}),h.ids.owner);
  assert.equal(q.total_cents,45000);assert.equal(await h.remaining(product,date),1);
  assert.equal((await h.order(order.id)).revision,order.revision);
  await assert.rejects(h.api('pos_preview_edit',request(order,{items:[h.item(product,5)]}),h.ids.owner),/stock/i);
 })();
 await check('Direct edits: save keeps the reference/link and moves only this order reservation',async()=>{
  const original=order;
  order=await edit(order,{fulfillment_date:next,items:[h.item(product,4),{...custom,unit_price_cents:8000}],discount:{kind:'percent',value:10},method:'delivery',delivery_cents:1200});
  assert.equal(order.id,original.id);assert.equal(order.reference,original.reference);assert.equal(order.access_token,original.access_token);
  assert.equal(order.payment_deadline,null);assert.equal(order.payment_status,'awaiting_payment');assert.equal(order.total_cents,44400);
  assert.equal(await h.remaining(product,date),4);assert.equal(await h.remaining(product,next),1);
  assert.deepEqual(await h.allocations(order.id),[{product_id:product.id,date:next,quantity:4,state:'held'}]);
  assert.equal(order.history.at(-1).action,'pos_order_updated');assert.equal(order.history.at(-1).before.total_cents,35000);
 })();
 await check('Direct edits: access, revision, quote tampering and stock failures leave the order intact',async()=>{
  const before=await h.order(order.id),p=request(order,{items:[h.item(product,1)]});
  for(const who of [null,h.ids.customer,h.ids.unverified])await assert.rejects(h.api('pos_preview_edit',p,who),/access|verify/i);
  await assert.rejects(h.api('pos_preview_edit',{...p,revision:order.revision-1},h.ids.owner),/changed/i);
  const q=await h.api('pos_preview_edit',p,h.ids.owner);
  await assert.rejects(h.api('pos_update_order',{...p,expected_quote:{...q,total_cents:1},idempotency_key:randomUUID()},h.ids.owner),/review/i);
  await assert.rejects(edit(order,{items:[h.item(product,7)]}),/stock/i);
  assert.deepEqual(await h.order(order.id),before);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.pos_edit_api(uuid,text,jsonb)','EXECUTE')",[role]),false);
 })();
 await check('Direct edits: an unchanged retry is idempotent and a changed retry is rejected',async()=>{
  const p=request(order,{items:[custom]}),expected_quote=await h.api('pos_preview_edit',p,h.ids.owner);
  const save={...p,expected_quote,idempotency_key:randomUUID(),reason:'Customer changed items'};
  order=await h.api('pos_update_order',save,h.ids.owner);
  assert.equal((await h.api('pos_update_order',save,h.ids.owner)).revision,order.revision);
  assert.equal((await h.api('pos_find_edit',{order_id:order.id,idempotency_key:save.idempotency_key},h.ids.owner)).id,order.id);
  assert.equal(await h.api('pos_find_edit',{order_id:order.id,idempotency_key:randomUUID()},h.ids.owner),null);
  await assert.rejects(h.api('pos_update_order',{...save,reason:'Changed retry'},h.ids.owner),/different request/i);
  assert.deepEqual(await h.allocations(order.id),[]);assert.equal(await h.remaining(product,next),5);
 })();
 await check('Direct edits: paid totals change while original payments, cash/change and paid status remain',async()=>{
  paid=await create({...base,items:[{...custom,unit_price_cents:10000}],payment:pay(10000,'cash',15000)});
  const original=await h.scalar('select to_jsonb(p) from tlb.payments p where order_id=$1',[paid.id]);
  for(const price of [15000,8000]){
   paid=await edit(paid,{items:[{...custom,unit_price_cents:price}]});
   assert.equal(paid.payment_status,'paid');assert.equal(paid.fulfillment_status,'confirmed');assert.equal(paid.total_cents,price);
   assert.equal(paid.paid_amount_cents,10000);assert.equal(paid.cash_received_cents,15000);assert.equal(paid.change_cents,5000);
   assert.deepEqual(await h.scalar('select to_jsonb(p) from tlb.payments p where order_id=$1',[paid.id]),original);
   assert.equal(await h.scalar('select sum(case when kind=\'sale\' then amount_cents else -amount_cents end)::int from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,paid.id]),price);
   const analytics=buildAnalytics([paid]);assert.equal(analytics.activePaidOrderCount,1);assert.equal(analytics.currentOrderValueCents,price);assert.equal(analytics.approvedPaymentsCents,10000);
  }
 })();
 await check('Direct edits: paid website items reserve committed stock and prices remain server-owned',async()=>{
  paid=await edit(paid,{items:[{...h.item(product,2),unit_price_cents:1}],discount:{kind:'fixed',value:1500}});
  assert.equal(paid.items[0].unit_price_cents,10000);assert.equal(paid.total_cents,18500);
  assert.equal((await h.allocations(paid.id))[0].state,'committed');
  assert.equal(await h.scalar('select sum(case when kind=\'sale\' then amount_cents else -amount_cents end)::int from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,paid.id]),18500);
 })();
 await check('Direct edits: pending and known unpaid delivery fees retain separate collection',async()=>{
  let o=await create({...base,items:[custom],method:'delivery',delivery_fee_pending:true,payment:pay(5000)});
  o=await edit(o,{items:[{...custom,unit_price_cents:6000}],method:'delivery',delivery_fee_pending:true});
  assert.equal(o.delivery_payment_status,'pending');assert.equal(o.total_cents,6000);assert.equal(o.payment_status,'paid');
  o=await h.action('pos_delivery_fee',o,{amount_cents:1200});
  o=await edit(o,{items:[{...custom,unit_price_cents:7000}],method:'delivery',delivery_cents:1500,delivery_fee_pending:false});
  assert.equal(o.deferred_delivery,true);assert.equal(o.delivery_payment_status,'awaiting_payment');assert.equal(o.total_cents,8500);
  assert.equal(await h.scalar('select sum(case when kind=\'sale\' then amount_cents else -amount_cents end)::int from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,o.id]),7000);
  assert.equal(buildAnalytics([o]).currentOrderValueCents,7000);
  o=await h.action('pos_delivery_payment',o,{payment:pay(1500)});assert.equal(o.delivery_payment_status,'paid');
  const payment=await h.scalar('select to_jsonb(p) from tlb.pos_delivery_payments p where order_id=$1',[o.id]);
  o=await edit(o,{items:[{...custom,unit_price_cents:8000}],method:'delivery',delivery_cents:1700,delivery_fee_pending:false});
  assert.equal(o.delivery_payment_status,'paid');assert.equal(o.delivery_paid_cents,1500);assert.equal(o.total_cents,9700);
  assert.deepEqual(await h.scalar('select to_jsonb(p) from tlb.pos_delivery_payments p where order_id=$1',[o.id]),payment);
  assert.equal(await h.scalar('select sum(case when kind=\'sale\' then amount_cents else -amount_cents end)::int from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,o.id]),9700);
  assert.equal(buildAnalytics([o]).currentOrderValueCents,9700);
  await assert.rejects(edit(o,{items:[custom],method:'delivery',delivery_fee_pending:true}),/paid delivery fee/i);
  o=await edit(o,{items:[custom],method:'pickup'});assert.equal(o.delivery_cents,0);assert.equal(o.deferred_delivery,false);
  assert.equal(await h.scalar('select sum(case when kind=\'sale\' then amount_cents else -amount_cents end)::int from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,o.id]),5000);
 })();
 await check('Direct edits: proof review and closed orders cannot be silently amended',async()=>{
  let o=await create({...base,items:[custom]});o=await h.proof(o);
  await assert.rejects(edit(o,{items:[custom]}),/review.*proof/i);
  o=await h.action('cancel_order',o,{reason:'Client cancelled',restore_stock:true});
  await assert.rejects(edit(o,{items:[custom]}),/closed/i);
  await h.action('set_fulfillment',paid,{status:'completed'});
  await assert.rejects(edit(await h.order(paid.id),{items:[custom]}),/completed/i);
 })();
 await check('Direct edits: optional email queues revised content once and retires only unattempted messages',async()=>{
  let o=await create({...base,items:[custom],buyer:{email:'qa@example.test'},email_notifications:true});
  await db.query("update tlb.outbox set attempts=1,first_attempt_at=clock_timestamp() where order_id=$1",[o.id]);
  o=await edit(o,{items:[{...custom,unit_price_cents:9000}],buyer:{email:'qa@example.test',name:'Changed'},email_notifications:true});
  assert.equal(await h.scalar("select count(*)::int from tlb.outbox where order_id=$1 and status='pending'",[o.id]),2);
  assert.equal(await h.scalar("select (payload#>>'{order,total_cents}')::int from tlb.outbox where order_id=$1 and event_key like 'pos-edit:%'",[o.id]),9000);
  o=await edit(o,{items:[custom],email_notifications:false});
  assert.equal(await h.scalar("select count(*)::int from tlb.outbox where order_id=$1 and status='pending'",[o.id]),1);
 })();
 await check('Direct edits: migration replay leaves a single route and keeps its helper private',async()=>{
  await db.exec(await readFile(new URL('../../supabase/migrations/20260928165652_pos_direct_order_edits.sql',import.meta.url),'utf8'));
  const def=await h.scalar("select pg_get_functiondef('tlb.pos_api(uuid,text,jsonb)'::regprocedure)");
  assert.equal(def.split('tlb.pos_edit_api(p_user,p_action,p_payload)').length-1,1);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.pos_edit_api(uuid,text,jsonb)','EXECUTE')"),false);
 })();
}
