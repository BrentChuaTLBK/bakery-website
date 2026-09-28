import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export default async function({db,check,state}){
 const h=state.harness,today=await h.day(0);
 await check('Accounting: website buyer names reach report rows without changing amounts or inventing payment methods',async()=>{
  const {product,date}=await h.fixture();
  const buyer={name:"Audit <Client> O'Neil",email:'customer@example.test',phone:'09171234567',social_platform:'instagram',social_username:'audit'};
  let o=await h.api('create_order',h.checkout(product,date,{buyer}),h.ids.customer);
  o=await h.action('approve_payment',await h.proof(o));
  const report=await h.api('accounting_report',{report_version:2,start:today,end:today},h.ids.owner);
  const rows=report.entries.filter(r=>r.order_id===o.id);
  assert.ok(rows.length);
  assert.ok(rows.every(r=>r.client_name===buyer.name&&r.source==='Website'&&r.payment_method===''));
  assert.equal(rows.reduce((n,r)=>n+(r.kind==='sale'?1:-1)*Number(r.amount_cents),0),o.total_cents);
  await h.action('cancel_order',o,{reason:'Audit fixture cancellation',restore_stock:true});
  assert.equal((await h.api('accounting_report',{report_version:2,start:today,end:today},h.ids.owner)).entries.some(r=>r.order_id===o.id),false);
 })();
 await check('Accounting: buyer-name migration can be repeated and keeps the report helper private',async()=>{
  const before=await h.scalar("select pg_get_functiondef('tlb.accounting_rows_v2(date,date)'::regprocedure)");
  await db.exec(await readFile(new URL('../../supabase/migrations/20260928143339_accounting_order_client_names.sql',import.meta.url),'utf8'));
  assert.equal(await h.scalar("select pg_get_functiondef('tlb.accounting_rows_v2(date,date)'::regprocedure)"),before);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.accounting_rows_v2(date,date)','EXECUTE')",[role]),false);
 })();
}
