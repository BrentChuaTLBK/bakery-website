import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}){
 const h=state.harness,{api,ids}=h,today=await h.day(0),product=await h.product({name:'Drawer brownie',price_cents:12500});
 const event=await api('pos_save_event',{name:'Shared drawer event',starts_on:today,ends_on:today,stock:[{product_id:product.id,capacity:100,price_cents:12500}]},ids.owner);
 const another=await api('pos_save_event',{name:'Another drawer',starts_on:today,ends_on:today,stock:[]},ids.owner);
 const settingsBefore=await h.scalar('select data from tlb.settings where id');
 const baseConfig=(await api('pos_bootstrap',{},ids.owner)).register_config;
 const request=(method='cash',sid=session?.id)=>({source:'popup',event_id:event.id,items:[h.item(product)],discount:{kind:'none'},buyer:{},email_notifications:false,payment:{method,amount_cents:12500,received_cents:20000,cash_session_id:sid}});
 const submit=async(p,user=ids.staff)=>{const q=await api('pos_quote',p,user);return {...p,expected_quote:q,idempotency_key:randomUUID()}};
 const create=async(p,user=ids.staff)=>api('pos_create_order',await submit(p,user),user);
 const action=(name,p,user=ids.staff)=>api(name,{...p,idempotency_key:randomUUID()},user);
 const refresh=async()=>session=await api('pos_cash_get',{session_id:session.id},ids.staff);
 let session,cashSale,secondCash,config,customId='pos-'+randomUUID(),digitalSale;
 await check('Cash sessions: cash needs an open matching drawer; failed sale is atomic',async()=>{
  const count=await h.scalar('select count(*)::int from tlb.orders');
  await assert.rejects(create(request('cash',null)),/open a cash session/i);
  assert.equal(await h.scalar('select count(*)::int from tlb.orders'),count);
  assert.equal((await api('pos_bootstrap',{},ids.staff)).events.find(e=>e.id===event.id).stock[0].remaining,100);
  for(const user of [null,ids.customer,ids.unverified])await assert.rejects(action('pos_cash_open',{event_id:event.id,opening_cents:1000},user),/access|verify/i);
  for(const table of ['pos_cash_sessions','pos_cash_movements','pos_session_payments','pos_register_config','pos_register_actions'])await assert.rejects(h.as(ids.staff,()=>db.query(`select * from tlb.${table}`)),/permission/i);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.pos_register_payment(uuid,uuid,jsonb)','execute')"),false);
 })();
 await check('Cash sessions: one shared drawer per event, opening float is not income',async()=>{
  const ledger=await h.scalar('select count(*)::int from tlb.accounting_ledger');
  const p={event_id:event.id,opening_cents:100000,note:'Opening change',idempotency_key:randomUUID()};
  session=await api('pos_cash_open',p,ids.staff);assert.equal((await api('pos_cash_open',p,ids.staff)).id,session.id);
  assert.equal(session.expected_cents,100000);assert.equal(session.cash_collected_cents,0);
  assert.equal(await h.scalar('select count(*)::int from tlb.accounting_ledger'),ledger);
  await assert.rejects(action('pos_cash_open',{event_id:event.id,opening_cents:0},ids.owner),/already has/i);
  await assert.rejects(api('pos_cash_open',{...p,opening_cents:200000},ids.staff),/different request/i);
  await assert.rejects(api('pos_cash_open',p,ids.owner),/different request/i);
  assert.equal((await api('pos_register_find',{idempotency_key:p.idempotency_key},ids.staff)).id,session.id);
  assert.equal(await api('pos_register_find',{idempotency_key:p.idempotency_key},ids.owner),null);
  const other=await action('pos_cash_open',{event_id:another.id,opening_cents:0});
  await assert.rejects(create(request('cash',other.id)),/session changed/i);
 })();
 await check('Cash sessions: count cash net of change once and separate electronic payments',async()=>{
  const p=await submit(request());cashSale=await api('pos_create_order',p,ids.staff);
  assert.equal((await api('pos_create_order',p,ids.staff)).id,cashSale.id);
  assert.equal(cashSale.cash_session_id,session.id);assert.equal(cashSale.change_cents,7500);assert.equal(cashSale.payment_method_label,'Cash');
  await create(request('gcash'));await refresh();
  assert.equal(session.cash_collected_cents,12500);assert.equal(session.expected_cents,112500);
  assert.equal(session.payment_totals.find(m=>m.method==='gcash').amount_cents,12500);
  assert.equal(await h.scalar('select count(*)::int from tlb.pos_session_payments where order_id=$1',[cashSale.id]),1);
 })();
 await check('Cash sessions: movements require reasons, cannot overdraft, reject stale edits and retry once',async()=>{
  const p={session_id:session.id,revision:session.revision,kind:'cash_in',amount_cents:5000,note:'More small change',idempotency_key:randomUUID()};
  session=await api('pos_cash_move',p,ids.staff);await api('pos_cash_move',p,ids.staff);await refresh();assert.equal(session.expected_cents,117500);
  await assert.rejects(action('pos_cash_move',{...p,amount_cents:1000}),/drawer changed/i);
  const move={session_id:session.id,revision:session.revision,kind:'cash_out',amount_cents:3000,note:'Courier cash expense'};
  await assert.rejects(action('pos_cash_move',{...move,amount_cents:200000}),/exceed/i);
  await assert.rejects(action('pos_cash_move',{...move,note:''}),/reason/i);
  for(const amount_cents of [-1,0,1.5])await assert.rejects(action('pos_cash_move',{...move,amount_cents}));
  session=await action('pos_cash_move',move);assert.equal(session.expected_cents,114500);assert.equal(session.movements.length,2);
 })();
 await check('Cash sessions: void keeps physical cash; actual refund uses a cash-out movement',async()=>{
  await api('pos_void_sale',{order_id:cashSale.id,revision:cashSale.revision,idempotency_key:randomUUID(),reason:'Customer returned item',restore_stock:true},ids.owner);
  await refresh();assert.equal(session.expected_cents,114500);
  assert.equal(await h.scalar('select sum(amount_cents)::int from tlb.accounting_ledger where order_id=$1',[cashSale.id]),0);
  session=await action('pos_cash_move',{session_id:session.id,revision:session.revision,kind:'cash_out',amount_cents:12500,note:'Cash refund for '+cashSale.reference});
  assert.equal(session.expected_cents,102000);
 })();
 await check('Cash sessions: closing detects intervening sales and saves a permanent counted difference',async()=>{
  const stale={session_id:session.id,revision:session.revision,counted_cents:102000,note:''};
  secondCash=await create(request());await assert.rejects(action('pos_cash_close',stale),/drawer changed/i);await refresh();
  await assert.rejects(action('pos_cash_close',{...stale,revision:session.revision,counted_cents:114400}),/difference/i);
  const close={session_id:session.id,revision:session.revision,counted_cents:114400,note:'One peso short',idempotency_key:randomUUID()};
  session=await api('pos_cash_close',close,ids.staff);await api('pos_cash_close',close,ids.staff);assert.equal(session.difference_cents,-100);assert.equal(session.expected_at_close_cents,114500);
  await assert.rejects(action('pos_cash_move',{session_id:session.id,revision:session.revision,kind:'cash_in',amount_cents:100,note:'Late change'}),/open cash session/i);
  await assert.rejects(create(request()),/open a cash session/i);
  const oldId=session.id;session=await action('pos_cash_open',{event_id:event.id,opening_cents:50000});assert.notEqual(session.id,oldId);assert.equal(session.cash_collected_cents,0);
  await assert.rejects(create(request('cash',oldId)),/session changed/i);
  await api('pos_void_sale',{order_id:secondCash.id,revision:secondCash.revision,idempotency_key:randomUUID(),reason:'Later cancellation',restore_stock:false},ids.owner);
  const closed=await api('pos_cash_get',{session_id:oldId},ids.owner);assert.equal(closed.expected_cents,114500);assert.equal(closed.difference_cents,-100);assert.equal(session.expected_cents,50000);
 })();
 await check('POS payment methods: owner-only settings preserve Cash and never change website instructions',async()=>{
  config=(await api('pos_bootstrap',{},ids.owner)).register_config;
  const methods=[...config.methods,{id:customId,label:'Card terminal',active:true}];
  await assert.rejects(action('pos_payment_methods_save',{revision:config.revision,methods}),/owner/i);
  await assert.rejects(action('pos_payment_methods_save',{revision:config.revision,methods:methods.filter(m=>m.id!=='cash')},ids.owner),/keep cash/i);
  await assert.rejects(action('pos_payment_methods_save',{revision:config.revision,methods:[...methods,methods[1]]},ids.owner),/once/i);
  const p={revision:config.revision,methods,idempotency_key:randomUUID()};config=await api('pos_payment_methods_save',p,ids.owner);assert.deepEqual(await api('pos_payment_methods_save',p,ids.owner),config);
  await assert.rejects(action('pos_payment_methods_save',{revision:config.revision-1,methods},ids.owner),/changed/i);
  assert.deepEqual(await h.scalar('select data from tlb.settings where id'),settingsBefore);
  digitalSale=await create(request(customId));assert.equal(digitalSale.payment_method_label,'Card terminal');await refresh();assert.equal(session.expected_cents,50000);
  assert.equal(await h.scalar('select payment_method from tlb.accounting_rows_v2($1,$1) where order_id=$2 limit 1',[today,digitalSale.id]),'Card terminal');
 })();
 await check('POS payment methods: direct and later delivery payments support custom methods without event cash',async()=>{
  const p={source:'direct_message',method:'delivery',fulfillment_date:await h.day(30),override_dates:true,override_reason:'Confirmed DM date',delivery_fee_pending:true,items:[{name:'Custom cake',quantity:1,unit_price_cents:10000}],buyer:{},email_notifications:false,payment:{method:customId,amount_cents:10000}};
  let o=await create(p,ids.owner);assert.equal(o.payment_method_label,'Card terminal');assert.equal(await h.scalar('select count(*)::int from tlb.pos_session_payments where order_id=$1',[o.id]),0);
  o=await h.action('pos_delivery_fee',o,{amount_cents:1500,note:'Courier'});
  o=await h.action('pos_delivery_payment',o,{payment:{method:customId,amount_cents:1500}});assert.equal(o.delivery_payment_method_label,'Card terminal');
  const rows=(await db.query('select payment_method from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,o.id])).rows;assert.ok(rows.every(r=>r.payment_method==='Card terminal'));
 })();
 await check('POS payment methods: renaming/disabling keeps historical labels and blocks future use',async()=>{
  config=await action('pos_payment_methods_save',{revision:config.revision,methods:config.methods.map(m=>m.id===customId?{...m,label:'Card reader',active:false}:m)},ids.owner);
  await assert.rejects(create(request(customId)),/enabled POS payment method/i);
  assert.equal((await api('pos_order_link',{order_id:digitalSale.id},ids.owner)).payment_method_label,'Card terminal');
  await refresh();assert.equal(session.payment_totals.find(m=>m.method===customId).method_label,'Card terminal');
  assert.equal(await h.scalar('select payment_method from tlb.accounting_rows_v2($1,$1) where order_id=$2 limit 1',[today,digitalSale.id]),'Card terminal');
  await action('pos_payment_methods_save',{revision:config.revision,methods:baseConfig.methods},ids.owner);
 })();
 await check('Cash sessions: legacy checkout only stays compatible until the first drawer opens',async()=>{
  const e=await api('pos_save_event',{name:'Legacy checkout',starts_on:today,ends_on:today,stock:[{product_id:product.id,capacity:10,price_cents:12500}]},ids.owner);
  const p={...request(),event_id:e.id};delete p.payment.cash_session_id;
  const old=await create(p);assert.equal(old.cash_session_id,undefined);
  const drawer=await action('pos_cash_open',{event_id:e.id,opening_cents:12500});
  await assert.rejects(create(p),/session changed/i);
  await action('pos_cash_close',{session_id:drawer.id,revision:drawer.revision,counted_cents:12500});
  await assert.rejects(create(p),/open a cash session/i);
 })();
}
