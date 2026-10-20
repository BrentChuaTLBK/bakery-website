import assert from 'node:assert/strict';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe,normalizeRecipe} from '../../assets/ordering/recipe-model.js';

export default async function({db,check}){
 const h=await makeHarness(db),{owner,staff:chef,customer:kitchen}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 const save=(r,extra={},user=owner)=>api('save',{id:r.id,revision:r.revision,status:r.status,document:r.document,...extra},user);
 const counts=async r=>(await db.query('select r.revision,r.updated_at,r.updated_by,r.current_version_id,r.production_version_id,(select count(*) from tlb.recipe_versions v where v.recipe_id=r.id) versions,(select count(*) from tlb.recipe_audit a where a.recipe_id=r.id) audits from tlb.recipes r where r.id=$1',[r.id])).rows[0];
 const d=blankRecipe();d.name='No-op save fixture';d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g',cost_snapshot:{amount:'100',quantity:'1000',unit:'g'}}];d.variants[0].methods[0].steps[0].instruction='Mix gently.';
 let recipe;
 await check('repeated identical saves preserve version, revision, timestamps, production pointer and audit history',async()=>{
  recipe=await api('create',{document:d,status:'final'});
  const before=await counts(recipe);
  for(let i=0;i<4;i++){
   const result=await save(recipe,{visibility:'staff',status:i%2?'final':'production'});
   assert.equal(result.unchanged,true);assert.equal(result.version_id,recipe.version_id);assert.equal(result.version,1);
  }
  // Reorder keys recursively without dropping nested content.
  const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverse(v)])):value;
  assert.equal((await save(recipe,{document:reverse(recipe.document)})).unchanged,true);
  assert.deepEqual(await counts(recipe),before);
 })();
 await check('real instructions, quantities, manual prices, status and visibility changes create exactly one version',async()=>{
  for(const edit of [
   doc=>doc.variants[0].methods[0].steps[0].instruction='Mix thoroughly.',
   doc=>doc.variants[0].groups[0].ingredients[0].quantity='120',
   doc=>doc.variants[0].groups[0].ingredients[0].cost_snapshot.amount='125'
  ]){
   const doc=structuredClone(recipe.document);edit(doc);const old=recipe;
   recipe=await save(recipe,{document:doc});assert.equal(recipe.version,old.version+1);
   assert.equal((await save(recipe)).unchanged,true);
  }
  let old=recipe;recipe=await save(recipe,{status:'draft'});assert.equal(recipe.version,old.version+1);
  old=recipe;recipe=await save(recipe,{visibility:'owner'});assert.equal(recipe.version,old.version+1);assert.equal(recipe.visibility,'owner');
  const before=await counts(recipe);assert.equal((await save(recipe,{visibility:'owner'})).unchanged,true);assert.deepEqual(await counts(recipe),before);
  await assert.rejects(()=>save(old,{document:recipe.document}),/another window/);
 })();
 await check('catalog price changes do not turn an unchanged save into a new historical price snapshot',async()=>{
  const flour=await api('save_resource',{kind:'ingredient',name:'No-op linked flour',data:{default_unit:'g'},price:{amount:'100',quantity:'1000',unit:'g'}});
  const doc=structuredClone(d);doc.name='No-op linked cost';doc.variants[0].groups[0].ingredients[0].ingredient_id=flour.id;
  let r=await api('create',{document:doc,status:'final'}),before=await counts(r);
  await api('save_resource',{id:flour.id,revision:flour.revision,kind:'ingredient',name:'Renamed linked flour',data:flour.data,price:{amount:'200',quantity:'1000',unit:'g'}});
  const fresh=await api('get',{id:r.id});
  assert.equal((await save(fresh)).unchanged,true);
  const refreshed=structuredClone(fresh.document);refreshed.variants[0].groups[0].ingredients[0].cost_snapshot={amount:'200',quantity:'1000',unit:'g'};
  assert.equal((await save(fresh,{document:refreshed})).unchanged,true);assert.deepEqual(await counts(r),before);
  assert.equal(Number((await api('costing',{id:r.id,source:'saved'})).snapshot.variants[0].ingredient_cost),10);
  assert.equal(Number((await api('costing',{id:r.id})).snapshot.variants[0].ingredient_cost),20);
  refreshed.variants[0].methods[0].steps[0].instruction='Mix and rest.';
  r=await save(fresh,{document:refreshed});assert.equal(r.version,2);
  assert.equal(Number((await api('costing',{id:r.id,source:'saved'})).snapshot.variants[0].ingredient_cost),20);
 })();
 await check('optional editor defaults do not version old recipes; explicit restore still creates a version',async()=>{
  const doc={name:'Legacy no-op recipe',variants:[{id:'legacy',name:'Base',yield:{quantity:'1',unit:'batch'},groups:d.variants[0].groups,methods:d.variants[0].methods}]};
  let r=await api('create',{document:doc,status:'draft'});
  assert.equal((await save(r,{document:normalizeRecipe(r.document)})).unchanged,true);
  const original=r.version_id,changed=structuredClone(r.document);changed.name+=' changed';r=await save(r,{document:changed});
  const restored=await api('restore_version',{version_id:original,revision:r.revision,status:'draft'});
  assert.equal(restored.version,r.version+1);assert.equal(restored.document.name,doc.name);
 })();
 await check('unchanged saves retain editor, owner-only and R&D checks; helper functions are private',async()=>{
  await api('save_access',{user_id:chef,permission:'chef'});await api('save_access',{user_id:kitchen,permission:'kitchen'});
  await assert.rejects(()=>save(recipe,{},chef),/access denied|not found/i);
  const publicDraft=await api('create',{document:d,status:'draft'});
  assert.equal((await save(publicDraft,{},chef)).unchanged,true);
  for(const user of [kitchen,null])await assert.rejects(()=>save(publicDraft,{},user));
  const research=await api('create',{document:d,status:'testing'});
  await assert.rejects(()=>save(research,{},chef),/R&D access/);
  await assert.rejects(()=>save(publicDraft,{rd:true},chef),/R&D access/);
  await assert.rejects(()=>save(publicDraft,{status:'final'},chef),/owner|Authorized/i);
  await api('delete',{id:publicDraft.id,revision:publicDraft.revision});
  await assert.rejects(()=>save(publicDraft),/removed|exist/);
  for(const name of ['recipe_unchanged_save(jsonb)','recipe_save_comparison(jsonb)']){
   for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,$2,'execute')",[role,'tlb.'+name]),false);
   assert.equal(await h.scalar('select prosecdef from pg_proc where oid=$1::regprocedure',['tlb.'+name]),false);
  }
 })();
}
