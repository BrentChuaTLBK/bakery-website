import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}){
 const h=state.harness,{api,ids}=h,today=await h.day(0),cid=randomUUID(),choc='event-'+randomUUID(),ube='event-'+randomUUID(),spare='event-'+randomUUID();
 const flavor=(id,label,capacity,surcharge_cents=0)=>({id,label,capacity,surcharge_cents,active:true});
 const custom={id:cid,name:'Custom cookie',description:'Event only',capacity:5,price_cents:14000,options_tracked:true,option_groups:[{id:'flavor',label:'Flavor',required_count:1,choices:[flavor(choc,'Chocolate',3),flavor(ube,'Ube',2,1000),flavor(spare,'Spare',0)]}]};
 const setup={name:'Custom flavors',starts_on:today,ends_on:today,stock:[],custom_stock:[custom]};
 let event,sale;const productCount=await h.scalar('select count(*)::int from tlb.products');
 const refresh=async()=>event=(await api('pos_bootstrap',{},ids.owner)).events.find(e=>e.id===event.id);
 const item=()=>event.custom_stock[0],choice=id=>item().option_groups[0].choices.find(c=>c.id===id);
 const edit=(s=custom)=>api('pos_save_event',{...setup,id:event.id,revision:event.revision,custom_stock:[s]},ids.owner);
 const line=(id,quantity=1)=>({custom_event_item_id:cid,quantity,selections:{flavor:{[id]:1}}});
 const payload=items=>({source:'popup',event_id:event.id,method:'pickup',fulfillment_date:today,items,buyer:{},email_notifications:false,discount:{kind:'none'}});
 const submit=async items=>{const p=payload(items),q=await api('pos_quote',p,ids.staff);return {...p,expected_quote:q,idempotency_key:randomUUID(),payment:{method:'gcash',amount_cents:q.total_cents}}};
 await check('Custom flavors: owner adds event-only flavors with computed stock and private helpers',async()=>{
  await assert.rejects(api('pos_save_event',setup,ids.staff),/owner/i);event=await api('pos_save_event',setup,ids.owner);
  assert.equal(item().capacity,5);assert.equal(item().options_tracked,true);assert.equal(choice(ube).remaining,2);
  assert.equal(await h.scalar('select count(*)::int from tlb.products'),productCount);
  for(const signature of ['pos_custom_flavor_usage(uuid,uuid)','pos_custom_options(uuid,uuid)'])assert.equal(await h.scalar(`select has_function_privilege('authenticated','tlb.${signature}','execute')`),false);
  const removed=structuredClone(custom);removed.option_groups[0].choices.pop();event=await edit(removed);assert.equal(choice(spare),undefined);event=await edit();
 })();
 await check('Custom flavors: exact choices, authoritative price and labels are enforced',async()=>{
  const q=await api('pos_quote',payload([{...line(ube),unit_price_cents:1,name:'Forged'}]),ids.staff);
  assert.equal(q.total_cents,15000);assert.equal(q.items[0].name,'Custom cookie');assert.equal(q.items[0].selection_labels[0].label,'Ube');
  for(const selections of [{},{flavor:{}},{flavor:{[ube]:2}},{flavor:{[ube]:0.5}},{flavor:{missing:1}},{other:{[ube]:1}}])await assert.rejects(api('pos_quote',payload([{...line(ube),selections}]),ids.staff),/exactly|whole|unknown/i);
  const disabled=structuredClone(custom);disabled.option_groups[0].choices[1].active=false;event=await edit(disabled);
  await assert.rejects(api('pos_quote',payload([line(ube)]),ids.staff),/unavailable/i);event=await edit();
 })();
 await check('Custom flavors: quantities aggregate across lines and stock updates once',async()=>{
  await assert.rejects(api('pos_quote',payload([line(ube,2),{...line(ube),custom_event_item_id:cid.toUpperCase()}]),ids.staff),/stock for Ube/i);
  const request=await submit([line(ube,2),line(choc)]);sale=await api('pos_create_order',request,ids.staff);
  assert.equal((await api('pos_create_order',request,ids.staff)).id,sale.id);assert.equal(sale.total_cents,44000);
  await refresh();assert.equal(item().remaining,2);assert.equal(choice(ube).used,2);assert.equal(choice(choc).remaining,2);
  assert.equal(await h.scalar('select quantity from tlb.pos_custom_allocations where order_id=$1',[sale.id]),3);
  assert.equal(await h.scalar('select sum(amount_cents)::int from tlb.accounting_ledger where order_id=$1',[sale.id]),44000);
  assert.deepEqual(await h.allocations(sale.id),[]);
 })();
 await check('Custom flavors: invalid edits preserve used stock and older clients cannot erase options',async()=>{
  const missing=structuredClone(custom);missing.option_groups[0].choices.splice(1,1);await assert.rejects(edit(missing),/keep flavors/i);
  for(const changes of [{capacity:1},{capacity:-1},{capacity:1.5},{label:''},{surcharge_cents:-1}]){const s=structuredClone(custom);Object.assign(s.option_groups[0].choices[1],changes);await assert.rejects(edit(s))}
  const duplicate=structuredClone(custom);duplicate.option_groups[0].choices[1].label='Chocolate';await assert.rejects(edit(duplicate),/different names/i);
  const {options_tracked,option_groups,...legacy}=custom;event=await edit({...legacy,capacity:1000});assert.equal(item().capacity,5);assert.equal(item().options_tracked,true);assert.equal(choice(ube).used,2);
 })();
 await check('Custom flavors: restore and no-restock voids preserve choices and historical receipts',async()=>{
  const restore={order_id:sale.id,revision:sale.revision,idempotency_key:randomUUID(),reason:'QA restore custom flavors',restore_stock:true};
  await api('pos_void_sale',restore,ids.owner);await api('pos_void_sale',restore,ids.owner);await refresh();assert.equal(choice(ube).remaining,2);assert.equal(item().remaining,5);
  const renamed=structuredClone(custom);renamed.option_groups[0].choices[1].label='Purple cookie';event=await edit(renamed);
  assert.equal((await api('pos_order_link',{order_id:sale.id},ids.owner)).items[0].selection_labels[0].label,'Ube');
  const retained=await api('pos_create_order',await submit([line(ube)]),ids.staff);
  await api('pos_void_sale',{order_id:retained.id,revision:retained.revision,idempotency_key:randomUUID(),reason:'QA retain custom flavors',restore_stock:false},ids.owner);
  await refresh();assert.equal(choice(ube).used,1);assert.equal(choice(ube).remaining,1);
 })();
 await check('Custom flavors: two reviewed sales cannot both claim the last flavor',async()=>{
  const a=await submit([line(ube)]),b=await submit([line(ube)]);await api('pos_create_order',a,ids.staff);
  await assert.rejects(api('pos_create_order',b,ids.staff),/stock/i);await refresh();assert.equal(choice(ube).remaining,0);
 })();
 await check('Custom flavors: tracking after earlier plain sales preserves previous units',async()=>{
  const plainId=randomUUID(),plain={id:plainId,name:'Previously plain',capacity:8,price_cents:10000};
  let e=await api('pos_save_event',{...setup,custom_stock:[plain]},ids.owner);
  const p={...payload([{custom_event_item_id:plainId,quantity:2}]),event_id:e.id},q=await api('pos_quote',p,ids.staff);
  await api('pos_create_order',{...p,expected_quote:q,idempotency_key:randomUUID(),payment:{method:'gcash',amount_cents:q.total_cents}},ids.staff);
  const tracked={...plain,options_tracked:true,option_groups:[{id:'flavor',required_count:1,choices:[flavor(choc,'New chocolate stock',3)]}]};
  e=await api('pos_save_event',{...setup,id:e.id,revision:e.revision,custom_stock:[tracked]},ids.owner);
  assert.equal(e.custom_stock[0].capacity,5);assert.equal(e.custom_stock[0].remaining,3);assert.equal(e.custom_stock[0].unassigned_used,2);
  assert.equal(e.custom_stock[0].option_groups[0].choices[0].used,0);
 })();
}
