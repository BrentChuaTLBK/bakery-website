import assert from 'node:assert/strict';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
export default async function({db,check,state}){
 const h=state.recipeHarness,{owner,staff,customer}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 let record,initial,ingredient;
 const document=()=>{const d=blankRecipe();d.name='QA simplified workflow';d.variants[0].groups[0].ingredients=[{id:'flour',ingredient_id:ingredient.id,name:ingredient.name,quantity:'100',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Mix.';return d;};
 await check('Final is a direct transition from Draft, preserves prices and publishes the saved formula',async()=>{
  ingredient=await api('save_resource',{kind:'ingredient',name:'Workflow flour',data:{default_unit:'g'},price:{amount:'100',quantity:'1000',unit:'g'}});
  record=await api('create',{document:document(),status:'draft'});initial=record;
  await api('save_resource',{id:ingredient.id,revision:ingredient.revision,kind:'ingredient',name:ingredient.name,data:ingredient.data,price:{amount:'250',quantity:'1000',unit:'g'}});
  record=await api('set_status',{id:record.id,revision:record.revision,status:'final'});
  assert.equal(record.status,'production');assert.equal(record.version,2);assert.equal(record.production_version_id,record.version_id);
  assert.deepEqual(record.cost_snapshot,initial.cost_snapshot);assert.deepEqual(record.document,initial.document);
  assert.equal((await api('get',{id:record.id},customer)).version_id,record.version_id);
 })();
 await check('status changes require owner access, a current revision and one of the five statuses',async()=>{
  for(const user of [staff,customer])await assert.rejects(()=>api('set_status',{id:record.id,revision:record.revision,status:'hidden'},user),/owner|editor/);
  await assert.rejects(()=>api('set_status',{id:record.id,revision:initial.revision,status:'hidden'}),/another window/);
  await assert.rejects(()=>api('set_status',{id:record.id,revision:record.revision,status:'unknown'}),/Choose Draft, R&D/);
  const same=await api('set_status',{id:record.id,revision:record.revision,status:'final'});assert.equal(same.version_id,record.version_id);
 })();
 await check('R&D is distinct from Draft and retains the last Final with unchanged historical costs',async()=>{
  const final=record;record=await api('set_status',{id:record.id,revision:record.revision,status:'testing'});
  assert.equal(record.status,'testing');assert.equal(record.production_version_id,final.version_id);assert.deepEqual(record.document,final.document);assert.deepEqual(record.cost_snapshot,final.cost_snapshot);
  assert.equal((await api('get',{id:record.id},customer)).version_id,final.version_id);
  assert.equal((await api('list',{query:'QA simplified workflow',status:'testing'})).total,1);assert.equal((await api('list',{query:'QA simplified workflow',status:'draft'})).total,0);
  assert.equal((await api('costing_overview',{query:'QA simplified workflow',status:'testing',mode:'all'})).total,1);
  assert.equal((await api('set_status',{id:record.id,revision:record.revision,status:'testing'})).version_id,record.version_id);
  const proposed=structuredClone(record.document);proposed.description='Chef R&D edit';record=await api('save',{id:record.id,revision:record.revision,document:proposed,status:'testing'},staff);
  assert.equal(record.status,'testing');assert.equal(record.production_version_id,final.version_id);assert.equal((await api('get',{id:record.id},customer)).version_id,final.version_id);
 })();
 await check('Hidden withdraws a recipe from kitchen listing and direct access while retaining admin history',async()=>{
  const finalId=record.version_id;record=await api('set_status',{id:record.id,revision:record.revision,status:'hidden'});
  assert.equal(record.status,'hidden');assert.equal(record.production_version_id,null);
  assert.equal((await api('list',{query:'QA simplified workflow',kitchen:true})).total,0);
  await assert.rejects(()=>api('get',{id:record.id},customer),/not found/);
  await assert.rejects(()=>api('get',{id:record.id,version_id:finalId},customer),/not available|R&D access/);
  assert.equal((await api('list',{query:'QA simplified workflow',status:'hidden'})).total,1);
  assert.equal((await api('get',{id:record.id,version_id:initial.version_id})).status,'draft');
 })();
 await check('Archive leaves the active library and remains searchable through the Archive filter with matching totals',async()=>{
  record=await api('set_status',{id:record.id,revision:record.revision,status:'archive'});
  assert.equal((await api('list',{query:'QA simplified workflow'})).total,0);
  const archived=await api('list',{query:'QA simplified workflow',status:'archive',limit:1});assert.equal(archived.total,1);assert.equal(archived.rows[0].id,record.id);
  assert.equal((await api('list',{query:'QA simplified workflow',include_archived:true})).total,1);
  record=await api('set_status',{id:record.id,revision:record.revision,status:'final'});assert.equal((await api('get',{id:record.id},customer)).version_id,record.version_id);
 })();
 await check('explicitly returning to Draft withdraws Final without modifying its saved formula',async()=>{
  const previous=record;record=await api('set_status',{id:record.id,revision:record.revision,status:'draft'});
  assert.equal(record.production_version_id,null);assert.deepEqual(record.document,previous.document);assert.deepEqual(record.cost_snapshot,previous.cost_snapshot);
  await assert.rejects(()=>api('get',{id:record.id},customer),/not found/);
  assert.equal((await api('get',{id:record.id,version_id:previous.version_id})).status,'production');
 })();
 await check('Final still requires reviewed imports and nonempty ingredients; hidden saves cannot bypass owner permissions',async()=>{
  const d=document();d.import_review={reviewed:false};const imported=await api('create',{document:d,status:'draft'});
  await assert.rejects(()=>api('set_status',{id:imported.id,revision:imported.revision,status:'final'}),/Review imported/);
  const empty=blankRecipe();empty.name='Workflow empty recipe';empty.variants[0].groups=[];empty.variants[0].methods=[];
  const incomplete=await api('create',{document:empty,status:'draft'});await assert.rejects(()=>api('set_status',{id:incomplete.id,revision:incomplete.revision,status:'final'}),/Add ingredients/);
  await assert.rejects(()=>api('save',{id:record.id,revision:record.revision,document:record.document,status:'hidden'},staff),/owner/);
  record=await api('save',{id:record.id,revision:record.revision,document:record.document,status:'hidden'});assert.equal(record.production_version_id,null);
 })();
 await check('legacy Testing versions appear under R&D, Approved under Draft and Production under Final without rewrites',async()=>{
  const testing=await api('create',{document:{...document(),name:'QA legacy workflow testing'},status:'testing'});
  const approved=await api('create',{document:{...document(),name:'QA legacy workflow approved'},status:'approved'});
  const draft=await api('list',{query:'QA legacy workflow',status:'draft'});assert.equal(draft.total,1);assert.equal(draft.rows[0].id,approved.id);
  const rd=await api('list',{query:'QA legacy workflow',status:'testing'});assert.equal(rd.total,1);assert.equal(rd.rows[0].id,testing.id);
  const ready=await api('set_status',{id:approved.id,revision:approved.revision,status:'final'});assert.equal((await api('list',{query:'QA legacy workflow',status:'final'})).rows[0].id,ready.id);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.recipe_api_before_workflow(text,jsonb)','execute')"),false);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.recipe_status(text)','execute')"),false);
 })();
}
