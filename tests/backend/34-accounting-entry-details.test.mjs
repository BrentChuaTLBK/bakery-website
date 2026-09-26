import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export default async function({db,check,state}) {
 const h=state.harness,today=await h.day(0);
 const call=(action,payload,user=h.ids.owner)=>h.api('accounting_'+action,{...payload,report_version:2},user);
 const cat=await call('save_category',{id:randomUUID(),revision:0,name:'Entry details '+randomUUID(),kind:'sale'});
 const base=()=>({id:randomUUID(),revision:0,entry_date:today,category_id:cat.id,amount_cents:50000,note:'Manual fixture'});
 await check('client and payment details survive saves, retries, edits, reports and audit history',async()=>{
  const payload={...base(),client_name:"  Test <Client> O'Neil  ",payment_method:'gcash'};
  const saved=await call('save_entry',payload);
  assert.equal(saved.client_name,"Test <Client> O'Neil");assert.equal(saved.payment_method,'gcash');
  assert.equal((await call('save_entry',payload)).revision,1);
  assert.equal((await call('history',{id:saved.id})).length,1);
  const edited=await call('save_entry',{...payload,revision:1,client_name:'Revised client',payment_method:'bank_transfer'});
  assert.equal(edited.revision,2);
  const r=await call('report',{start:today,end:today}),entry=r.entries.find(e=>e.id===saved.id);
  assert.equal(entry.client_name,'Revised client');assert.equal(entry.payment_method,'bank_transfer');assert.equal(entry.amount_cents,50000);
  const history=await call('history',{id:saved.id});assert.equal(history[1].before.client_name,"Test <Client> O'Neil");assert.equal(history[1].after.payment_method,'bank_transfer');
  await assert.rejects(call('save_entry',{...payload,revision:1,payment_method:'cash'}),/changed/i);
  // A tab running the previous UI must not erase details that it cannot display.
  const {client_name,payment_method,...legacy}=payload;
  const oldTab=await call('save_entry',{...legacy,revision:2,amount_cents:50100});
  assert.equal(oldTab.client_name,'Revised client');assert.equal(oldTab.payment_method,'bank_transfer');
  const cleared=await call('save_entry',{...legacy,revision:3,client_name:'',payment_method:''});
  assert.equal(cleared.client_name,'');assert.equal(cleared.payment_method,'');
 })();
 await check('optional accounting details validate every payment method and stay owner-only',async()=>{
  for(const method of ['','gcash','cash','bank_transfer']) {
   const e=await call('save_entry',{...base(),payment_method:method});assert.equal(e.client_name,'');assert.equal(e.payment_method,method);
  }
  const legacy=await call('save_entry',base());assert.equal(legacy.client_name,'');assert.equal(legacy.payment_method,'');
  await assert.rejects(call('save_entry',{...base(),client_name:'x'.repeat(161)}),/160/);
  for(const method of ['card','GCash','cash,bank_transfer'])await assert.rejects(call('save_entry',{...base(),payment_method:method}),/GCash|Cash|Bank Transfer/);
  for(const user of [null,h.ids.staff,h.ids.customer])await assert.rejects(call('save_entry',{...base(),client_name:'Private client',payment_method:'cash'},user),/authorized|owner|staff|access/i);
 })();
 await check('entry-details migration can be replayed without losing saved names or payment methods',async()=>{
  const e=await call('save_entry',{...base(),client_name:'Replay fixture',payment_method:'cash'});
  await db.exec(await readFile(new URL('../../supabase/migrations/20260926024704_accounting_shared_categories.sql',import.meta.url),'utf8'));
  const r=await call('report',{start:today,end:today}),entry=r.entries.find(x=>x.id===e.id);
  assert.equal(entry.client_name,'Replay fixture');assert.equal(entry.payment_method,'cash');assert.equal(entry.revision,1);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.accounting_api(uuid,text,jsonb)','execute')"),false);
 })();
}
