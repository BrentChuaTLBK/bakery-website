import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
export default async function({db,check}){
 const h=await makeHarness(db),{owner,staff,customer}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 const document=name=>{const d=blankRecipe();d.name=name;d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Mix.';return d;};
 const create=async name=>api('create',{document:document(name),status:'draft'});
 const trash=async recipe=>api('delete',{id:recipe.id,revision:recipe.revision});
 const preview=id=>api('purge_preview',{scope:id?'one':'all_deleted',...id?{id}:{}});
 const purge=async id=>api('purge',{scope:id?'one':'all_deleted',...id?{id}:{},token:(await preview(id)).token,confirmed:true});
 const exists=id=>h.scalar('select count(*)::int from tlb.recipes where id=$1',[id]);
 await api('save_access',{user_id:staff,permission:'chef'});await api('save_access',{user_id:customer,permission:'kitchen'});
 const active=await create('Keep active');
 await check('purge is owner-only, trash-only, and requires an exact confirmed preview',async()=>{
  for(const user of [staff,customer,null])for(const action of ['purge_preview','purge'])await assert.rejects(()=>api(action,{scope:'all_deleted',confirmed:true},user));
  for(const scope of [null,'','all'])await assert.rejects(()=>api('purge_preview',{scope}));
  await assert.rejects(()=>preview(active.id),/Recently deleted/);
  const dead=await create('Confirm first');await trash(dead);const p=await preview(dead.id);
  for(const payload of [{},{confirmed:false},{confirmed:'true'},{confirmed:true,token:'bad'},{confirmed:true}])await assert.rejects(()=>api('purge',{scope:'one',id:dead.id,...payload}));
  assert.equal(await exists(dead.id),1);
  await api('undelete',{id:dead.id,revision:(await api('get',{id:dead.id})).revision});
  await assert.rejects(()=>api('purge',{scope:'one',id:dead.id,token:p.token,confirmed:true}),/Recently deleted/);
  await trash(await api('get',{id:dead.id}));await purge(dead.id);
 })();
 await check('single purge removes associated history, drafts, references and runs while preserving shared files and active recipes',async()=>{
  let dead=await create('Remove all saved history');
  dead=await api('save',{id:dead.id,revision:dead.revision,document:{...dead.document,description:'Second version'},status:'draft'});
  await db.query('insert into tlb.recipe_drafts(user_id,draft_id,recipe_id,document) values($1,$2,$3,$4)',[owner,randomUUID(),dead.id,JSON.stringify(dead.document)]);
  const test=(await db.query("insert into tlb.recipe_tests(recipe_id,version_id,number,data) values($1,$2,1,'{}') returning id",[dead.id,dead.version_id])).rows[0].id;
  await db.query("insert into tlb.recipe_runs(recipe_id,version_id,variant_id,multiplier,planned_yield,actual_yield,yield_unit,produced_on) values($1,$2,$3,'1',1,1,'batch',current_date)",[dead.id,dead.version_id,dead.document.variants[0].id]);
  const file=(await db.query("insert into tlb.recipe_files(path,filename,mime_type,size_bytes,sha256) values($1,'shared.png','image/png',1,$2) returning id",[randomUUID()+'.png','a'.repeat(64)])).rows[0].id;
  await db.query("insert into tlb.recipe_file_links(file_id,version_id,visibility) values($1,$2,'private'),($1,$3,'private')",[file,dead.version_id,active.version_id]);
  await db.query("insert into tlb.recipe_file_links(file_id,test_id,visibility) values($1,$2,'private')",[file,test]);
  await trash(dead);assert.equal((await purge(dead.id)).deleted,1);
  for(const table of ['recipes','recipe_versions','recipe_tests','recipe_drafts','recipe_runs','recipe_audit','recipe_user_state'])assert.equal(await h.scalar(`select count(*)::int from tlb.${table} where ${table==='recipes'?'id':'recipe_id'}=$1`,[dead.id]),0,table);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_file_links where file_id=$1',[file]),1);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_files where id=$1',[file]),1);
  assert.deepEqual((await api('get',{id:active.id})).document,active.document);
 })();
 await check('saved version, external draft and Academy dependencies block permanent deletion atomically',async()=>{
  const dead=await create('Referenced trash');await trash(dead);
  const d=await create('External history'),draftId=randomUUID();
  await db.query('insert into tlb.recipe_links(version_id,target_version_id,link_id,kind) values($1,$2,$3,$4)',[d.version_id,dead.version_id,'historic','component']);
  await assert.rejects(()=>purge(dead.id),/reference still uses it/);
  await db.query('delete from tlb.recipe_links where version_id=$1',[d.version_id]);
  await db.query("insert into tlb.recipe_drafts(user_id,draft_id,document) values($1,$2,$3)",[owner,draftId,JSON.stringify({name:'External draft',source_version_id:dead.version_id})]);
  await assert.rejects(()=>purge(dead.id),/External draft/);
  await db.query('delete from tlb.recipe_drafts where draft_id=$1',[draftId]);
  const academy=(await db.query("insert into tlb.academy_student_recipes(title,source_version_id) values('Class reference',$1) returning id",[dead.version_id])).rows[0].id;
  await assert.rejects(()=>purge(dead.id),/Academy: Class reference/);assert.equal(await exists(dead.id),1);
  await db.query('delete from tlb.academy_student_recipes where id=$1',[academy]);await purge(dead.id);
 })();
 await check('Delete all covers all trash pages, allows internal trash links, and cannot include active recipes through filters or IDs',async()=>{
  const dead=[];for(let i=0;i<26;i++){const r=await create('Trash '+i);await trash(r);dead.push(r);}
  const old=await preview();const extra=await create('Later trash');await trash(extra);
  await assert.rejects(()=>api('purge',{scope:'all_deleted',token:old.token,confirmed:true}),/changed/);
  await db.query('insert into tlb.recipe_links(version_id,target_version_id,link_id,kind) values($1,$2,$3,$4)',[dead[0].version_id,dead[1].version_id,'internal','component']);
  const p=await preview();assert.equal(p.count,27);
  const result=await api('purge',{scope:'all_deleted',id:active.id,query:'no matches',limit:1,token:p.token,confirmed:true});
  assert.equal(result.deleted,27);assert.equal((await preview()).count,0);assert.equal(await exists(active.id),1);
 })();
 await check('history remains immutable and private purge helpers have no direct execute or table-write grants',async()=>{
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.recipe_purge_api(text,jsonb)','execute')",[role]),false);
  await assert.rejects(()=>db.query("update tlb.recipe_versions set document=document||'{\"name\":\"Tampered\"}' where id=$1",[active.version_id]),/immutable/);
  await assert.rejects(()=>h.as(owner,async()=>{await db.query("select set_config('tlb.recipe_purge_ids',$1,true)",[active.id]);await db.query('delete from tlb.recipe_versions where id=$1',[active.version_id]);}),/permission denied/);
  assert.equal(await exists(active.id),1);
 })();
}
