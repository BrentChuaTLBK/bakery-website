import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';

export default async function({db,check}){
 const h=await makeHarness(db),{owner,customer}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 const link=(id,extra={})=>({ingredient_id:id,source_quantity:'1',source_unit:'pcs',yield_quantity:'40',yield_unit:'g',...extra});
 const create=(name,data={},price)=>api('save_resource',{kind:'ingredient',name,data,...price?{price}:{}});
 const edit=(r,data,extra={})=>api('save_resource',{kind:'ingredient',id:r.id,revision:r.revision,name:r.name,data,...extra});
 const find=async id=>(await api('resources',{kind:'ingredient',include_inactive:true,limit:100})).rows.find(r=>r.id===id);
 const close=(a,b)=>assert.ok(Math.abs(Number(a)-b)<1e-9,`${a} ≈ ${b}`);
 let lemon,juice,recipe,supplier;
 const cost=async(source='current')=>(await api('costing',{id:recipe.id,source})).snapshot.variants[0];
 await check('linked lemon juice costs its measured yield, scales quantities and follows prices without rewriting saved costs',async()=>{
  lemon=await create('Yield fixture Lemon',{default_unit:'pcs'},{amount:'30',quantity:'1',unit:'pcs'});
  juice=await create('Yield fixture Lemon juice',{default_unit:'g',yield_source:link(lemon.id)});
  const row=await find(juice.id);close(row.price.amount,30);close(row.price.quantity,40);assert.equal(row.price.unit,'g');
  const d=blankRecipe();d.name='Yield fixture lemon cake';d.variants[0].groups[0].ingredients=[{id:'juice',ingredient_id:juice.id,name:juice.name,quantity:'10',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Mix.';
  recipe=await api('create',{document:d,status:'production'});close((await cost()).ingredient_cost,7.5);close((await cost('saved')).ingredient_cost,7.5);
  close((await api('costing',{id:recipe.id,factor:'2'})).snapshot.variants[0].ingredient_cost,15);
  lemon=await edit(lemon,lemon.data,{price:{amount:'40',quantity:'1',unit:'pcs'}});
  close((await cost()).ingredient_cost,10);close((await cost('saved')).ingredient_cost,7.5);
  juice=await edit(juice,{...juice.data,yield_source:link(lemon.id,{yield_quantity:'50'})});
  close((await cost()).ingredient_cost,8);close((await cost('saved')).ingredient_cost,7.5);
  assert.deepEqual((await api('get',{id:recipe.id})).document,recipe.document);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_prices where resource_id=$1',[juice.id]),0);
 })();
 await check('source supplier selection, unit equivalents, fractional yields and linked chains use comparable units only',async()=>{
  supplier=await api('save_resource',{kind:'supplier',name:'Yield fixture Supplier'});
  const other=await api('save_resource',{kind:'supplier',name:'Yield fixture Supplier 2'});
  lemon=await edit(lemon,{...lemon.data,unit_conversions:{lemon:{quantity:'100',unit:'g'}},default_unit:'g'},{
   suppliers:[{supplier_id:supplier.id,price:{amount:'100',quantity:'1',unit:'kg'}},{supplier_id:other.id,price:{amount:'120',quantity:'1',unit:'kg'}}]
  });
  juice=await edit(juice,{...juice.data,yield_source:link(lemon.id,{source_unit:'lemon'})});
  close((await find(juice.id)).price.amount,12);
  lemon=await edit(lemon,{...lemon.data,preferred_supplier_id:supplier.id});
  close((await find(juice.id)).price.amount,10);
  juice=await edit(juice,{...juice.data,unit_conversions:{tsp:{quantity:'5',unit:'g'}}});
  const d=structuredClone(recipe.document);d.variants[0].groups[0].ingredients[0].quantity='1/8';d.variants[0].groups[0].ingredients[0].unit='tsp';
  close((await api('cost_preview',{document:d})).snapshot.variants[0].ingredient_cost,.15625);
  const concentrate=await create('Yield fixture concentrate',{default_unit:'g',yield_source:link(juice.id,{source_quantity:'1/2',source_unit:'kg',yield_quantity:'100'})});
  close((await find(concentrate.id)).price.amount,125);
  const missing=await create('Yield fixture no guessed density',{default_unit:'g',yield_source:link(lemon.id,{source_unit:'ml'})});
  assert.equal((await find(missing.id)).price,null);
  const preview=await api('ingredient_yield_source',{id:lemon.id,unit:'lemon'});assert.equal(preview.name,lemon.name);assert.ok(preview.price);
 })();
 await check('malformed yields, self links, cycles and unavailable sources are rejected atomically',async()=>{
  const before=await h.scalar('select count(*)::int from tlb.recipe_resources');
  for(const value of [null,[],{},link(lemon.id,{source_quantity:'0'}),link(lemon.id,{yield_quantity:'-1'}),link(lemon.id,{yield_quantity:'1/0'}),link(lemon.id,{source_unit:''}),link(supplier.id),link(randomUUID()),link(lemon.id,{yield_unit:'ml'})]){
   await assert.rejects(()=>create('Invalid yield',{default_unit:'g',yield_source:value}));
  }
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_resources'),before);
  await assert.rejects(()=>edit(juice,{...juice.data,yield_source:link(juice.id)}),/circular|itself/);
  await assert.rejects(()=>edit(lemon,{...lemon.data,yield_source:link(juice.id)}),/circular|itself/);
  await assert.rejects(()=>edit(juice,{...juice.data,default_unit:'ml'}),/default.*unit/);
  await assert.rejects(()=>api('save_resource',{kind:'packaging',name:'Not an ingredient',data:{default_unit:'g',yield_source:link(lemon.id)}}));
  const inactive=await create('Yield fixture inactive',{default_unit:'pcs'});await edit(inactive,inactive.data,{active:false});
  await assert.rejects(()=>create('Unavailable source',{default_unit:'g',yield_source:link(inactive.id)}),/available/);
 })();
 await check('linked ingredients reject direct purchase writes and previews, while switching back preserves genuine purchase history',async()=>{
  const before=await h.scalar('select count(*)::int from tlb.recipe_prices');
  await assert.rejects(()=>edit(juice,juice.data,{price:{amount:'1',quantity:'1',unit:'g'}}),/source ingredient/);
  await assert.rejects(()=>edit(juice,juice.data,{suppliers:[{supplier_id:supplier.id,amount:'1',quantity:'1',unit:'g'}]}),/source ingredient/);
  const payload={kind:'ingredient',resource_id:juice.id,name:juice.name,supplier_id:supplier.id,supplier_name:supplier.name,quantity:'100',unit:'g',amount:'100',request_id:randomUUID()};
  await assert.rejects(()=>api('purchase_preview',payload),/source ingredient/);
  await assert.rejects(()=>api('record_purchase',payload),/source ingredient/);
  await assert.rejects(()=>api('record_purchase',{...payload,resource_id:null,request_id:randomUUID()}),/source ingredient/);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_prices'),before);
  let bought=await create('Yield fixture switch',{default_unit:'g'},{amount:'20',quantity:'100',unit:'g'});
  bought=await edit(bought,{...bought.data,yield_source:link(lemon.id,{source_unit:'lemon'})});
  close((await find(bought.id)).price.amount,10);
  const {yield_source,...data}=bought.data;bought=await edit(bought,data);
  close((await find(bought.id)).price.amount,20);close((await find(bought.id)).price.quantity,100);
 })();
 await check('missing source costs remain missing, source deletion and restoration retain history, and source hard deletion is protected',async()=>{
  const noPrice=await create('Yield fixture no price',{default_unit:'pcs'});
  const derived=await create('Yield fixture unpriced juice',{default_unit:'g',yield_source:link(noPrice.id)});
  assert.equal((await find(derived.id)).price,null);
  await api('delete_resource',{id:lemon.id,revision:lemon.revision});
  assert.equal((await cost()).complete,false);close((await cost('saved')).ingredient_cost,7.5);
  await assert.rejects(()=>create('Deleted source',{default_unit:'g',yield_source:link(lemon.id)}),/available/);
  const deleted=(await api('resources',{kind:'ingredient',deleted:true,limit:100})).rows.find(r=>r.id===lemon.id);
  await api('restore_resource',{id:lemon.id,revision:deleted.revision});
  assert.equal((await cost()).complete,true);
  await assert.rejects(()=>db.query('delete from tlb.recipe_resources where id=$1',[noPrice.id]),/foreign key/);
 })();
 await check('linked source details and writes are editor-only and private helpers have no API execute grants',async()=>{
  await api('save_access',{user_id:customer,permission:'kitchen'});
  for(const user of [customer,null]){
   await assert.rejects(()=>api('ingredient_yield_source',{id:lemon.id},user));
   await assert.rejects(()=>api('save_resource',{kind:'ingredient',name:'Forbidden yield',data:{default_unit:'g',yield_source:link(lemon.id)}},user));
  }
  for(const fn of ['recipe_validate_yield_source()','recipe_purchase_price(uuid,text,text)','recipe_yield_price(uuid,text,text,uuid[])','recipe_current_price(uuid,text,text)','recipe_yield_source_preview(jsonb)','recipe_yield_save_guard(jsonb)']){
   for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,$2,'execute')",[role,'tlb.'+fn]),false);
   assert.equal(await h.scalar('select prosecdef from pg_proc where oid=$1::regprocedure',['tlb.'+fn]),false);
  }
 })();
}
