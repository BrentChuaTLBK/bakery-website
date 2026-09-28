import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.harness, {api,ids}=h;
 const today=await h.day(0), date=await h.day(30);
 const oldSettings=await h.scalar('select data from tlb.settings where id');
 await db.query("update tlb.settings set data=data||$1::jsonb where id",[JSON.stringify({production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],nonproduction_dates:[],delivery_blocked_dates:[],cutoff_time:null})]);
 const product=await h.product({name:'POS fixture',price_cents:10000,lead_days:1});
 await h.inventory(product,date,10);
 let event, sale, dm;
 const eventDraft={name:'QA event',location:'QA booth',starts_on:today,ends_on:today,stock:[{product_id:product.id,capacity:5,price_cents:8000,active:true}]};
 const request=(source,extra={})=>({source,event_id:event?.id,fulfillment_date:date,method:'pickup',items:[h.item(product)],buyer:{name:'QA POS',phone:'09171234567',email:''},discount:{kind:'none'},email_notifications:false,...extra});
 const create=async p=>{const q=await api('pos_quote',p,ids.owner);return api('pos_create_order',{...p,expected_quote:q,idempotency_key:randomUUID()},ids.owner)};
 const pay=(amount,method='cash',received=amount)=>({method,amount_cents:amount,received_cents:received});
 await check('POS: only verified staff can view or quote; owners manage events',async()=>{
  for(const u of [null,ids.customer,ids.unverified]) await assert.rejects(api('pos_bootstrap',{},u),/access|verify/i);
  await assert.rejects(api('pos_save_event',eventDraft,ids.staff),/owner/i);
  event=await api('pos_save_event',eventDraft,ids.owner);
  assert.equal(event.stock[0].remaining,5);
  assert.equal((await api('pos_bootstrap',{},ids.staff)).events.some(e=>e.id===event.id),true);
  await assert.rejects(h.as(ids.staff,()=>db.query('select * from tlb.pos_stock')),/permission/i);
 })();
 await check('POS: cash sale uses event prices and stock, with full payment and change',async()=>{
  sale=await create(request('popup',{items:[h.item(product,2)],discount:{kind:'percent',value:10},payment:pay(14400,'cash',20000)}));
  assert.equal(sale.total_cents,14400); assert.equal(sale.change_cents,5600);
  assert.equal(sale.payment_status,'paid');assert.equal(sale.fulfillment_status,'completed');
  assert.equal(sale.source,'popup'); assert.equal(await h.remaining(product,date),10);
  assert.equal((await api('pos_bootstrap',{},ids.owner)).events.find(e=>e.id===event.id).stock[0].remaining,3);
  assert.equal(await h.scalar('select count(*)::int from tlb.outbox where order_id=$1',[sale.id]),0);
  assert.equal(await h.scalar('select amount_cents from tlb.payments where order_id=$1',[sale.id]),14400);
 })();
 await check('POS: public secure links require the exact order token',async()=>{
  await assert.rejects(api('get_order',{order_id:sale.id}),/access|authorized/i);
  const publicOrder=await api('get_order',{order_id:sale.id},null,sale.access_token);
  assert.equal(publicOrder.total_cents,14400);
  assert.equal('created_by' in publicOrder,false);assert.equal('override_reason' in publicOrder,false);
  await assert.rejects(api('pos_order_link',{order_id:sale.id},ids.customer),/access/i);
 })();
 await check('POS: insufficient stock, short cash, partial and unknown payments roll back',async()=>{
  await assert.rejects(create(request('popup',{items:[h.item(product,4)],payment:pay(32000)})),/stock/i);
  await assert.rejects(create(request('popup',{payment:pay(8000,'cash',7000)})),/cash/i);
  await assert.rejects(create(request('popup',{payment:pay(7000)})),/full payment/i);
  await assert.rejects(create(request('popup',{payment:pay(8000,'other')})),/choose cash/i);
  await assert.rejects(create(request('popup')),/full payment/i);
  assert.equal((await api('pos_bootstrap',{},ids.owner)).events.find(e=>e.id===event.id).stock[0].remaining,3);
 })();
 await check('POS: repeated submissions create one sale and one accounting posting',async()=>{
  const p=request('popup',{payment:pay(8000,'gcash')});p.expected_quote=await api('pos_quote',p,ids.owner);p.idempotency_key=randomUUID();
  const a=await api('pos_create_order',p,ids.owner),b=await api('pos_create_order',p,ids.owner);
  assert.equal(a.id,b.id);
  await assert.rejects(api('pos_create_order',{...p,buyer:{name:'Changed'}},ids.owner),/different sale/i);
  assert.equal(await h.scalar('select count(*)::int from tlb.payments where order_id=$1',[a.id]),1);
  assert.equal(await h.scalar('select sum(amount_cents)::int from tlb.accounting_ledger l join tlb.accounting_categories c on c.id=l.category_id where order_id=$1 and c.system_key=\'pos_popup\'',[a.id]),8000);
 })();
 await check('POS: stale quotes and event edits cannot silently change prices or oversell',async()=>{
  const p=request('popup',{payment:pay(8000)});p.expected_quote=await api('pos_quote',p,ids.owner);p.idempotency_key=randomUUID();
  await assert.rejects(api('pos_save_event',{...eventDraft,id:event.id,revision:event.revision,stock:[{product_id:product.id,capacity:1,price_cents:8000}]},ids.owner),/below/i);
  event=await api('pos_save_event',{...eventDraft,id:event.id,revision:event.revision,stock:[{product_id:product.id,capacity:5,price_cents:8500}]},ids.owner);
  await assert.rejects(api('pos_create_order',p,ids.owner),/review/i);
  await assert.rejects(api('pos_save_event',{...eventDraft,id:event.id,revision:1},ids.owner),/changed/i);
 })();
 await check('POS: DM catalog plus custom items, manual fee and discount have correct totals',async()=>{
  dm=await create(request('direct_message',{method:'delivery',delivery_cents:1000,address:{line1:'123 QA Street'},recipient:{name:'QA Recipient',phone:'09171234567'},items:[h.item(product,2),{name:'Custom cake',description:'Blue design',quantity:1,unit_price_cents:20000}],discount:{kind:'fixed',value:500}}));
  assert.equal(dm.total_cents,40500);assert.equal(dm.payment_deadline,null);assert.equal(dm.items[1].custom,true);
  assert.equal(await h.remaining(product,date),8);
  assert.equal((await h.allocations(dm.id)).length,1);
  await db.query("update tlb.orders set created_at=clock_timestamp()-interval '3 days' where id=$1",[dm.id]);
  await api('catalog');assert.equal((await h.order(dm.id)).fulfillment_status,'pending_confirmation');
  const submitted=await h.proof(dm);assert.equal(submitted.payment_status,'under_review');
 })();
 await check('POS: recording DM full payment commits stock and writes channel accounting once',async()=>{
  dm=await h.order(dm.id);
  const p={order_id:dm.id,revision:dm.revision,idempotency_key:randomUUID(),payment:pay(40500,'bdo')};
  dm=await api('pos_payment',p,ids.staff);assert.equal(dm.payment_status,'paid');assert.equal(dm.payment_method,'bdo');
  assert.equal((await api('pos_payment',p,ids.staff)).revision,dm.revision);
  assert.equal((await h.allocations(dm.id))[0].state,'committed');
  const rows=(await db.query('select * from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,dm.id])).rows;
  assert.equal(rows.length,3); assert(rows.every(r=>r.source==='Direct message'&&r.payment_method==='bdo'));
 })();
 await check('POS: owner date override requires a reason; does not bypass stock or pickup-only',async()=>{
  const p=request('direct_message',{fulfillment_date:today,override_dates:true,override_reason:'Agreed with customer'});
  await assert.rejects(api('pos_quote',p,ids.staff),/owner/i);
  await assert.rejects(api('pos_quote',{...p,override_reason:''},ids.owner),/explain/i);
  assert.equal((await api('pos_quote',p,ids.owner)).fulfillment_date,today);
  await h.inventory(product,today,0);
  await assert.rejects(api('pos_quote',p,ids.owner),/stock/i);
  await h.inventory(product,today,10,false);
  await assert.rejects(api('pos_quote',p,ids.owner),/unavailable/i);
 })();
 await check('POS: unpaid cancellation releases reserved stock; email is opt-in',async()=>{
  const p=request('direct_message',{email_notifications:true,buyer:{name:'QA POS',phone:'09171234567',email:'pos@example.test'}});
  const o=await create(p);assert.equal(await h.remaining(product,date),7);
  assert.equal(await h.scalar('select count(*)::int from tlb.outbox where order_id=$1',[o.id]),1);
  await h.action('cancel_order',o,{reason:'QA cancellation'});assert.equal(await h.remaining(product,date),8);
  await assert.rejects(create({...p,buyer:{name:'QA',phone:'12345',email:''}}),/email/i);
 })();
 await check('POS: owner void restores event stock only by explicit choice and reverses sales',async()=>{
  const p={order_id:sale.id,revision:sale.revision,idempotency_key:randomUUID(),reason:'Sale entered twice',restore_stock:true};
  await assert.rejects(api('pos_void_sale',p,ids.staff),/owner/i);
  sale=await api('pos_void_sale',p,ids.owner);assert.equal(sale.fulfillment_status,'cancelled');
  await api('pos_void_sale',p,ids.owner);
  assert.equal((await api('pos_bootstrap',{},ids.owner)).events.find(e=>e.id===event.id).stock[0].remaining,4);
  assert.equal(await h.scalar('select count(*)::int from tlb.accounting_rows_v2($1,$1) where order_id=$2',[today,sale.id]),0);
 })();
 await check('POS: negative/fractional money, discounts and quantities are rejected',async()=>{
  for(const items of [[h.item(product,1.5)],[{name:'Custom',quantity:1,unit_price_cents:-1}],[h.item(product,0)]]) await assert.rejects(api('pos_quote',request('direct_message',{items}),ids.owner));
  for(const discount of [{kind:'percent',value:101},{kind:'fixed',value:10001}]) await assert.rejects(api('pos_quote',request('direct_message',{discount}),ids.owner),/discount/i);
 })();
 await check('POS: every DM client field is optional; later details preserve stock and payment',async()=>{
  const o=await create(request('direct_message',{buyer:{},method:'delivery',delivery_cents:0,address:{},recipient:{},items:[{name:'Custom order',quantity:1,unit_price_cents:10000}]}));
  assert.equal(o.buyer.name,'');assert.equal(o.buyer.email,'');assert.equal(o.payment_deadline,null);
  assert.deepEqual(await h.allocations(o.id),[],'Custom-only orders never reserve catalog inventory');
  assert.equal(await h.scalar('select count(*)::int from tlb.outbox where order_id=$1',[o.id]),0);
  const p={order_id:o.id,revision:o.revision,idempotency_key:randomUUID(),buyer:{name:'Later name',social_platform:'Instagram',social_username:'@client'},address:{line1:'Later address'},recipient:{},email_notifications:false};
  const edited=await api('pos_update_details',p,ids.staff);
  assert.equal(edited.buyer.social_username,'@client');assert.equal(edited.total_cents,o.total_cents);assert.equal(edited.payment_status,'awaiting_payment');assert.equal(edited.payment_deadline,null);
  assert.equal((await api('pos_update_details',p,ids.staff)).revision,edited.revision);
 })();
 await check('POS: catalog option counts and event surcharges are checked on the server',async()=>{
  const p=await h.product({option_groups:[{id:'flavor',label:'Flavor',required_count:2,choices:[{id:'choc',label:'Chocolate',surcharge_cents:500,active:true}]}]});
  const e=await api('pos_save_event',{...eventDraft,name:'Options event',stock:[{product_id:p.id,capacity:2,price_cents:7000}]},ids.owner);
  const payload=request('popup',{event_id:e.id,items:[h.item(p,1,{flavor:{choc:2}})]});
  assert.equal((await api('pos_quote',payload,ids.staff)).total_cents,8000);
  await assert.rejects(api('pos_quote',{...payload,items:[h.item(p,1,{flavor:{choc:1}})]},ids.staff),/exactly 2/i);
  await assert.rejects(api('pos_quote',{...payload,items:[h.item(p,1,{flavor:{unknown:2}})]},ids.staff),/unknown/i);
  await api('pos_save_event',{...eventDraft,id:e.id,revision:e.revision,name:'Options event',closed:true,stock:e.stock},ids.owner);
  await assert.rejects(api('pos_quote',payload,ids.owner),/open pop-up/i);
 })();
 await check('POS: optional email sends only to the saved client and disabling it clears unattempted messages',async()=>{
  let o=await create(request('direct_message',{items:[{name:'Custom',quantity:1,unit_price_cents:10000}],buyer:{email:'pos@example.test'},email_notifications:true}));
  const queued=await h.scalar('select payload from tlb.outbox where order_id=$1',[o.id]);assert.equal(queued.order.payment_deadline,null);
  assert.equal(queued.order.buyer.email,'pos@example.test');
  const retryKey=randomUUID();o=await api('pos_update_details',{order_id:o.id,revision:o.revision,idempotency_key:retryKey,buyer:{},email_notifications:false},ids.owner);
  assert.equal(await h.scalar("select count(*)::int from tlb.outbox where order_id=$1 and status='pending'",[o.id]),0);
  assert.equal((await api('pos_order_link',{order_id:o.id},ids.staff)).access_token.length,64);
 })();
 await db.query('update tlb.settings set data=$1::jsonb where id',[JSON.stringify(oldSettings)]);
}
