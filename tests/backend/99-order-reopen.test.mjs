import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export default async function({db,check,state}) {
 const h=state.harness,{ids}=h,today=await h.day(0),date=await h.day(45),next=await h.day(46);
 const product=await h.product({price_cents:10000});
 await h.inventory(product,date,40);await h.inventory(product,next,40);
 const jsonRows=(table,id)=>db.query(`select to_jsonb(t) value from tlb.${table} t where order_id=$1 order by to_jsonb(t)::text`,[id]).then(r=>r.rows.map(x=>x.value));
 const savedRow=id=>h.scalar('select to_jsonb(o) from tlb.orders o where id=$1',[id]);
 const omit=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)));
 const facts=async id=>({row:await savedRow(id),payments:await jsonRows('payments',id),delivery_payments:await jsonRows('pos_delivery_payments',id),allocations:await jsonRows('allocations',id),promo:await jsonRows('promo_usage',id),ledger:await jsonRows('accounting_ledger',id),outbox:await jsonRows('outbox',id),session_payments:await jsonRows('pos_session_payments',id)});
 const payload=(o,extra={})=>({order_id:o.id,revision:o.revision,idempotency_key:randomUUID(),reason:'Completion selected by mistake; fulfillment is still pending.',...extra});
 const website=async()=>{
  const created=await h.api('create_order',h.checkout(product,date,{items:[h.item(product,2)]}),ids.customer);
  return h.action('set_fulfillment',await h.action('approve_payment',await h.proof(created)),{status:'completed'});
 };
 const direct=async()=>{
  const p={source:'direct_message',method:'delivery',fulfillment_date:date,override_dates:true,buyer:{name:'Synthetic direct customer'},items:[h.item(product,2),{name:'Synthetic cake',quantity:1,unit_price_cents:5000}],discount:{kind:'none'},delivery_fee_pending:true,email_notifications:false};
  const expected_quote=await h.api('pos_quote',p,ids.owner);
  let o=await h.api('pos_create_order',{...p,expected_quote,idempotency_key:randomUUID(),payment:{method:'cash',amount_cents:expected_quote.total_cents,received_cents:30000}},ids.owner);
  o=await h.action('pos_delivery_fee',o,{amount_cents:1200});
  o=await h.action('pos_delivery_payment',o,{payment:{method:'gcash',amount_cents:1200,received_cents:1200}});
  return h.action('set_fulfillment',o,{status:'completed'});
 };

 await check('Reopen: paid website fulfillment returns to confirmed with one audited change and unchanged payments, items, stock and links',async()=>{
  const o=await website(),before=await facts(o.id),history=o.history.length,remaining=await h.remaining(product,date),token=await h.scalar('select tlb.order_token(o) from tlb.orders o where id=$1',[o.id]);
  const reopened=await h.api('reopen_order',payload(o,{reason:'  Accidental completion; prepare this order later.  '}),ids.staff),after=await facts(o.id);
  assert.equal(reopened.fulfillment_status,'confirmed');assert.equal(reopened.payment_status,'paid');assert.equal(reopened.revision,o.revision+1);
  assert.deepEqual(omit(after.row,['fulfillment_status','revision']),omit(before.row,['fulfillment_status','revision']));
  for(const key of Object.keys(before).filter(k=>k!=='row'))assert.deepEqual(after[key],before[key],`${key} preserved`);
  assert.equal(await h.remaining(product,date),remaining);assert.equal(reopened.reference,o.reference);
  assert.equal(await h.scalar('select tlb.order_token(o) from tlb.orders o where id=$1',[o.id]),token);
  assert.equal(reopened.history.length,history+1);const event=reopened.history.at(-1);
  assert.equal(event.action,'reopen_order');assert.equal(event.actor,ids.staff);assert.equal(event.reason,'Accidental completion; prepare this order later.');
  assert.equal(event.before.fulfillment_status,'completed');assert.equal(event.after.fulfillment_status,'confirmed');assert.equal(event.before.total_cents,event.after.total_cents);
  const preview=await h.api('preview_edit_order',{order_id:reopened.id,revision:reopened.revision,changes:{fulfillment_date:next}},ids.staff);
  assert.equal(preview.fulfillment_date,next);assert.equal((await h.order(o.id)).fulfillment_status,'confirmed');
 })();

 await check('Reopen: a paid direct order keeps cash/change and separately collected delivery payments, then can be amended again',async()=>{
  const o=await direct(),before=await facts(o.id),reopened=await h.api('reopen_order',payload(o),ids.owner),after=await facts(o.id);
  assert.deepEqual(omit(after.row,['fulfillment_status','revision']),omit(before.row,['fulfillment_status','revision']));
  for(const key of Object.keys(before).filter(k=>k!=='row'))assert.deepEqual(after[key],before[key]);
  assert.equal(reopened.cash_received_cents,30000);assert.equal(reopened.change_cents,5000);assert.equal(reopened.delivery_payment_status,'paid');assert.equal(reopened.delivery_paid_cents,1200);
  const p={source:'direct_message',order_id:o.id,revision:reopened.revision,method:'delivery',fulfillment_date:next,override_dates:true,buyer:reopened.buyer,recipient:reopened.recipient,address:reopened.address,items:reopened.items,discount:{kind:'none'},delivery_cents:1200,email_notifications:false,reason:'Reschedule the reopened order'};
  const expected_quote=await h.api('pos_preview_edit',p,ids.owner);
  const edited=await h.api('pos_update_order',{...p,expected_quote,idempotency_key:randomUUID()},ids.owner);
  assert.equal(edited.fulfillment_date,next);assert.equal(edited.fulfillment_status,'confirmed');assert.equal(edited.payment_status,'paid');assert.equal(edited.total_cents,o.total_cents);
  assert.deepEqual(await jsonRows('payments',o.id),before.payments);assert.deepEqual(await jsonRows('pos_delivery_payments',o.id),before.delivery_payments);
  assert.equal((await h.allocations(o.id))[0].date,next);assert.equal((await h.allocations(o.id))[0].state,'committed');
 })();

 await check('Reopen: anonymous, customer/token, unrelated and unverified staff calls are rejected without a change',async()=>{
  const o=await website(),before=await facts(o.id),history=o.history.length,p=payload(o);
  for(const user of [null,ids.customer,ids.stranger])await assert.rejects(h.api('reopen_order',p,user,o.access_token),/access/i);
  await db.query("insert into tlb.staff(user_id,role) values($1,'staff')",[ids.unverified]);
  try {await assert.rejects(h.api('reopen_order',p,ids.unverified),/verify/i);} finally {await db.query('delete from tlb.staff where user_id=$1',[ids.unverified]);}
  assert.deepEqual(await facts(o.id),before);assert.equal((await h.order(o.id)).history.length,history);
 })();

 await check('Reopen: cancelled, expired, unfinished, unpaid, rejected and refund-labeled orders remain closed to this action',async()=>{
  const o=await website();
  const cases=[...['cancelled','expired','confirmed','preparing','ready_for_pickup','out_for_delivery','pending_confirmation'].map(fulfillment_status=>({payment_status:'paid',fulfillment_status,refund_label:false})),...['awaiting_payment','under_review','rejected'].map(payment_status=>({payment_status,fulfillment_status:'completed',refund_label:false})),{payment_status:'paid',fulfillment_status:'completed',refund_label:true}];
  for(const value of cases){
   await db.query('update tlb.orders set payment_status=$2,fulfillment_status=$3,refund_label=$4 where id=$1',[o.id,value.payment_status,value.fulfillment_status,value.refund_label]);
   const before=await facts(o.id),current=await h.order(o.id),history=current.history.length;
   await assert.rejects(h.api('reopen_order',payload(current),ids.owner),/paid, completed.*Refund/i);
   assert.deepEqual(await facts(o.id),before);assert.equal((await h.order(o.id)).history.length,history);
  }
 })();

 await check('Reopen: pop-up counter sales retain completion, stock and payment records and their separate void workflow',async()=>{
  const event=await h.api('pos_save_event',{name:'Synthetic reopen exclusion event',starts_on:today,ends_on:today,stock:[{product_id:product.id,capacity:5,price_cents:10000}]},ids.owner);
  const p={source:'popup',event_id:event.id,items:[h.item(product)],discount:{kind:'none'},buyer:{},email_notifications:false,payment:{method:'gcash',amount_cents:10000,received_cents:10000}},expected_quote=await h.api('pos_quote',p,ids.staff);
  const o=await h.api('pos_create_order',{...p,expected_quote,idempotency_key:randomUUID()},ids.staff),before=await facts(o.id),allocation=await jsonRows('pos_allocations',o.id);
  assert.equal(o.fulfillment_status,'completed');await assert.rejects(h.api('reopen_order',payload(o),ids.staff),/website and direct fulfillment/i);
  assert.deepEqual(await facts(o.id),before);assert.deepEqual(await jsonRows('pos_allocations',o.id),allocation);
  assert.equal((await h.api('pos_bootstrap',{},ids.owner)).events.find(e=>e.id===event.id).stock[0].remaining,4);
 })();

 await check('Reopen: revision, mandatory reason and unique retry key guard the change, including a later recompletion',async()=>{
  const o=await website(),before=await facts(o.id);
  for(const extra of [{reason:''},{reason:'   '},{reason:null},{reason:42},{reason:'x'.repeat(4001)},{idempotency_key:null},{revision:o.revision-1},{payment_status:'paid'},{status:'preparing'},{items:[]}])await assert.rejects(h.api('reopen_order',payload(o,extra),ids.owner),/reason|key|changed|Unsupported/i);
  assert.deepEqual(await facts(o.id),before);
  const p=payload(o),reopened=await h.api('reopen_order',p,ids.owner),history=reopened.history.length;
  assert.equal((await h.api('reopen_order',p,ids.owner)).revision,reopened.revision);assert.equal((await h.order(o.id)).history.length,history);
  await assert.rejects(h.api('reopen_order',{...p,reason:'Different retry'},ids.owner),/different request/i);
  const other=await website();await assert.rejects(h.api('reopen_order',{...p,order_id:other.id},ids.owner),/different request/i);
  await assert.rejects(h.api('reopen_order',payload(o),ids.owner),/changed/i);
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[ids.owner]);
  try {await assert.rejects(h.api('reopen_order',p,ids.owner),/verify/i);} finally {await db.query('update auth.users set email_confirmed_at=clock_timestamp() where id=$1',[ids.owner]);}
  const completed=await h.action('set_fulfillment',reopened,{status:'completed'}),againBefore=await facts(o.id);
  assert.equal((await h.api('reopen_order',p,ids.owner)).fulfillment_status,'completed');assert.deepEqual(await facts(o.id),againBefore);assert.equal((await h.order(o.id)).history.length,completed.history.length);
 })();

 await check('Reopen: the calendar updates its existing event, accounting adds no movement and the active backup regains the exact order',async()=>{
  const o=await website(),calendar=await h.scalar('select to_jsonb(e) from tlb.calendar_events e where order_id=$1',[o.id]),ledger=await jsonRows('accounting_ledger',o.id),accounting=await h.scalar('select to_jsonb(s) from tlb.accounting_order_state s where order_id=$1',[o.id]),backupRevision=await h.scalar('select revision from tlb.order_backup_connection where id');
  const backup=()=>h.as(ids.owner,async()=>(await db.query("select public.order_backup_api('download','{}'::jsonb) result")).rows[0].result);
  assert.equal((await backup()).orders.some(x=>x.id===o.id),false);
  const reopened=await h.api('reopen_order',payload(o),ids.staff),after=await h.scalar('select to_jsonb(e) from tlb.calendar_events e where order_id=$1',[o.id]);
  assert.equal(after.event_id,calendar.event_id);assert.equal(after.generation,calendar.generation);assert.equal(after.revision,calendar.revision+1);assert.equal(after.desired.status,'confirmed');assert.deepEqual(omit(after.desired,['status']),omit(calendar.desired,['status']));
  assert.deepEqual(await jsonRows('accounting_ledger',o.id),ledger);assert.deepEqual(await h.scalar('select to_jsonb(s) from tlb.accounting_order_state s where order_id=$1',[o.id]),accounting);
  assert.ok(await h.scalar('select revision from tlb.order_backup_connection where id')>backupRevision);
  const restored=(await backup()).orders.find(x=>x.id===o.id);assert.equal(restored.payment_status,'paid');assert.equal(restored.fulfillment_status,'confirmed');assert.deepEqual(restored.data.items,reopened.items);assert.equal(restored.payments.length,1);assert.equal(restored.allocations[0].state,'committed');assert.equal(restored.history.at(-1).action,'reopen_order');assert.equal(restored.access_token,undefined);assert.equal(restored.access_digest,undefined);
  assert.equal((await h.api('calendar_list',{from:date,to:date},ids.staff)).orders.find(x=>x.id===o.id).status,'confirmed');
 })();

 await check('Reopen: migration replay retains one guarded action and leaves other shop routes and grants intact',async()=>{
  const grants=[];for(const role of ['anon','authenticated','service_role'])grants.push(await h.scalar("select has_function_privilege($1,'public.shop_api(text,jsonb,text)','EXECUTE')",[role]));
  await db.exec(await readFile(new URL('../../supabase/migrations/20261014191233_reopen_completed_fulfillment.sql',import.meta.url),'utf8'));
  const definition=await h.scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)");assert.equal(definition.split("elsif p_action='reopen_order' then").length-1,1);
  let index=0;for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'public.shop_api(text,jsonb,text)','EXECUTE')",[role]),grants[index++]);
  assert.ok((await h.api('catalog')).products.some(p=>p.id===product.id));assert.ok((await h.api('pos_bootstrap',{},ids.staff)).events.length>0);
  assert.equal(await h.scalar("select has_table_privilege('authenticated','tlb.orders','UPDATE')"),false);
  assert.equal((await h.api('reopen_order',payload(await website()),ids.owner)).fulfillment_status,'confirmed');
 })();
}
