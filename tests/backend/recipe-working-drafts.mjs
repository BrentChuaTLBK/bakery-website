import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe,normalizeRecipe} from '../../assets/ordering/recipe-model.js';

export default async function({db,check}){
 const h=await makeHarness(db),{owner,staff:chef,customer:kitchen}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 const draft=async(recipe,document,extra={},user=owner)=>{const id=randomUUID();await api('autosave',{draft_id:id,id:recipe?.id,revision:recipe?.revision,document,...extra},user);return id;};
 const current=async(user=owner)=>new Set((await api('drafts',{current_only:true,limit:100},user)).map(d=>d.draft_id));
 const d=blankRecipe();d.name='Working draft Final';d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Mix and bake.';
 let recipe,oldSaved,oldUnique,identical,edited,newRecipe,privateChoice;
 await check('old and unchanged working copies do not label a Final recipe unfinished; real changes remain visible',async()=>{
  recipe=await api('create',{document:d,status:'final'});
  oldSaved=await draft(recipe,recipe.document);
  oldUnique=await draft(recipe,{...recipe.document,description:'Old abandoned changes'});
  recipe=await api('save',{id:recipe.id,revision:recipe.revision,document:{...recipe.document,description:'Approved final'},status:'final'});
  identical=await draft(recipe,normalizeRecipe(recipe.document));
  edited=await draft(recipe,{...recipe.document,description:'Genuine pending changes'});
  newRecipe=await draft(null,{...d,name:'New unsaved recipe'});
  privateChoice=await draft(recipe,recipe.document,{visibility:'owner'});
  const ids=await current();
  for(const id of [oldSaved,oldUnique,identical])assert.equal(ids.has(id),false);
  for(const id of [edited,newRecipe,privateChoice])assert.equal(ids.has(id),true);
  assert.equal((await api('get',{id:recipe.id})).status,'production');
 })();
 await check('current filtering runs before pagination and leaves the full recovery list and history intact',async()=>{
  await db.query("update tlb.recipe_drafts set updated_at='2030-01-01' where draft_id=$1",[oldUnique]);
  const before=(await db.query('select to_jsonb(d) row from tlb.recipe_drafts d order by draft_id')).rows;
  const all=await api('drafts',{limit:100});assert.equal(all.length,6);assert.equal(all[0].draft_id,oldUnique);
  const valid=await api('drafts',{current_only:true,limit:100});
  assert.deepEqual(await api('drafts',{current_only:true,limit:1}),valid.slice(0,1));
  assert.deepEqual(await api('drafts',{current_only:true,limit:1,offset:1}),valid.slice(1,2));
  assert.deepEqual((await db.query('select to_jsonb(d) row from tlb.recipe_drafts d order by draft_id')).rows,before);
  assert.equal((await api('versions',{id:recipe.id})).length,2);
 })();
 await check('incomplete working documents remain recoverable when comparison cannot normalize them',async()=>{
  const document=structuredClone(recipe.document);document.variants[0].additional_costs=null;
  const incomplete=await draft(recipe,document);
  assert.equal((await current()).has(incomplete),true);
 })();
 await check('draft filtering retains ownership, staff visibility, R&D protection and private helper permissions',async()=>{
  await api('save_access',{user_id:chef,permission:'chef'});await api('save_access',{user_id:kitchen,permission:'kitchen'});
  const chefDraft=await draft(recipe,{...recipe.document,description:'Chef pending'}, {},chef);
  assert.deepEqual([...await current(chef)],[chefDraft]);assert.equal((await current()).has(chefDraft),false);
  await api('remove_draft',{draft_id:oldUnique},chef);
  assert.equal((await api('drafts')).some(d=>d.draft_id===oldUnique),true);
  await api('set_visibility',{id:recipe.id,revision:recipe.revision,visibility:'owner'});
  assert.equal((await current(chef)).has(chefDraft),false);
  const research=await draft(null,{...d,name:'Research working copy'},{status:'testing'},owner);
  assert.equal((await current()).has(research),true);
  await assert.rejects(()=>draft(null,d,{status:'testing'},chef),/R&D/);
  for(const user of [kitchen,null])await assert.rejects(()=>api('drafts',{current_only:true},user));
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.recipe_draft_is_current(tlb.recipe_drafts)','execute')",[role]),false);
  assert.equal(await h.scalar("select prosecdef from pg_proc where oid='tlb.recipe_draft_is_current(tlb.recipe_drafts)'::regprocedure"),false);
 })();
 await check('discard removes only the selected working copy and keeps the saved Final and history',async()=>{
  const before=await api('get',{id:recipe.id}),versions=await api('versions',{id:recipe.id});
  await api('remove_draft',{draft_id:oldUnique});
  assert.equal((await api('drafts')).some(d=>d.draft_id===oldUnique),false);
  assert.equal((await api('drafts')).some(d=>d.draft_id===oldSaved),true);
  assert.deepEqual(await api('get',{id:recipe.id}),before);
  assert.deepEqual(await api('versions',{id:recipe.id}),versions);
 })();
}
