import assert from 'node:assert/strict';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
export default async function({db,check}){
 const h=await makeHarness(db),{owner,customer}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 let salt,recipe;const close=(a,b)=>assert.ok(Math.abs(Number(a)-b)<1e-9,`${a} ≈ ${b}`);
 const summary=async(source='current')=>(await api('costing',{id:recipe.id,source})).snapshot.variants[0];
 await check('tsp recipe becomes costed from kg purchase price after adding its ingredient equivalent, without changing its formula',async()=>{
  salt=await api('save_resource',{kind:'ingredient',name:'Fixture salt',data:{default_unit:'g'},price:{amount:'100',quantity:'1',unit:'kg'}});
  const d=blankRecipe();d.name='Fixture teaspoon costing';d.variants[0].groups[0].ingredients=[{id:'salt',ingredient_id:salt.id,name:salt.name,quantity:'1/8',unit:'tsp'}];d.variants[0].methods[0].steps[0].instruction='Mix.';
  recipe=await api('create',{document:d,status:'production'});assert.equal((await summary()).complete,false);
  salt=await api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:{...salt.data,unit_conversions:{tsp:{quantity:'6',unit:'g'},tbsp:{quantity:'18',unit:'g'}}}});
  assert.equal((await summary()).complete,true);close((await summary()).ingredient_cost,.075);
  assert.equal((await summary('saved')).complete,false);
  assert.deepEqual((await api('get',{id:recipe.id})).document,recipe.document);
  const unchanged=await api('save',{id:recipe.id,revision:recipe.revision,document:recipe.document,status:'production'});
  assert.equal(unchanged.unchanged,true);assert.equal(unchanged.version,recipe.version);assert.equal((await summary('saved')).complete,false);
  const changed=structuredClone(recipe.document);changed.variants[0].methods[0].steps[0].instruction='Mix thoroughly.';
  recipe=await api('save',{id:recipe.id,revision:recipe.revision,document:changed,status:'production'});
  close((await summary('saved')).ingredient_cost,.075);
  salt=await api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:{...salt.data,unit_conversions:{tsp:{quantity:'4',unit:'g'},tbsp:{quantity:'12',unit:'g'}}}});
  close((await summary()).ingredient_cost,.05);close((await summary('saved')).ingredient_cost,.075);
  const scaled=(await api('costing',{id:recipe.id,factor:'2'})).snapshot.variants[0];close(scaled.ingredient_cost,.1);
 })();
 await check('equivalents remain ingredient-specific, validate on the server, and can be removed without rewriting history',async()=>{
  for(const conversions of [[],{tsp:{quantity:'0',unit:'g'}},{tsp:{quantity:'-1',unit:'g'}},{tsp:{quantity:'6',unit:'cup'}},{kg:{quantity:'2',unit:'g'}},{tsp:{quantity:'6',unit:'g'},TSP:{quantity:'5',unit:'g'}}]){
   await assert.rejects(()=>api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:{...salt.data,unit_conversions:conversions}}));
  }
  const other=await api('save_resource',{kind:'ingredient',name:'No inferred flour density',data:{default_unit:'g'},price:{amount:'100',quantity:'1',unit:'kg'}});
  const d=structuredClone(recipe.document);d.variants[0].groups[0].ingredients[0].ingredient_id=other.id;
  assert.equal((await api('cost_preview',{document:d})).snapshot.variants[0].complete,false);
  await api('save_access',{user_id:customer,permission:'kitchen'});
  await assert.rejects(()=>api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:salt.data},customer));
  salt=await api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:{...salt.data,unit_conversions:{}}});
  assert.equal((await summary()).complete,false);close((await summary('saved')).ingredient_cost,.075);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.recipe_validate_unit_equivalents()','execute')",[role]),false);
 })();
}
