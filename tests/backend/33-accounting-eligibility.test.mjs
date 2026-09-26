import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export default async function({db,check,state}) {
 const h=state.harness,range={start:'1900-01-01',end:'2100-01-01'};
 const report=filters=>h.api('accounting_report',{...filters||range,report_version:2},h.ids.owner);
 const fixture=async()=>{
  const {product,date}=await h.fixture();let o=await h.api('create_order',h.checkout(product,date),h.ids.customer);
  await db.query("update tlb.orders set data=data||'{\"subtotal_cents\":100000,\"discount_cents\":5000,\"delivery_cents\":15000,\"total_cents\":110000}'::jsonb where id=$1",[o.id]);
  o=await h.action('approve_payment',await h.proof(o));
  await db.query("update tlb.orders set method='delivery' where id=$1",[o.id]);
  await h.api('accounting_save_delivery',{order_id:o.id,order_revision:o.revision,revision:0,cost_date:await h.day(0),amount_cents:22550,note:'Eligibility fixture'},h.ids.owner);
  return o;
 };
 await check('only paid confirmed, preparing and fulfilled orders contribute to all accounting sections',async()=>{
  const o=await fixture();
  for(const status of ['confirmed','preparing','ready_for_pickup','out_for_delivery','completed']){
   await db.query('update tlb.orders set fulfillment_status=$2 where id=$1',[o.id,status]);
   const r=await report(),rows=r.entries.filter(e=>e.order_id===o.id);
   assert.equal(rows.length,4,status);assert.equal(rows.filter(e=>e.source==='Delivery cost')[0].amount_cents,22550);
   assert.ok(r.deliveries.find(d=>d.order_id===o.id));
  }
  for(const status of ['cancelled','expired','pending_confirmation']){
   await db.query('update tlb.orders set fulfillment_status=$2 where id=$1',[o.id,status]);
   const r=await report();assert.equal(r.entries.some(e=>e.order_id===o.id),false,status);assert.equal(r.deliveries.some(d=>d.order_id===o.id),false,status);
  }
  await db.query("update tlb.orders set fulfillment_status='confirmed',payment_status='under_review' where id=$1",[o.id]);
  assert.equal((await report()).entries.some(e=>e.order_id===o.id),false,'Unapproved orders are excluded');
 })();
 await check('refund excludes original entries, reversals, discounts, courier expenses and delivery comparison across date ranges',async()=>{
  const o=await fixture(),baseline=await report();
  const dates=(await db.query('select distinct entry_date::text from tlb.accounting_ledger where order_id=$1',[o.id])).rows.map(r=>r.entry_date);
  await h.action('set_refund_label',o,{enabled:true});
  const after=await report();
  assert.equal(after.entries.some(e=>e.order_id===o.id),false);assert.equal(after.deliveries.some(e=>e.order_id===o.id),false);
  for(const date of dates)assert.equal((await report({start:date,end:date})).entries.some(e=>e.order_id===o.id),false);
  const category=key=>baseline.categories.find(c=>c.system_key===key).id;
  for(const [key,value] of [['website',100000],['discount',5000],['delivery_fee',15000],['delivery_cost',22550]]){
   const column=['website','delivery_fee'].includes(key)?'sales_cents':'expense_cents';
   assert.equal(baseline.summary.find(s=>s.id===category(key))[column]-after.summary.find(s=>s.id===category(key))[column],value);
  }
  assert.equal(await h.scalar('select amount_cents::int from tlb.accounting_delivery_costs where order_id=$1',[o.id]),22550);
  assert.ok(await h.scalar('select count(*)>0 from tlb.accounting_ledger where order_id=$1',[o.id]));
  await h.action('set_refund_label',await h.order(o.id),{enabled:false});
  const restored=await report();assert.equal(restored.entries.filter(e=>e.order_id===o.id&&e.category_id===category('website')).reduce((n,e)=>n+e.amount_cents,0),100000);
  assert.ok(restored.entries.find(e=>e.order_id===o.id&&e.source==='Delivery cost'));
 })();
 await check('cancelled order expenses stay excluded while independent manual entries and their totals remain',async()=>{
  const o=await fixture();
  const category=await h.api('accounting_save_category',{id:randomUUID(),revision:0,name:'Unaffected manual '+randomUUID(),kind:'expense'},h.ids.owner);
  const entry=await h.api('accounting_save_entry',{id:randomUUID(),revision:0,entry_date:await h.day(0),category_id:category.id,amount_cents:12345,note:'Independent expense'},h.ids.owner);
  await h.action('cancel_order',await h.order(o.id),{reason:'Fixture',restore_stock:true});
  const r=await report();assert.equal(r.entries.some(e=>e.order_id===o.id),false);assert.ok(r.entries.find(e=>e.id===entry.id));assert.equal(r.summary.find(c=>c.id===category.id).expense_cents,12345);
  const definition=await h.scalar("select pg_get_functiondef('tlb.accounting_api(uuid,text,jsonb)'::regprocedure)");
  await db.exec(await readFile(new URL('../../supabase/migrations/20260924184817_accounting_eligible_orders.sql',import.meta.url),'utf8'));
  assert.equal(await h.scalar("select pg_get_functiondef('tlb.accounting_api(uuid,text,jsonb)'::regprocedure)"),definition);
  assert.equal((await report()).entries.some(e=>e.order_id===o.id),false);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.accounting_order_included(tlb.orders)','execute')",[role]),false);
  await assert.rejects(h.api('accounting_report',range,h.ids.staff),/owner|authorized/i);
 })();
}
