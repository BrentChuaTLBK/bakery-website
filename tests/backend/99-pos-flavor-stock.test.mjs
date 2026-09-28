import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.harness,{api,ids}=h,today=await h.day(0),extraId='event-'+randomUUID();
 const groups=[{id:'flavor',label:'Flavor',required_count:2,choices:[{id:'choc',label:'Chocolate',surcharge_cents:500,active:true},{id:'vanilla',label:'Vanilla',surcharge_cents:0,active:true}]}];
 const product=await h.product({name:'Flavor stock box',price_cents:10000,lead_days:0,option_groups:groups});
 const extra={id:extraId,label:'Ube',surcharge_cents:1000,active:true,capacity:3};
 const options=[{...groups[0],choices:[{...groups[0].choices[0],capacity:5},{...groups[0].choices[1],capacity:4},extra]}];
 const stock={product_id:product.id,capacity:20,price_cents:8000,options_tracked:true,option_groups:options};
 const input={name:'Flavor pop-up',starts_on:today,ends_on:today,stock:[stock]};
 let event,sale;
 const refresh=async()=>event=(await api('pos_bootstrap',{},ids.owner)).events.find(e=>e.id===event.id);
 const edit=(s=stock)=>api('pos_save_event',{...input,id:event.id,revision:event.revision,stock:[s]},ids.owner);
 const choice=(id)=>event.stock[0].option_groups[0].choices.find(c=>c.id===id);
 const line=(selections,qty=1)=>h.item(product,qty,{flavor:selections});
 const payload=(items,extra={})=>({source:'popup',event_id:event.id,method:'pickup',fulfillment_date:today,items,buyer:{},discount:{kind:'none'},email_notifications:false,...extra});
 const create=async p=>{const q=await api('pos_quote',p,ids.staff),req={...p,expected_quote:q,idempotency_key:randomUUID(),payment:{method:'cash',amount_cents:q.total_cents,received_cents:q.total_cents}};return {order:await api('pos_create_order',req,ids.staff),req}};
 await check('Event flavors: owner configures stock and event-only choices without changing the catalog',async()=>{
  await assert.rejects(api('pos_save_event',input,ids.staff),/owner/i);
  event=await api('pos_save_event',input,ids.owner);
  assert.equal(event.stock[0].options_tracked,true);assert.equal(choice('choc').remaining,5);assert.equal(choice(extraId).custom,true);
  assert.deepEqual(await h.scalar("select data->'option_groups' from tlb.products where id=$1",[product.id]),groups);
  for(const signature of ['pos_flavor_usage(uuid,uuid)','pos_event_options(uuid,uuid)','pos_save_flavor_stock(uuid,jsonb)','pos_check_flavor_stock(uuid,jsonb)'])assert.equal(await h.scalar(`select has_function_privilege('authenticated','tlb.${signature}','execute')`),false);
 })();
 await check('Event flavors: quote uses authoritative event labels, surcharges and exact choice counts',async()=>{
  const q=await api('pos_quote',payload([{...line({[extraId]:2}),unit_price_cents:1}]),ids.staff);
  assert.equal(q.total_cents,10000);assert.equal(q.items[0].selection_labels[0].label,'Ube');
  await assert.rejects(api('pos_quote',payload([line({[extraId]:1})]),ids.staff),/exactly 2/i);
  await assert.rejects(api('pos_quote',payload([line({unknown:2})]),ids.staff),/unknown/i);
  await assert.rejects(api('pos_quote',payload([line({choc:1.5,vanilla:0.5})]),ids.staff),/whole/i);
  await assert.rejects(api('pos_quote',payload([line({[extraId]:2})],{source:'direct_message',fulfillment_date:await h.day(30),override_dates:true,override_reason:'QA event flavor'}),ids.owner),/unknown/i);
  const other=await api('pos_save_event',{...input,stock:[{product_id:product.id,capacity:10,price_cents:8000}]},ids.owner);
  await assert.rejects(api('pos_quote',payload([line({[extraId]:2})],{event_id:other.id}),ids.staff),/unknown/i);
 })();
 await check('Event flavors: repeated lines and multi-choice packs cannot oversell a flavor',async()=>{
  await assert.rejects(api('pos_quote',payload([line({choc:2},3)]),ids.staff),/stock for Chocolate/i);
  await assert.rejects(api('pos_quote',payload([line({choc:2},2),{...line({choc:2}),product_id:product.id.toUpperCase()}]),ids.staff),/stock for Chocolate/i);
  const p=payload([line({choc:1,[extraId]:1},2)]),created=await create(p);sale=created.order;
  assert.equal((await api('pos_create_order',created.req,ids.staff)).id,sale.id);
  await refresh();assert.equal(choice('choc').used,2);assert.equal(choice('choc').remaining,3);assert.equal(choice(extraId).remaining,1);assert.equal(event.stock[0].remaining,18);
  await assert.rejects(api('pos_quote',payload([line({[extraId]:2})]),ids.staff),/stock for Ube/i);
  assert.deepEqual(await h.allocations(sale.id),[]);
 })();
 await check('Event flavors: invalid edits roll back and cannot rewrite catalog option prices or requirements',async()=>{
  const changed=structuredClone(stock);changed.option_groups[0].required_count=1;changed.option_groups[0].choices[0].surcharge_cents=1;changed.option_groups[0].choices[0].label='Forged label';
  event=await edit(changed);assert.equal(event.stock[0].option_groups[0].required_count,2);assert.equal(choice('choc').surcharge_cents,500);assert.equal(choice('choc').label,'Chocolate');
  for(const changes of [{capacity:1},{capacity:-1},{capacity:1.5}]){const s=structuredClone(stock);Object.assign(s.option_groups[0].choices[0],changes);await assert.rejects(edit(s),/stock/i)}
  const missing=structuredClone(stock);missing.option_groups[0].choices.pop();await assert.rejects(edit(missing),/keep existing/i);
  const duplicate=structuredClone(stock);duplicate.option_groups[0].choices.push(extra);await assert.rejects(edit(duplicate),/once/i);
  const unknown=structuredClone(stock);unknown.option_groups[0].id='unknown';await assert.rejects(edit(unknown),/unknown/i);
  const blank=structuredClone(stock);blank.option_groups[0].choices[2].label='';await assert.rejects(edit(blank),/flavor name/i);
  const name=structuredClone(stock);name.option_groups[0].choices[2].label='Chocolate';await assert.rejects(edit(name),/different names/i);
  await refresh();assert.equal(choice('choc').capacity,5);
 })();
 await check('Event flavors: disabled flavors, stale reviews and old clients keep history and stock safe',async()=>{
  const p=payload([line({choc:2})]),q=await api('pos_quote',p,ids.staff);
  const s=structuredClone(stock);s.option_groups[0].choices[0].active=false;event=await edit(s);
  await assert.rejects(api('pos_quote',p,ids.staff),/unavailable/i);
  event=await edit();
  await assert.rejects(api('pos_create_order',{...p,expected_quote:q,idempotency_key:randomUUID(),payment:{method:'cash',amount_cents:q.total_cents,received_cents:q.total_cents}},ids.staff),/review/i);
  const {options_tracked,option_groups,...legacy}=stock;event=await edit(legacy);assert.equal(event.stock[0].options_tracked,true);assert.equal(choice(extraId).remaining,1);
  event=await api('pos_save_event',{...input,id:event.id,revision:event.revision,stock:[]},ids.owner);assert.equal(event.stock[0].active,false);
  await assert.rejects(api('pos_quote',p,ids.staff),/not available/i);event=await edit();assert.equal(choice('choc').used,2);
 })();
 await check('Event flavors: restore-stock void restores each selected flavor exactly once',async()=>{
  const p={order_id:sale.id,revision:sale.revision,idempotency_key:randomUUID(),reason:'QA flavor restore',restore_stock:true};
  await api('pos_void_sale',p,ids.owner);await api('pos_void_sale',p,ids.owner);await refresh();assert.equal(choice('choc').used,0);assert.equal(choice(extraId).remaining,3);
  const retained=(await create(payload([line({[extraId]:2})]))).order;
  await api('pos_void_sale',{order_id:retained.id,revision:retained.revision,idempotency_key:randomUUID(),reason:'QA stock retained',restore_stock:false},ids.owner);
  await refresh();assert.equal(choice(extraId).remaining,1);
  const renamed=structuredClone(stock);renamed.option_groups[0].choices[2].label='Purple yam';event=await edit(renamed);
  assert.equal((await api('pos_order_link',{order_id:retained.id},ids.owner)).items[0].selection_labels[0].label,'Ube');
 })();
 await check('Event flavors: turning tracking on counts earlier sales and preserves legacy round trips',async()=>{
  const legacy={product_id:product.id,capacity:10,price_cents:8000};event=await api('pos_save_event',{...input,stock:[legacy]},ids.owner);
  assert.equal(event.stock[0].options_tracked,false);await create(payload([line({choc:2})]));await refresh();assert.equal(choice('choc').used,2);
  event=await edit(event.stock[0]);assert.equal(event.stock[0].options_tracked,false);
  const low=structuredClone(stock);low.option_groups[0].choices[0].capacity=1;await assert.rejects(edit(low),/below/i);
  event=await edit();assert.equal(choice('choc').remaining,3);
  event=await edit({...stock,capacity:3});
  await assert.rejects(api('pos_quote',payload([line({vanilla:2}),{...line({vanilla:2},2),product_id:product.id.toUpperCase()}]),ids.staff),/stock/i);
 })();
 await check('Event flavors: two reviewed sales cannot both claim the last flavor units',async()=>{
  const s=structuredClone(stock);s.option_groups[0].choices[0].capacity=2;
  event=await api('pos_save_event',{...input,stock:[s]},ids.owner);
  const p=payload([line({choc:2})]),q=await api('pos_quote',p,ids.staff),before=await h.scalar('select count(*)::int from tlb.orders');
  const submit={...p,expected_quote:q,idempotency_key:randomUUID(),payment:{method:'gcash',amount_cents:q.total_cents}};
  await api('pos_create_order',submit,ids.staff);
  await assert.rejects(api('pos_create_order',{...submit,idempotency_key:randomUUID()},ids.staff),/stock for Chocolate/i);
  assert.equal(await h.scalar('select count(*)::int from tlb.orders'),before+1);await refresh();assert.equal(choice('choc').remaining,0);
 })();
}
