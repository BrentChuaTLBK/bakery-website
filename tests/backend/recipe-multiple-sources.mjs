import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';

export async function beforeMigration({db,state}){
 const parent=randomUUID(),child=randomUUID();
 await db.query("insert into tlb.recipe_resources(id,kind,name,data) values($1,'ingredient','Legacy yield input','{}')",[parent]);
 await db.query("insert into tlb.recipe_resources(id,kind,name,data) values($1,'ingredient','Legacy prepared ingredient',$2::jsonb)",[child,JSON.stringify({default_unit:'g',yield_source:{ingredient_id:parent,source_quantity:'1',source_unit:'pcs',yield_quantity:'40',yield_unit:'g'}})]);
 state.legacyYield={parent,child,rows:(await db.query('select to_jsonb(r) row from tlb.recipe_resources r order by id')).rows};
}
export default async function({db,check,state}){
 const h=await makeHarness(db),{owner,customer}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 const create=(name,data={},price)=>api('save_resource',{kind:'ingredient',name,data,...price?{price}:{}});
 const edit=(r,data,extra={})=>api('save_resource',{kind:'ingredient',id:r.id,revision:r.revision,name:r.name,data,...extra});
 const input=(r,amount,unit)=>({ingredient_id:r.id,source_quantity:amount,source_unit:unit});
 const yieldData=(sources,extra={})=>({default_unit:'g',yield_source:{sources,yield_quantity:'250',yield_unit:'g'},...extra});
 const find=async id=>(await api('resources',{kind:'ingredient',limit:100})).rows.find(r=>r.id===id);
 const close=(a,b)=>assert.ok(Math.abs(Number(a)-b)<1e-9,`${a} ≈ ${b}`);
 let cream,lemon,juice,mascarpone,recipe;
 await check('migration backfills every existing source reference without rewriting ingredient records',async()=>{
  assert.ok(state.legacyYield);
  const {parent,child,rows}=state.legacyYield;
  assert.deepEqual((await db.query('select to_jsonb(r) row from tlb.recipe_resources r order by id')).rows,rows);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_yield_dependencies where resource_id=$1 and source_id=$2',[child,parent]),1);
 })();
 await check('mascarpone combines cream and linked lemon juice using fractions and measured yield',async()=>{
  cream=await create('Blend whipping cream',{default_unit:'ml'},{amount:'200',quantity:'1000',unit:'ml'});
  lemon=await create('Blend lemon',{default_unit:'pcs'},{amount:'20',quantity:'1',unit:'pcs'});
  juice=await create('Blend lemon juice',{default_unit:'g',unit_conversions:{tsp:{quantity:'4',unit:'g'}},yield_source:{...input(lemon,'1','pcs'),yield_quantity:'40',yield_unit:'g'}});
  mascarpone=await create('Homemade mascarpone',yieldData([input(cream,'1/2','l'),input(juice,'1 1/2','tsp')]));
  const row=await find(mascarpone.id);close(row.price.amount,103);close(row.price.quantity,250);assert.equal(row.price.unit,'g');assert.equal(row.price.supplier_id,null);
  const d=blankRecipe();d.name='Mascarpone costing fixture';d.variants[0].groups[0].ingredients=[{id:'cheese',ingredient_id:mascarpone.id,name:mascarpone.name,quantity:'100',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Fold in mascarpone.';
  recipe=await api('create',{document:d,status:'final'});
  close((await api('costing',{id:recipe.id})).snapshot.variants[0].ingredient_cost,41.2);
  close((await api('costing',{id:recipe.id,factor:'3'})).snapshot.variants[0].ingredient_cost,123.6);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_prices where resource_id=$1',[mascarpone.id]),0);
 })();
 await check('each source price and yield update flows to live costs while saved recipe costs remain fixed',async()=>{
  cream=await edit(cream,cream.data,{price:{amount:'300',quantity:'1000',unit:'ml'}});
  close((await find(mascarpone.id)).price.amount,153);
  lemon=await edit(lemon,lemon.data,{price:{amount:'40',quantity:'1',unit:'pcs'}});
  close((await find(mascarpone.id)).price.amount,156);
  close((await api('costing',{id:recipe.id,source:'saved'})).snapshot.variants[0].ingredient_cost,41.2);
  assert.deepEqual((await api('get',{id:recipe.id})).document,recipe.document);
  assert.equal((await api('versions',{id:recipe.id})).length,1);
  mascarpone=await edit(mascarpone,{...mascarpone.data,yield_source:{...mascarpone.data.yield_source,yield_quantity:'300'}});
  close((await api('costing',{id:recipe.id})).snapshot.variants[0].ingredient_cost,52);
 })();
 await check('missing second-source prices or units never produce a partial combined cost',async()=>{
  const unpriced=await create('Unpriced second source',{default_unit:'g'});
  let blend=await create('Incomplete blend',yieldData([input(cream,'10','ml'),input(unpriced,'5','g')]));
  assert.equal((await find(blend.id)).price,null);
  await assert.rejects(()=>db.query('delete from tlb.recipe_resources where id=$1',[unpriced.id]),/foreign key/);
  blend=await edit(blend,yieldData([input(cream,'10','ml'),input(juice,'5','pcs')]));
  assert.equal((await find(blend.id)).price,null);
  await db.query('delete from tlb.recipe_resources where id=$1',[unpriced.id]);
  await api('delete_resource',{id:juice.id,revision:juice.revision});
  assert.equal((await find(mascarpone.id)).price,null);
  close((await api('costing',{id:recipe.id,source:'saved'})).snapshot.variants[0].ingredient_cost,41.2);
  const deleted=(await api('resources',{kind:'ingredient',deleted:true})).rows.find(r=>r.id===juice.id);
  await api('restore_resource',{id:juice.id,revision:deleted.revision});
  juice=await find(juice.id);close((await find(mascarpone.id)).price.amount,156);
 })();
 await check('invalid sources, duplicate rows and cycles through any input fail atomically',async()=>{
  const before=await h.scalar('select count(*)::int from tlb.recipe_resources');
  for(const sources of [[],null,[input(cream,'1','ml'),input(cream,'2','ml')],[input(cream,'1','ml'),input(juice,'0','g')],[input(cream,'1','ml'),input({id:randomUUID()},'1','g')],Array.from({length:51},()=>input(cream,'1','ml'))]){
   await assert.rejects(()=>create('Invalid blend',yieldData(sources)));
  }
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_resources'),before);
  await assert.rejects(()=>edit(mascarpone,yieldData([input(cream,'1','ml'),input(mascarpone,'1','g')])),/circular|itself/);
  // The cycle passes through mascarpone's SECOND input, then a legacy link.
  await assert.rejects(()=>edit(lemon,yieldData([input(cream,'1','ml'),input(mascarpone,'1','g')])),/circular|itself/);
  close((await find(mascarpone.id)).price.amount,156);
 })();
 await check('all-input purchase guards, source removal and private permissions stay enforced',async()=>{
  const supplier=await api('save_resource',{kind:'supplier',name:'Blend supplier'});
  const purchase={resource_id:mascarpone.id,kind:'ingredient',name:mascarpone.name,supplier_id:supplier.id,supplier_name:supplier.name,amount:'10',quantity:'1',unit:'g',request_id:randomUUID()};
  for(const action of ['purchase_preview','record_purchase'])await assert.rejects(()=>api(action,purchase),/source ingredient/);
  await assert.rejects(()=>edit(mascarpone,mascarpone.data,{price:{amount:'1',quantity:'1',unit:'g'}}),/source ingredient/);
  const one=await edit(mascarpone,{default_unit:'g',yield_source:{...input(juice,'50','g'),yield_quantity:'100',yield_unit:'g'}});
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_yield_dependencies where resource_id=$1',[one.id]),1);
  const {yield_source,...data}=one.data;await edit(one,data,{price:{amount:'30',quantity:'100',unit:'g'}});
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_yield_dependencies where resource_id=$1',[one.id]),0);
  close((await find(one.id)).price.amount,30);
  await api('save_access',{user_id:customer,permission:'kitchen'});
  await assert.rejects(()=>api('save_resource',{kind:'ingredient',name:'Forbidden',data:yieldData([input(cream,'1','ml'),input(juice,'1','g')])},customer));
  for(const role of ['anon','authenticated','service_role']){
   assert.equal(await h.scalar("select has_table_privilege($1,'tlb.recipe_yield_dependencies','select,insert,update,delete')",[role]),false);
   for(const fn of ['recipe_yield_inputs(jsonb)','recipe_sync_yield_dependencies()'])assert.equal(await h.scalar("select has_function_privilege($1,$2,'execute')",[role,'tlb.'+fn]),false);
  }
 })();
}
