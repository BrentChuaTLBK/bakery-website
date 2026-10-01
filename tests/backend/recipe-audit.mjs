import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
export default async function({db,check,state}){
 const h=state.recipeHarness;
 const api=(action,payload={})=>h.as(h.ids.owner,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 function document(){const d=blankRecipe();d.name='Integrity audit fixture';d.variants[0].groups[0].ingredients[0]={id:'butter',name:'Butter',quantity:'94',unit:'g'};d.variants[0].methods[0].steps[0].instruction='Mix.';return d;}
 await check('duplicate procedure and step IDs cannot create shared kitchen checkoffs',async()=>{
  const d=document(),v=d.variants[0];v.methods.push(structuredClone(v.methods[0]));await assert.rejects(()=>api('create',{document:d}),/Procedure IDs/);
  v.methods.pop();v.methods[0].steps[0].id='butter';await assert.rejects(()=>api('create',{document:d}),/step IDs/);
  delete v.methods[0].id;delete v.methods[0].steps[0].id;assert.equal((await api('create',{document:d})).version,1);
 })();
 await check('all optional yield fields reject invalid values in direct API requests',async()=>{
  for(const key of ['portions','portion_weight','batch_weight','finished_weight','pans','loss_percent']){const d=document();d.variants[0].yield[key]='-1';await assert.rejects(()=>api('create',{document:d}),/nonnegative/);}
  const d=document();d.variants[0].yield.loss_percent='101';await assert.rejects(()=>api('create',{document:d}),/100%/);
  d.variants[0].yield.loss_percent='0';d.variants[0].groups[0].ingredients[0].quantity='1000000000001';await assert.rejects(()=>api('create',{document:d}),/too large/);
 })();
 await check('a mismatched R&D version produces a clear error and writes no log',async()=>{
  const a=await api('create',{document:document()}),b=await api('create',{document:document()});
  await assert.rejects(()=>api('save_test',{recipe_id:a.id,version_id:b.version_id,data:{observations:'Wrong recipe'}}),/saved version of this recipe/);
  assert.deepEqual(await api('tests',{id:a.id}),[]);
 })();
 await check('Unicode names, duplicate names, distinct codes and combined library filters retain separate identities',async()=>{
  const category=await api('save_category',{name:'Audit cakes'}),child=await api('save_category',{name:'Audit cheesecakes',parent_id:category.id});
  await assert.rejects(()=>api('save_category',{id:category.id,name:'Audit cakes',parent_id:child.id}),/contain themselves/);
  const d=document();d.name='Audit crème brûlée 🍰 & <special>';d.category_id=child.id;d.tags=['audit','cheese'];d.product_line='Audit retail';d.description='Long description '.repeat(300);
  const a=await api('create',{document:d,code:'AUDIT-UNIQUE-A',status:'final'}),b=await api('create',{document:d,code:'AUDIT-UNIQUE-B',status:'draft'});
  assert.notEqual(a.id,b.id);assert.deepEqual(a.document.description,d.description);
  await assert.rejects(()=>api('create',{document:d,code:'AUDIT-UNIQUE-A'}),/unique|already|duplicate/i);
  await api('favorite',{id:a.id,favorite:true,pinned:true});await api('get',{id:a.id});
  const selected=await api('list',{query:'crème',category_id:child.id,tag:'cheese',product_line:'Audit retail',status:'final',favorites:true,pinned:true,recent:true,author:h.ids.owner,version:1});
  assert.equal(selected.total,1);assert.equal(selected.rows[0].id,a.id);
  assert.equal((await api('list',{query:'crème',tag:'absent'})).total,0);
  const blank=document();blank.name=' ';await assert.rejects(()=>api('create',{document:blank}),/name/i);
 })();
 await check('two editors and duplicate saves cannot overwrite a newer version, and stale autosaves remain private drafts',async()=>{
  const saved=await api('create',{document:document(),status:'final'}),first=structuredClone(saved.document),second=structuredClone(saved.document);first.description='First editor saved';second.description='Second editor unsaved';
  const revised=await api('save',{id:saved.id,revision:saved.revision,document:first,status:'draft'});
  for(const document of [first,second])await assert.rejects(()=>api('save',{id:saved.id,revision:saved.revision,document,status:'draft'}),/another window/);
  const draftId=randomUUID();await api('autosave',{draft_id:draftId,id:saved.id,revision:saved.revision,document:second});
  const draft=(await api('drafts')).find(d=>d.draft_id===draftId);assert.equal(draft.base_revision,saved.revision);assert.equal(draft.document.description,second.description);
  assert.equal((await api('get',{id:saved.id})).version,revised.version);assert.equal((await api('get',{id:saved.id,kitchen:true})).document.description,saved.document.description);
  assert.equal((await api('versions',{id:saved.id})).length,2);await api('remove_draft',{draft_id:draftId});assert.equal((await api('drafts')).some(d=>d.draft_id===draftId),false);
 })();
}
