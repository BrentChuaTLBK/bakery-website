import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export default async function({db,check,state}){
 const h=state.harness,today=await h.day(0);
 const migration=await readFile(new URL('../../supabase/migrations/20260927204856_accounting_delivery_category.sql',import.meta.url),'utf8');
 // The historical migration replaces this report function. Restore the latest
 // definition afterwards so its replay cannot undo newer features for other suites.
 const reportDefinition=await h.scalar("select pg_get_functiondef('tlb.accounting_rows_v2(date,date)'::regprocedure)");
 await db.exec(migration);
 const call=(action,payload={})=>h.api('accounting_'+action,{report_version:2,...payload},h.ids.owner);
 const report=()=>call('report',{start:today,end:today});
 const totals=r=>r.summary.reduce((s,c)=>[s[0]+c.sales_cents,s[1]+c.expense_cents],[0,0]);
 let delivery;
 await check('Delivery is one category and accepts manual income and expenses while retaining system protections',async()=>{
  const r=await report();delivery=r.categories.find(c=>c.name==='Delivery');assert.ok(delivery);assert.equal(r.categories.filter(c=>c.name==='Delivery').length,1);assert.equal(r.categories.some(c=>['Delivery costs','Delivery fees'].includes(c.name)),false);
  const payload={revision:0,entry_date:today,category_id:delivery.id,amount_cents:12345,note:'Manual delivery QA'};
  for(const kind of ['sale','expense'])assert.equal((await call('save_entry',{...payload,id:randomUUID(),kind})).kind,kind);
  await assert.rejects(call('save_category',{...delivery,name:'Changed'}),/Automatic/);
  const alias=await h.scalar("select id from tlb.accounting_categories where system_key='delivery_cost'");
  await assert.rejects(call('save_entry',{...payload,id:randomUUID(),category_id:alias,kind:'expense'}),/active manual/);
 })();
 await check('automatic delivery fees and courier costs share an ID and retain separate types and cost dates',async()=>{
  const {product,date}=await h.fixture();let o=await h.api('create_order',h.checkout(product,date),h.ids.customer);o=await h.proof(o);
  await db.query("update tlb.orders set data=data||'{\"delivery_cents\":15000}'::jsonb where id=$1",[o.id]);
  await h.action('approve_payment',await h.order(o.id));const current=await h.order(o.id);
  await call('save_delivery',{order_id:o.id,order_revision:current.revision,revision:0,cost_date:today,amount_cents:22550,note:'Courier QA'});
  const rows=(await report()).entries.filter(e=>e.order_id===o.id&&e.category_id===delivery.id);assert.equal(rows.length,2);assert.equal(rows.find(e=>e.kind==='sale').amount_cents,15000);assert.equal(rows.find(e=>e.kind==='expense').amount_cents,22550);assert.equal(rows.find(e=>e.kind==='expense').entry_date,today);
  await h.action('set_refund_label',current,{enabled:true});assert.equal((await report()).entries.some(e=>e.order_id===o.id),false);
  assert.equal(await h.scalar('select amount_cents::int from tlb.accounting_delivery_costs where order_id=$1',[o.id]),22550,'Stored cost is retained even when excluded from the report');
 })();
 await check('merging an existing manual Delivery keeps amounts, kinds and audit history and is repeatable',async()=>{
  await db.exec('begin;');
  try{
   await db.query("update tlb.accounting_categories set name='Delivery fees' where id=$1",[delivery.id]);
   await db.exec("update tlb.accounting_categories set merged_into=null,archived=false where system_key='delivery_cost'");
   const cat=await call('save_category',{id:randomUUID(),revision:0,name:'Delivery'}),entries=[];
   for(const kind of ['sale','expense'])entries.push(await call('save_entry',{id:randomUUID(),revision:0,entry_date:today,category_id:cat.id,amount_cents:321,kind,note:'Preserve me',client_name:'Example',payment_method:'cash'}));
   const before=await report(),history=await call('history',{id:entries[1].id});
   const sql=migration.replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');await db.exec(sql);
   const after=await report();assert.deepEqual(totals(after),totals(before));
   for(const e of entries){const row=after.entries.find(r=>r.id===e.id);assert.equal(row.category_id,delivery.id);assert.equal(row.amount_cents,e.amount_cents);assert.equal(row.kind,e.kind);assert.equal(row.client_name,'Example');assert.equal(row.payment_method,'cash');}
   assert.deepEqual(await call('history',{id:entries[1].id}),history);
   await db.exec(sql);assert.deepEqual((await report()).entries,after.entries);assert.equal((await report()).categories.filter(c=>c.name==='Delivery').length,1);
  }finally{await db.exec('rollback;');}
 })();
 await db.exec(reportDefinition);
}
