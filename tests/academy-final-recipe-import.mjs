import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {setup} from './academy-portal.mjs';
import {unwrapRecipeResult} from './backend/recipe-staff-fixture.mjs';
import {blankRecipe} from '../assets/ordering/recipe-model.js';

const {db,h,api}=await setup(),owner=h.ids.owner,results=[];
const sourceApi=(action,payload={})=>h.as(owner,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
const check=async(name,fn)=>{await fn();results.push({name,status:'PASS'});console.log('PASS',name);};
const document=(name,quantity='100')=>{
 const d=blankRecipe();d.name='Import QA '+name;d.description='Teaching formula '+quantity;d.private_notes='PRIVATE_SOURCE_NOTE';
 d.variants[0].yield={quantity:'1',unit:'cake',portions:'8'};
 d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity,unit:'g',cost_snapshot:{amount:'100',quantity:'1000',unit:'g'}}];
 d.variants[0].methods[0].steps[0].instruction='Fold gently and bake.';return d;
};
const create=(name,status='final')=>sourceApi('create',{document:document(name),status});
const save=(r,status,quantity='200')=>sourceApi('save',{id:r.id,revision:r.revision,document:document(r.document.name.replace('Import QA ',''),quantity),status});
const search=(query='Import QA')=>api(owner,'production_recipes',{query});
const counts=async()=>(await db.query(`select
 (select count(*)::int from tlb.academy_student_recipes) recipes,
 (select count(*)::int from tlb.academy_student_recipe_versions) versions,
 (select count(*)::int from tlb.academy_audit) audits,
 (select count(*)::int from tlb.academy_action_requests) requests`)).rows[0];
const stale=/no longer the current Final version/;
try{
 let current=await create('Current Final');const oldFinal=structuredClone(current);
 current=await save(current,'draft');const oldDraft=structuredClone(current);
 current=await save(current,'final','300');
 const draftOnly=await create('Draft only','draft'),researchOnly=await create('Research only','testing');
 const workingFinal=await create('Working Draft');const working=await save(workingFinal,'draft');
 const researchFinal=await create('Working R&D');const research=await save(researchFinal,'testing');
 let hidden=await create('Hidden'),archived=await create('Archived');
 hidden=await sourceApi('set_status',{id:hidden.id,revision:hidden.revision,status:'hidden'});
 archived=await sourceApi('set_status',{id:archived.id,revision:archived.revision,status:'archive'});
 const deleted=await create('Deleted');await sourceApi('delete',{id:deleted.id,revision:deleted.revision});

 await check('Search lists one current Final per recipe and omits every other lifecycle category',async()=>{
  assert.deepEqual(await search(),[{version_id:current.version_id,name:current.document.name,number:3,status:'production'}]);
  assert.deepEqual(await search('no matching recipe'),[]);
  assert.deepEqual(await search('CURRENT final'),await search());
 });
 await check('Direct imports reject historical Finals, drafts, R&D, Hidden, Archived, deleted and unknown versions without writes',async()=>{
  const before=await counts();
  for(const version_id of [oldFinal.version_id,oldDraft.version_id,draftOnly.version_id,researchOnly.version_id,workingFinal.version_id,working.version_id,researchFinal.version_id,research.version_id,hidden.version_id,archived.version_id,deleted.version_id,randomUUID(),null]){
   await assert.rejects(api(owner,'import_recipe',{version_id}),stale);
   await assert.rejects(api(owner,'import_recipe',{version_id,idempotency_key:randomUUID()}),stale);
  }
  assert.deepEqual(await counts(),before);
 });
 await check('Search and import remain owner-only, including guessed eligible version IDs',async()=>{
  const before=await counts();
  for(const user of [null,h.ids.staff,h.ids.customer,h.ids.stranger]){
   await assert.rejects(api(user,'production_recipes',{}));
   await assert.rejects(api(user,'import_recipe',{version_id:current.version_id,idempotency_key:randomUUID()}));
  }
  assert.deepEqual(await counts(),before);
 });
 let imported;const request={version_id:current.version_id,idempotency_key:randomUUID()};
 await check('Only the selected current Final teaching content is copied, with safe retries',async()=>{
  const before=await counts();imported=await api(owner,'import_recipe',request);
  assert.equal(imported.source_version_id,current.version_id);
  assert.equal(imported.document.description,'Teaching formula 300');
  assert.equal(imported.document.variants[0].groups[0].ingredients[0].quantity,'300');
  assert.ok(!JSON.stringify(imported.document).includes('PRIVATE_SOURCE_NOTE'));
  assert.ok(!JSON.stringify(imported.document).includes('cost_snapshot'));
  assert.deepEqual(await api(owner,'import_recipe',request),imported);
  await assert.rejects(api(owner,'import_recipe',{...request,title:'Changed retry'}),/request changed/);
  const after=await counts();assert.deepEqual(after,{recipes:before.recipes+1,versions:before.versions+1,audits:before.audits+1,requests:before.requests+1});
  const unchanged=await sourceApi('get',{id:current.id});assert.deepEqual(unchanged.document,current.document);assert.equal(unchanged.version_id,current.version_id);
 });
 await check('A newer Final invalidates stale picker results and cached imports without changing the existing Academy copy',async()=>{
  const selected=(await search())[0];current=await save(current,'final','400');const before=await counts();
  await assert.rejects(api(owner,'import_recipe',{version_id:selected.version_id,idempotency_key:randomUUID()}),stale);
  await assert.rejects(api(owner,'import_recipe',request),stale);assert.deepEqual(await counts(),before);
  assert.deepEqual((await search()).map(r=>r.version_id),[current.version_id]);
  assert.equal((await api(owner,'admin_recipe',{id:imported.id})).document.description,'Teaching formula 300');
  const fresh=await api(owner,'import_recipe',{version_id:current.version_id,idempotency_key:randomUUID()});assert.equal(fresh.document.description,'Teaching formula 400');
 });
 await check('Starting a newer Draft withdraws the recipe from imports despite retaining its previous Final for kitchen use',async()=>{
  const selected=(await search())[0];current=await save(current,'draft','500');const before=await counts();
  assert.deepEqual(await search(),[]);await assert.rejects(api(owner,'import_recipe',{version_id:selected.version_id}),stale);assert.deepEqual(await counts(),before);
  const pointers=(await db.query('select current_version_id,production_version_id from tlb.recipes where id=$1',[current.id])).rows[0];
  assert.equal(pointers.production_version_id,selected.version_id);assert.equal(pointers.current_version_id,current.version_id);
 });
 await check('A missing publication pointer and legacy Approved status do not masquerade as current Final recipes',async()=>{
  const incomplete=await create('Incomplete'),approved=await create('Legacy Approved');
  await db.query('update tlb.recipes set production_version_id=null where id=$1',[incomplete.id]);
  const legacyVersion=randomUUID();
  await db.query("insert into tlb.recipe_versions(id,recipe_id,number,status,document) values($1,$2,2,'approved',$3::jsonb)",[legacyVersion,approved.id,JSON.stringify(approved.document)]);
  await db.query('update tlb.recipes set current_version_id=$2,production_version_id=$2 where id=$1',[approved.id,legacyVersion]);approved.version_id=legacyVersion;
  assert.deepEqual(await search(),[]);const before=await counts();
  for(const r of [incomplete,approved])await assert.rejects(api(owner,'import_recipe',{version_id:r.version_id}),stale);
  assert.deepEqual(await counts(),before);
 });
 await check('Final parent imports preserve pinned historical component formulas and exclude private fields',async()=>{
  let component=await create('Component');const pinned=structuredClone(component);component=await save(component,'final','900');
  const d=document('Parent');d.variants[0].components=[{id:'filling',name:'Pinned filling',version_id:pinned.version_id,variant_id:pinned.document.variants[0].id,quantity:'1',unit:'cake',mode:'pinned'}];
  const parent=await sourceApi('create',{document:d,status:'final'});
  const parentRequest={version_id:parent.version_id,idempotency_key:randomUUID()};
  const copy=await api(owner,'import_recipe',parentRequest);
  assert.equal(copy.document.variants.length,2);assert.equal(copy.document.variants[1].groups[0].ingredients[0].quantity,'100');
  const text=JSON.stringify(copy.document);for(const value of ['PRIVATE_SOURCE_NOTE','cost_snapshot',pinned.version_id])assert.ok(!text.includes(value));
  await db.query("update tlb.staff set role='staff' where user_id=$1",[owner]);
  const before=await counts();await assert.rejects(api(owner,'production_recipes',{}));
  await assert.rejects(api(owner,'import_recipe',{version_id:parent.version_id}));
  await assert.rejects(api(owner,'import_recipe',parentRequest));assert.deepEqual(await counts(),before);
 });
 await mkdir('tests/artifacts/academy-final-recipe-import',{recursive:true});
 await writeFile('tests/artifacts/academy-final-recipe-import/backend-results.json',JSON.stringify(results,null,2));
 console.log(`PASS ${results.length} Final recipe import checks`);
}finally{await db.close();}
