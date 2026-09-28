import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
export default async function({db,check,state}){
 const h=state.harness,date=await h.day(30),today=await h.day(0);
 const base={source:'direct_message',method:'delivery',fulfillment_date:date,delivery_fee_pending:true,delivery_cents:99999,override_dates:true,override_reason:'Confirmed direct order',items:[{name:'Custom cake',quantity:1,unit_price_cents:10000}],buyer:{},email_notifications:false};
 const create=async(extra={})=>{const p={...base,...extra};const q=await h.api('pos_quote',p,h.ids.owner);return h.api('pos_create_order',{...p,expected_quote:q,idempotency_key:randomUUID()},h.ids.owner)};
 const pay=(amount,method='gcash',received=amount)=>({method,amount_cents:amount,received_cents:received});
 let o;
 await check('Deferred delivery: product payment is full and courier fee stays explicitly pending',async()=>{
  o=await create({payment:pay(10000)});assert.equal(o.total_cents,10000);assert.equal(o.delivery_cents,0);assert.equal(o.payment_status,'paid');assert.equal(o.delivery_payment_status,'pending');assert.equal(o.payment_deadline,null);
  assert.deepEqual(await h.allocations(o.id),[]);
  assert.equal(await h.scalar('select amount_cents from tlb.payments where order_id=$1',[o.id]),10000);
 })();
 await check('Deferred delivery: exact fee changes the invoice but only collected money enters accounting',async()=>{
  o=await h.action('pos_delivery_fee',o,{amount_cents:1200,note:'Actual courier quote'});
  assert.equal(o.total_cents,11200);assert.equal(o.paid_amount_cents,10000);assert.equal(o.delivery_payment_status,'awaiting_payment');
  assert.equal(await h.scalar('select sum(amount_cents)::int from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,o.id]),10000);
  await assert.rejects(h.api('pos_delivery_fee',{order_id:o.id,revision:o.revision,idempotency_key:randomUUID(),amount_cents:1000},h.ids.customer),/access/i);
  await assert.rejects(h.action('pos_delivery_fee',{...o,revision:o.revision-1},{amount_cents:1000}),/changed/i);
 })();
 await check('Deferred delivery: proof is bound to the fee and payment stage; replacement preserves product payment',async()=>{
  const payload={order_id:o.id,token:o.access_token,user_id:null,payment_stage:'delivery',delivery_fee_cents:1200,path:o.id+'/'+randomUUID()+'.webp',payment_reference:'DELIVERY-REF'};
  await assert.rejects(h.service('commit_proof',{...payload,payment_stage:'products'}),/no longer accepted/i);
  await assert.rejects(h.service('commit_proof',{...payload,delivery_fee_cents:1300}),/fee changed/i);
  assert.equal((await h.service('authorize_upload',{...payload,kind:'proof'})).allowed,true);
  o=await h.service('commit_proof',payload);assert.equal(o.payment_status,'paid');assert.equal(o.delivery_payment_status,'under_review');assert.equal(o.proof_path,null);
  const reviews=(await db.query("select payload from tlb.outbox where order_id=$1 and event_type='order_review_required'",[o.id])).rows;
  assert.equal(reviews.length,2);assert.equal(reviews[0].payload.order.proof_stage,'delivery');assert.doesNotMatch(JSON.stringify(reviews),/access_token|proof_path/);
  await assert.rejects(h.action('pos_delivery_fee',o,{amount_cents:900}),/review/i);
  o=await h.action('pos_delivery_reject',o,{reason:'Please upload the delivery receipt'});assert.equal(o.delivery_payment_status,'awaiting_payment');assert.equal(o.paid_amount_cents,10000);
  o=await h.service('commit_proof',payload);o=await h.order(o.id);assert.equal(o.proof_stage,'delivery');assert.equal(o.proof_path,payload.path);
 })();
 await check('Deferred delivery: full courier payment records once, with its own method and change',async()=>{
  await assert.rejects(h.action('pos_delivery_payment',o,{payment:pay(1000)}),/exact delivery fee/i);
  const p={order_id:o.id,revision:o.revision,idempotency_key:randomUUID(),payment:pay(1200,'cash',2000)};
  o=await h.api('pos_delivery_payment',p,h.ids.staff);assert.equal(o.delivery_payment_status,'paid');assert.equal(o.delivery_paid_cents,1200);assert.equal(o.delivery_change_cents,800);
  assert.equal((await h.api('pos_delivery_payment',p,h.ids.staff)).revision,o.revision);
  assert.equal(await h.scalar('select count(*)::int from tlb.pos_delivery_payments where order_id=$1',[o.id]),1);
  assert.equal(await h.scalar('select amount_cents from tlb.payments where order_id=$1',[o.id]),10000);
  assert.equal(await h.scalar('select sum(amount_cents)::int from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,o.id]),11200);
  const entries=(await db.query('select payment_method,amount_cents::int from tlb.accounting_rows_v2($1,$1) where order_id=$2 order by amount_cents',[today,o.id])).rows;
  assert.deepEqual(entries,[{payment_method:'cash',amount_cents:1200},{payment_method:'gcash',amount_cents:10000}]);
  await assert.rejects(h.action('pos_delivery_fee',o,{amount_cents:1500}),/already paid/i);
 })();
 await check('Deferred delivery: fees entered before product payment are still collected separately',async()=>{
  let p=await create();p=await h.action('pos_delivery_fee',p,{amount_cents:1500});
  await assert.rejects(h.action('pos_delivery_payment',p,{payment:pay(1500)}),/products first/i);
  await assert.rejects(h.action('pos_payment',p,{payment:pay(11500)}),/full payment/i);
  p=await h.action('pos_payment',p,{payment:pay(10000)});assert.equal(p.paid_amount_cents,10000);assert.equal(p.delivery_payment_status,'awaiting_payment');
  await h.action('cancel_order',p,{reason:'Client cancelled',restore_stock:false});
  await assert.rejects(h.action('pos_delivery_payment',await h.order(p.id),{payment:pay(1500)}),/closed/i);
  assert.equal(await h.scalar('select count(*)::int from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,p.id]),0);
 })();
}
