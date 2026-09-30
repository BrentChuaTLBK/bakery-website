import assert from 'node:assert/strict';
import {makeHarness} from './helpers.mjs';
import {blankRecipe,addComponent,method,freshVariant} from '../../assets/ordering/recipe-model.js';
export default async function({db,check,state}){
 const h=state.recipeHarness||await makeHarness(db),{owner,staff,customer}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const d=blankRecipe();d.name='QA paired component cake';d.private_notes='PRIVATE_RECIPE_NOTE';const v=d.variants[0];v.groups[0].name='Sponge';addComponent(v,'Mousse');
 for(const [i,g] of v.groups.entries()){g.ingredients[0].name=i?'Cream':'Flour';g.ingredients[0].quantity=i?'200':'100';v.methods[i].steps[0].instruction=i?'Whip the cream.':'Bake the sponge.';}
 v.methods[0].steps[0].timer_minutes='15';v.methods[0].steps[0].warning='Preserve this previously saved warning.';
 const assembly=method();assembly.name='Assembly';assembly.steps[0].instruction='Layer the sponge and mousse.';v.methods.push(assembly);let saved;
 await check('recipe component associations survive saving and the kitchen privacy projection',async()=>{
  await api('save_access',{user_id:customer,permission:'kitchen'});await api('save_access',{user_id:staff,permission:'chef'});
  saved=await api('create',{document:d,status:'production'});const kitchen=await api('get',{id:saved.id},customer);
  assert.deepEqual(kitchen.document.variants[0].methods.map(m=>m.group_id),v.methods.map(m=>m.group_id));assert.equal(kitchen.document.private_notes,undefined);assert.equal(kitchen.cost_snapshot,null);
  assert.equal(kitchen.document.variants[0].methods[0].steps[0].timer_minutes,'15');assert.match(kitchen.document.variants[0].methods[0].steps[0].warning,/Preserve/);
 })();
 await check('component reordering in a draft leaves the approved formula and associations unchanged',async()=>{
  const before=structuredClone(saved),draft=structuredClone(saved.document);draft.variants[0].groups.reverse();
  saved=await api('save',{id:saved.id,revision:saved.revision,document:draft,status:'draft'},staff);
  assert.equal(saved.document.variants[0].groups[0].name,'Mousse');assert.equal(saved.document.variants[0].methods[1].group_id,saved.document.variants[0].groups[0].id);
  const approved=await api('get',{id:saved.id},customer);assert.equal(approved.version_id,before.version_id);assert.deepEqual(approved.document.variants[0].methods.map(m=>m.group_id),v.methods.map(m=>m.group_id));
  assert.deepEqual((await api('get',{id:saved.id,version_id:before.version_id})).document,before.document);
 })();
 await check('invalid, cross-size and duplicate component associations are rejected atomically',async()=>{
  const before=await api('get',{id:saved.id}),broken=structuredClone(before.document);broken.variants[0].methods[0].group_id='missing';
  await assert.rejects(()=>api('save',{id:saved.id,revision:saved.revision,document:broken,status:'draft'}),/existing component/);
  const duplicate=structuredClone(before.document);duplicate.variants[0].groups[1].id=duplicate.variants[0].groups[0].id;
  await assert.rejects(()=>api('save',{id:saved.id,revision:saved.revision,document:duplicate,status:'draft'}),/Component IDs must be unique/);
  const crossSize=structuredClone(before.document);crossSize.variants.push(freshVariant(crossSize.variants[0],'Other size'));crossSize.variants[0].methods[0].group_id=crossSize.variants[1].groups[0].id;
  await assert.rejects(()=>api('save',{id:saved.id,revision:saved.revision,document:crossSize,status:'draft'}),/existing component/);
  assert.deepEqual(await api('get',{id:saved.id}),before);
 })();
 await check('legacy recipes without procedure associations remain editable and private helpers stay private',async()=>{
  const legacy=structuredClone(d);legacy.name='QA legacy sections';for(const m of legacy.variants[0].methods)delete m.group_id;
  const row=await api('create',{document:legacy,status:'draft'});assert.equal(row.document.variants[0].methods.length,3);
  for(const role of ['anon','authenticated'])for(const helper of ['tlb.recipe_validate(jsonb)','tlb.recipe_kitchen_document(jsonb)'])assert.equal(await h.scalar('select has_function_privilege($1,$2,\'execute\')',[role,helper]),false);
 })();
}
