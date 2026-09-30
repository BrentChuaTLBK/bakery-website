import assert from 'node:assert/strict';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {addRecipePackaging} from '../../assets/ordering/recipe-packaging.js';
export default async function({db,check,state}){
 const h=state.recipeHarness,{owner,customer}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 let packaging,saved;
 await check('linked packaging costs are captured while kitchen references exclude every pricing field',async()=>{
  packaging=await api('save_resource',{kind:'packaging',name:'QA linked cake box',data:{default_unit:'pc',dimensions:'10 × 10 inches'},price:{amount:'300',quantity:'10',unit:'pc'}});
  const d=blankRecipe();d.name='QA packaging reference';d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'1',unit:'g',cost_snapshot:{amount:'0',quantity:'1',unit:'g'}}];d.variants[0].methods[0].steps[0].instruction='Mix.';addRecipePackaging(d.variants[0],packaging);d.variants[0].additional_costs[0].quantity='2';d.variants[0].additional_costs.push({name:'Private manual charge',amount:'5'});d.variants[0].packaging.items=[{resource_name:'Untrusted derived value',amount:'999',supplier_id:'PRIVATE'}];
  saved=await api('create',{document:d,status:'production'});assert.equal(Number(saved.cost_snapshot.variants[0].total),65);
  const kitchen=await api('get',{id:saved.id},customer),v=kitchen.document.variants[0];assert.equal(v.packaging.items.length,1);assert.equal(v.packaging.items[0].resource_name,packaging.name);assert.equal(v.packaging.items[0].quantity,'2');assert.equal(v.additional_costs,undefined);assert.equal(v.packaging.items[0].cost_snapshot,undefined);assert.equal(v.packaging.items[0].amount,undefined);assert.doesNotMatch(JSON.stringify(v),/Untrusted derived|Private manual|supplier_id|cost_snapshot/);
 })();
 await check('packaging price updates affect a new draft while approved packaging and costs stay historical',async()=>{
  await api('save_resource',{id:packaging.id,revision:packaging.revision,kind:'packaging',name:packaging.name,data:packaging.data,price:{amount:'400',quantity:'10',unit:'pc'}});
  const next=await api('save',{id:saved.id,revision:saved.revision,document:saved.document,status:'draft'});assert.equal(Number(next.cost_snapshot.variants[0].total),85);assert.equal(Number((await api('get',{id:saved.id,version_id:saved.version_id})).cost_snapshot.variants[0].total),65);assert.equal((await api('get',{id:saved.id},customer)).version_id,saved.version_id);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.recipe_kitchen_document(jsonb)','execute')"),false);
 })();
}
