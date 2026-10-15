import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export default async function({db,check,state}) {
 const h=state.harness,{api,ids}=h,date=await h.day(45),today=await h.day(0);
 const settings=await h.scalar('select data from tlb.settings where id');
 await db.query("update tlb.settings set data=data||$1::jsonb where id",[JSON.stringify({paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[],nonproduction_dates:[],delivery_blocked_dates:[],cutoff_time:null})]);
 const groups=[{id:'flavor',label:'Flavor',required_count:1,choices:[{id:'vanilla',label:'Vanilla',surcharge_cents:0,active:true},{id:'coconut',label:'Coconut',surcharge_cents:4000,active:true}]}];
 const simple=await h.product({name:'POS minimum plain cookies',price_cents:20000,min_quantity:2});
 const flavored=await h.product({name:'POS minimum flavored cookies',price_cents:20000,min_quantity:2,option_groups:groups});
 const selections=p=>p.id===flavored.id?{flavor:{coconut:1}}:{};
 const line=(p,quantity=1)=>h.item(p,quantity,selections(p));
 const direct=(p,quantity=1)=>({source:'direct_message',method:'pickup',fulfillment_date:date,items:[line(p,quantity)],buyer:{},discount:{kind:'none'},email_notifications:false});
 const create=async(payload,paid=false)=>{
  const quote=await api('pos_quote',payload,ids.staff);
  return api('pos_create_order',{...payload,expected_quote:quote,idempotency_key:randomUUID(),...(paid?{payment:{method:'gcash',amount_cents:quote.total_cents}}:{})},ids.staff);
 };
 for(const p of [simple,flavored])await h.inventory(p,date,12);
 try {
  await check('POS minimum: one plain or flavored product quotes and saves as one at the server price',async()=>{
   for(const p of [simple,flavored]){
    const payload=direct(p),unit=p.id===flavored.id?24000:20000;
    payload.items[0].unit_price_cents=1;
    const quote=await api('pos_quote',payload,ids.staff);
    assert.equal(quote.items[0].quantity,1);assert.equal(quote.items[0].unit_price_cents,unit);assert.equal(quote.total_cents,unit);
    assert.equal(await h.remaining(p,date),12);
    const order=await create(payload,p.id===flavored.id);
    assert.equal(order.items[0].quantity,1);assert.equal(order.total_cents,unit);
    assert.deepEqual(order.items[0].selections,selections(p));
    assert.equal(await h.remaining(p,date),11);
    assert.deepEqual(await h.allocations(order.id),[{product_id:p.id,date,quantity:1,state:p.id===flavored.id?'committed':'held'}]);
   }
  })();
  await check('POS minimum: direct-order edits reduce plain and flavored products from two to one',async()=>{
   for(const p of [simple,flavored]){
    const paid=p.id===flavored.id,order=await create(direct(p,2),paid),beforeRemaining=await h.remaining(p,date);
    const payment=await h.scalar('select coalesce(jsonb_agg(to_jsonb(p)),\'[]\'::jsonb) from tlb.payments p where order_id=$1',[order.id]);
    const payload={...direct(p),order_id:order.id,revision:order.revision};
    const quote=await api('pos_preview_edit',payload,ids.staff);
    assert.equal(quote.items[0].quantity,1);assert.equal(quote.total_cents,paid?24000:20000);
    const edited=await api('pos_update_order',{...payload,expected_quote:quote,idempotency_key:randomUUID()},ids.staff);
    assert.equal(edited.id,order.id);assert.equal(edited.items[0].quantity,1);assert.equal(edited.total_cents,quote.total_cents);
    assert.equal(edited.payment_status,order.payment_status);assert.equal(edited.revision,order.revision+1);
    assert.equal(await h.remaining(p,date),beforeRemaining+1);
    assert.equal((await h.allocations(order.id))[0].quantity,1);
    assert.deepEqual(await h.scalar('select coalesce(jsonb_agg(to_jsonb(p)),\'[]\'::jsonb) from tlb.payments p where order_id=$1',[order.id]),payment);
   }
  })();
  await check('POS minimum: pop-up sales keep one unit, event prices and one-unit stock deductions',async()=>{
   const event=await api('pos_save_event',{name:'QA minimum policy pop-up',starts_on:today,ends_on:today,stock:[simple,flavored].map(p=>({product_id:p.id,capacity:3,price_cents:18000,active:true}))},ids.owner);
   for(const p of [simple,flavored]){
    const payload={...direct(p),source:'popup',event_id:event.id};
    const quote=await api('pos_quote',payload,ids.staff),unit=p.id===flavored.id?22000:18000;
    assert.equal(quote.items[0].quantity,1);assert.equal(quote.total_cents,unit);
    const order=await create(payload,true);
    assert.equal(order.items[0].quantity,1);assert.equal(order.total_cents,unit);assert.equal(order.fulfillment_status,'completed');
    assert.equal(await h.scalar('select quantity from tlb.pos_allocations where order_id=$1 and product_id=$2',[order.id,p.id]),1);
   }
   const refreshed=(await api('pos_bootstrap',{},ids.staff)).events.find(e=>e.id===event.id);
   assert.deepEqual(refreshed.stock.map(s=>s.remaining),[2,2]);
  })();
  await check('POS minimum: website quote and checkout still reject one unit for minimum-two products',async()=>{
   for(const p of [simple,flavored]){
    const payload=h.checkout(p,date,{items:[line(p)],source:'direct_message',override_dates:true});
    for(const action of ['quote','create_order'])await assert.rejects(api(action,payload),/Minimum quantity/i);
    const quote=await api('quote',{...payload,items:[line(p,2)]});
    assert.equal(quote.items[0].quantity,2);assert.equal(quote.total_cents,p.id===flavored.id?48000:40000);
   }
  })();
  await check('POS minimum: positive integers, exact flavor choices and aggregate stock remain enforced',async()=>{
   for(const quantity of [0,-1,1.5,10001])await assert.rejects(api('pos_quote',direct(simple,quantity),ids.staff),/quantity|whole/i);
   for(const selection of [{},{flavor:{coconut:2}},{flavor:{coconut:0.5}},{flavor:{unknown:1}}])await assert.rejects(api('pos_quote',{...direct(flavored),items:[h.item(flavored,1,selection)]},ids.staff),/exactly|whole|unknown/i);
   const remaining=await h.remaining(simple,date);
   await assert.rejects(api('pos_quote',{...direct(simple),items:[line(simple,remaining),{...line(simple),product_id:simple.id.toUpperCase()}]},ids.staff),/stock/i);
   await h.inventory(simple,date,12,false);
   await assert.rejects(api('pos_quote',direct(simple),ids.staff),/unavailable/i);
   await h.inventory(simple,date,12,true);
  })();
  await check('POS minimum: staff access, production dates and pickup restrictions remain enforced',async()=>{
   for(const user of [null,ids.customer,ids.unverified])await assert.rejects(api('pos_quote',direct(simple),user),/access|verify/i);
   await assert.rejects(api('pos_quote',{...direct(simple),fulfillment_date:today},ids.staff),/same-day|override/i);
   await db.query("update tlb.settings set data=jsonb_set(data,'{blocked_dates}',$1::jsonb) where id",[JSON.stringify([date])]);
   await assert.rejects(api('pos_quote',direct(simple),ids.staff),/closed/i);
   await db.query("update tlb.settings set data=jsonb_set(data,'{blocked_dates}','[]'::jsonb) where id");
   const pickupOnly=await h.product({name:'POS minimum pickup-only',min_quantity:2,pickup_only:true});
   await assert.rejects(api('pos_quote',{...direct(pickupOnly),method:'delivery'},ids.staff),/pickup only/i);
   for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.pos_quote(jsonb,uuid,uuid)','EXECUTE')",[role]),false);
  })();
  await check('POS minimum: migration replay preserves the function and website minimum policy',async()=>{
   const definition=await h.scalar("select pg_get_functiondef('tlb.pos_quote(jsonb,uuid,uuid)'::regprocedure)");
   const migration=await readFile(new URL('../../supabase/migrations/20261015081448_pos_ignore_product_minimum.sql',import.meta.url),'utf8');
   await db.exec(migration);
   assert.equal(await h.scalar("select pg_get_functiondef('tlb.pos_quote(jsonb,uuid,uuid)'::regprocedure)"),definition);
   assert.equal((await api('pos_quote',direct(simple),ids.staff)).items[0].quantity,1);
   await assert.rejects(api('quote',h.checkout(simple,date)),/Minimum quantity/i);
  })();
 } finally {
  await db.query('update tlb.settings set data=$1::jsonb where id',[JSON.stringify(settings)]);
 }
}
