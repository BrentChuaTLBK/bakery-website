import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export default async function({db,check,state}) {
 const h=state.harness,today=await h.day(0);
 const call=(action,payload={})=>h.api('accounting_'+action,{report_version:2,...payload},h.ids.owner);
 const report=()=>call('report',{start:today,end:today});
 await check('one category accepts both types, type-only edits recalculate both totals and keep history',async()=>{
  const cat=await call('save_category',{id:randomUUID(),revision:0,name:'Shared '+randomUUID()});
  const payload={revision:0,entry_date:today,category_id:cat.id,note:'Shared category',payment_method:'cash',client_name:'Example client'};
  const sale=await call('save_entry',{...payload,id:randomUUID(),kind:'sale',amount_cents:100000});
  const expense=await call('save_entry',{...payload,id:randomUUID(),kind:'expense',amount_cents:25000});
  let r=await report(),summary=r.summary.find(c=>c.id===cat.id);
  assert.equal(summary.sales_cents,100000);assert.equal(summary.expense_cents,25000);
  assert.equal(r.categories.filter(c=>c.name===cat.name).length,1);assert.equal(r.categories.find(c=>c.id===cat.id).kind,undefined);
  assert.equal(r.entries.find(e=>e.id===sale.id).kind,'sale');assert.equal(r.entries.find(e=>e.id===expense.id).kind,'expense');
  const changed=await call('save_entry',{...expense,kind:'sale'});assert.equal(changed.revision,2);
  r=await report();summary=r.summary.find(c=>c.id===cat.id);assert.equal(summary.sales_cents,125000);assert.equal(summary.expense_cents,0);
  const history=await call('history',{id:expense.id});assert.equal(history.at(-1).before.kind,'expense');assert.equal(history.at(-1).after.kind,'sale');
  await assert.rejects(call('save_entry',{...expense,kind:'expense',amount_cents:1}),/changed/);
  for(const kind of ['',null,'income','other'])await assert.rejects(call('save_entry',{...payload,id:randomUUID(),kind,amount_cents:1}),/Choose Sales/);
  await assert.rejects(call('save_category',{id:randomUUID(),revision:0,name:' '+cat.name.toUpperCase()+' ',kind:'expense'}),/already exists/);
  const renamed=await call('save_category',{...cat,name:cat.name+' revised'});r=await report();assert.equal(r.summary.find(c=>c.id===cat.id).name,renamed.name);
  await call('save_category',{...renamed,archived:true});
  await call('save_entry',{...changed,note:'Edit existing archived-category entry'});
  await assert.rejects(call('save_entry',{...payload,id:randomUUID(),kind:'expense',amount_cents:1}),/active manual/);
  await assert.rejects(call('report',{start:today,end:today,report_version:1}),/Refresh/);
 })();
 await check('duplicate-category migration preserves sale/expense amounts, clients, payment methods and old audit snapshots',async()=>{
  const migration=(await readFile(new URL('../../supabase/migrations/20260926024704_accounting_shared_categories.sql',import.meta.url),'utf8')).replace(/^begin;/,'').replace(/commit;\s*$/,'');
  await db.exec('begin;');
  try{
   await db.exec('drop index tlb.accounting_shared_category_name; alter table tlb.accounting_entries alter column kind drop not null;');
   const salesId=randomUUID(),expenseId=randomUUID(),saleId=randomUUID(),entryId=randomUUID(),name='Duplicate '+randomUUID();
   await db.query('insert into tlb.accounting_categories(id,name,kind) values($1,$3,\'sale\'),($2,$3,\'expense\')',[salesId,expenseId,name]);
   await db.query("insert into tlb.accounting_entries(id,entry_date,category_id,amount_cents,note,client_name,payment_method) values($1,$5,$2,100000,'Sale','Buyer','gcash'),($3,$5,$4,25000,'Expense','Supplier','bank_transfer')",[saleId,salesId,entryId,expenseId,today]);
   await db.query("insert into tlb.accounting_audit(target_id,actor,action,after_data) values($1,$2,'accounting_save_entry',jsonb_build_object('category_id',$3::text,'amount_cents',25000))",[entryId,h.ids.owner,expenseId]);
   const history=await call('history',{id:entryId});
   await db.exec(migration);
   const r=await report(),cats=r.categories.filter(c=>c.name===name);assert.equal(cats.length,1);assert.equal(cats[0].id,salesId);
   const entries=r.entries.filter(e=>[saleId,entryId].includes(e.id));assert.equal(entries.length,2);
   assert.equal(entries.find(e=>e.id===entryId).kind,'expense');assert.equal(entries.find(e=>e.id===saleId).kind,'sale');
   assert.equal(entries.every(e=>e.category_id===salesId),true);assert.equal(entries.find(e=>e.id===entryId).client_name,'Supplier');assert.equal(entries.find(e=>e.id===entryId).payment_method,'bank_transfer');
   assert.equal(r.summary.find(c=>c.id===salesId).sales_cents,100000);assert.equal(r.summary.find(c=>c.id===salesId).expense_cents,25000);
   assert.deepEqual(await call('history',{id:entryId}),history,'Old audit snapshot is preserved verbatim');
   await db.exec(migration);const replay=await report();assert.deepEqual(replay.entries.filter(e=>[saleId,entryId].includes(e.id)),entries);
   assert.equal(await h.scalar('select merged_into::text from tlb.accounting_categories where id=$1',[expenseId]),salesId);
  }finally{await db.exec('rollback;');}
 })();
}
