import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.harness,{api,ids}=h,today=await h.day(0);
 const product=await h.product({name:'Lineup brownie',price_cents:10000,lead_days:0,option_groups:[{id:'flavor',label:'Flavor',required_count:2,choices:[{id:'choc',label:'Chocolate',surcharge_cents:500,active:true}]}]});
 const excluded=await h.product({name:'Not at this event'}),customId=randomUUID();
 const productCount=await h.scalar('select count(*)::int from tlb.products');
 let event,sale;
 const stock={product_id:product.id,capacity:8,price_cents:8000};
 const custom={id:customId,name:'Event cookie',description:'Event exclusive',capacity:6,price_cents:3500};
 const eventInput={name:'Curated event',starts_on:today,ends_on:today,stock:[stock],custom_stock:[custom]};
 const refresh=async()=>event=(await api('pos_bootstrap',{},ids.owner)).events.find(e=>e.id===event.id);
 const edit=extra=>api('pos_save_event',{...eventInput,id:event.id,revision:event.revision,...extra},ids.owner);
 const request=(items,extra={})=>({source:'popup',event_id:event.id,method:'pickup',fulfillment_date:today,items,buyer:{},email_notifications:false,discount:{kind:'none'},...extra});
 const customLine=(quantity=1)=>({custom_event_item_id:customId,quantity});
 const create=async payload=>{const quote=await api('pos_quote',payload,ids.staff);return api('pos_create_order',{...payload,expected_quote:quote,idempotency_key:randomUUID(),payment:{method:'cash',amount_cents:quote.total_cents,received_cents:quote.total_cents}},ids.staff)};
 await check('Event lineup: selected catalog and custom stock save without public products',async()=>{
  await assert.rejects(api('pos_save_event',eventInput,ids.staff),/owner/i);
  event=await api('pos_save_event',eventInput,ids.owner);
  assert.equal(event.stock.length,1);assert.equal(event.custom_stock[0].remaining,6);
  assert.equal(await h.scalar('select count(*)::int from tlb.products'),productCount);
  await assert.rejects(api('pos_quote',request([h.item(excluded)]),ids.staff),/not available at this event/i);
  for(const table of ['pos_custom_stock','pos_custom_allocations'])await assert.rejects(h.as(ids.staff,()=>db.query(`select * from tlb.${table}`)),/permission/i);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.pos_save_custom_stock(uuid,jsonb)','execute')"),false);
 })();
 await check('Event lineup: custom prices and names are authoritative and quantities aggregate',async()=>{
  const q=await api('pos_quote',request([{...customLine(),unit_price_cents:1,name:'Spoofed'}]),ids.staff);
  assert.equal(q.total_cents,3500);assert.equal(q.items[0].name,custom.name);assert.equal(q.items[0].product_id,null);
  await assert.rejects(api('pos_quote',request([customLine(4),{...customLine(3),custom_event_item_id:customId.toUpperCase()}]),ids.staff),/stock/i);
  await assert.rejects(api('pos_quote',request([{...customLine(),product_id:product.id}]),ids.staff),/only.*event/i);
  await assert.rejects(api('pos_quote',request([customLine()],{source:'direct_message',fulfillment_date:await h.day(30)}),ids.owner),/only.*event/i);
 })();
 await check('Event lineup: other events cannot sell or modify custom stock',async()=>{
  const other=await api('pos_save_event',{...eventInput,name:'Other event',custom_stock:[]},ids.owner);
  await assert.rejects(api('pos_quote',request([customLine()],{event_id:other.id}),ids.staff),/not available/i);
  await assert.rejects(api('pos_save_event',{...eventInput,id:other.id,revision:other.revision},ids.owner),/another event/i);
  await refresh();assert.equal(event.custom_stock[0].capacity,6);
 })();
 await check('Event lineup: mixed sale allocates both stock types once and posts full income',async()=>{
  const p=request([h.item(product,1,{flavor:{choc:2}}),customLine(2)]),q=await api('pos_quote',p,ids.staff);
  const submit={...p,expected_quote:q,idempotency_key:randomUUID(),payment:{method:'gcash',amount_cents:q.total_cents}};
  sale=await api('pos_create_order',submit,ids.staff);
  assert.equal((await api('pos_create_order',submit,ids.staff)).id,sale.id);
  assert.equal(sale.total_cents,16000);
  await refresh();assert.equal(event.stock[0].remaining,7);assert.equal(event.custom_stock[0].remaining,4);
  assert.deepEqual(await h.allocations(sale.id),[]);
  assert.equal(await h.scalar('select count(*)::int from tlb.pos_custom_allocations where order_id=$1',[sale.id]),1);
  assert.equal(await h.scalar('select sum(amount_cents)::int from tlb.accounting_ledger where order_id=$1',[sale.id]),16000);
 })();
 await check('Event lineup: removed products stop selling while history survives',async()=>{
  event=await edit({stock:[],custom_stock:[]});
  assert.equal(event.stock[0].active,false);assert.equal(event.custom_stock[0].active,false);
  await assert.rejects(api('pos_quote',request([customLine()]),ids.staff),/not available/i);
  const historic=await api('pos_order_link',{order_id:sale.id},ids.owner);
  assert.equal(historic.items[1].name,custom.name);
  event=await edit({custom_stock:[{...custom,name:'Renamed cookie',price_cents:4000}]});
  assert.equal(event.custom_stock[0].used,2);assert.equal(event.custom_stock[0].remaining,4);
  assert.equal((await api('pos_order_link',{order_id:sale.id},ids.owner)).items[1].name,custom.name);
 })();
 await check('Event lineup: stale edits, undersized stock, duplicate IDs and invalid prices roll back',async()=>{
  await assert.rejects(edit({revision:event.revision-1}),/changed/i);
  await assert.rejects(edit({custom_stock:[{...custom,capacity:1}]}),/below/i);
  await assert.rejects(edit({custom_stock:[custom,{...custom,id:customId.toUpperCase()}]}),/only once/i);
  for(const changes of [{capacity:1.5},{price_cents:-1},{name:''}])await assert.rejects(edit({custom_stock:[{...custom,...changes}]}));
  await refresh();assert.equal(event.custom_stock[0].price_cents,4000);
  const payload=request([customLine()]),quote=await api('pos_quote',payload,ids.staff);
  event=await edit();
  await assert.rejects(api('pos_create_order',{...payload,expected_quote:quote,idempotency_key:randomUUID(),payment:{method:'cash',amount_cents:4000,received_cents:4000}},ids.staff),/review/i);
 })();
 await check('Event lineup: old clients preserve custom stock; void restores both stock types',async()=>{
  const {custom_stock,...legacy}=eventInput;
  event=await api('pos_save_event',{...legacy,id:event.id,revision:event.revision},ids.owner);
  assert.equal(event.custom_stock[0].active,true);
  const payload={order_id:sale.id,revision:sale.revision,idempotency_key:randomUUID(),reason:'QA stock restore',restore_stock:true};
  await api('pos_void_sale',payload,ids.owner);await api('pos_void_sale',payload,ids.owner);
  await refresh();assert.equal(event.custom_stock[0].remaining,6);assert.equal(event.stock[0].remaining,8);
  const retained=await create(request([customLine()]));
  await api('pos_void_sale',{order_id:retained.id,revision:retained.revision,idempotency_key:randomUUID(),reason:'QA stock retained',restore_stock:false},ids.owner);
  await refresh();assert.equal(event.custom_stock[0].remaining,5);
 })();
 await check('Direct orders: catalog prices including options cannot be overridden',async()=>{
  const payload=request([{...h.item(product,1,{flavor:{choc:2}}),unit_price_cents:1}],{source:'direct_message',fulfillment_date:await h.day(30),override_dates:true,override_reason:'QA date selection'});
  const q=await api('pos_quote',payload,ids.owner);
  assert.equal(q.items[0].unit_price_cents,11000);
  const customQuote=await api('pos_quote',{...payload,items:[{name:'Custom cake',quantity:1,unit_price_cents:12345}]},ids.owner);
  assert.equal(customQuote.total_cents,12345);
 })();
}
