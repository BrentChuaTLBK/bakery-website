import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';

export default async function({db,check,state}){
 const h=state.recipeHarness||await makeHarness(db),{owner,staff:chef,customer:kitchen,stranger}=h.ids;
 const previousAudits=Number((await db.query("select count(*) n from tlb.recipe_audit where action='rd_access_changed' and actor=$1",[owner])).rows[0].n);
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const fileAccess=(file,user)=>h.as(user,async()=>(await db.query('select public.recipe_file_access($1,false) allowed',[file.path])).rows[0].allowed);
 const doc=name=>{const d=blankRecipe();d.name=name;d.private_notes='RESEARCH_PRIVATE';d.variants[0].groups[0].ingredients[0]={id:'flour',name:'Flour',quantity:'10',unit:'g',cost_snapshot:{amount:'10',quantity:'1000',unit:'g'}};d.variants[0].methods[0].steps[0].instruction='Mix.';return d;};
 async function photo(name){const f=await api('reserve_file',{filename:name,mime_type:'image/png',size_bytes:16,sha256:'0'.repeat(64)});await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,'{\"size\":16,\"mimetype\":\"image/png\"}')",[f.path]);await api('confirm_file',{id:f.id});return f;}
 let research,published,working,parent,test,rdFile,testFile,sharedFile,draftId,early;
 await check('R&D defaults off, owners retain access and only an owner can change the global flag',async()=>{
  await api('save_access',{user_id:chef,permission:null});await api('save_access',{user_id:kitchen,permission:null});
  await api('save_access',{user_id:chef,permission:'chef'});await api('save_access',{user_id:kitchen,permission:'kitchen'});
  assert.equal((await api('bootstrap',{},chef)).can_view_rd,false);assert.equal((await api('bootstrap',{},kitchen)).can_view_rd,false);assert.equal((await api('bootstrap')).can_view_rd,true);
  for(const user of [chef,kitchen,stranger])await assert.rejects(()=>api('save_rd_access',{user_id:chef,can_view_rd:true},user),/owner|Authorized/);
  await assert.rejects(()=>api('save_rd_access',{user_id:owner,can_view_rd:false}),/Owners retain/);
  await assert.rejects(()=>api('save_rd_access',{user_id:stranger,can_view_rd:true}),/recipe access first/);
  await assert.rejects(()=>api('create',{document:doc('Attempted R&D'),status:'testing'},chef),/R&D access/);
 })();
 await check('restricted recipe names, search terms, counts and costs stay absent while the last Final remains accessible',async()=>{
  rdFile=await photo('rd-only.png');sharedFile=await photo('published.png');testFile=await photo('test-only.png');
  const researchDoc=doc('QA RESEARCH_NEVER_PUBLIC');researchDoc.files=[{...rdFile,visibility:'kitchen'}];research=await api('create',{document:researchDoc,status:'testing'});
  const finalDoc=doc('QA public reference');finalDoc.files=[{...sharedFile,visibility:'kitchen'}];published=await api('create',{document:finalDoc,status:'final'});
  early=await api('save',{id:published.id,revision:published.revision,document:doc('QA intermediate research'),status:'draft'});
  working=await api('save',{id:early.id,revision:early.revision,document:{...early.document,name:'QA RESEARCH_NEW_NAME'},status:'testing'});
  test=await api('save_test',{recipe_id:published.id,version_id:published.version_id,data:{observations:'RESEARCH_OBSERVATIONS',photos:[{id:testFile.id,path:testFile.path}]},proposed_document:researchDoc});
  for(const user of [chef,kitchen]){
   for(const query of ['RESEARCH_NEVER_PUBLIC','RESEARCH_NEW_NAME']){const list=await api('list',{query},user);assert.equal(list.total,0);assert.deepEqual(list.rows,[]);}
   assert.equal((await api('list',{query:'QA public reference'},user)).total,1);
   const saved=await api('get',{id:published.id},user);assert.equal(saved.version_id,published.version_id);assert.equal(saved.document.name,'QA public reference');assert.equal(saved.rd_restricted,true);
   await assert.rejects(()=>api('get',{id:research.id},user),/not found|R&D access/);
   await assert.rejects(()=>api('get',{id:working.id,version_id:working.version_id},user),/R&D access/);
  }
  assert.equal((await api('costing_overview',{query:'RESEARCH_NEW_NAME',mode:'all'},chef)).total,0);
  assert.equal((await api('costing_overview',{query:'QA public reference',mode:'all'},chef)).total,1);
  assert.equal((await api('costing',{id:published.id},chef)).version_id,published.version_id);
  const versions=await api('versions',{id:working.id},chef);assert.deepEqual(versions.map(v=>v.id),[published.version_id]);
  assert.equal((await api('bootstrap',{},kitchen)).authors.length,0);
 })();
 await check('direct version, duplicate, restore, draft, log and cost-preview paths cannot bypass R&D visibility',async()=>{
  for(const [action,payload] of [
   ['get',{id:working.id,version_id:early.version_id}],['costing',{id:research.id,version_id:research.version_id}],
   ['duplicate',{version_id:research.version_id}],['restore_version',{version_id:early.version_id,revision:working.revision}],
   ['restore_version',{version_id:published.version_id,revision:working.revision}],
   ['save',{id:working.id,revision:working.revision,document:published.document,status:'draft'}],
   ['autosave',{id:research.id,draft_id:randomUUID(),document:research.document}],
   ['tests',{id:published.id}],['save_test',{recipe_id:published.id,version_id:published.version_id,data:{observations:'attempt'}}],
   ['promote_test',{test_id:test.id,revision:working.revision}],['audit',{id:working.id}]
  ])await assert.rejects(()=>api(action,payload,chef),/R&D access/);
  const linked=doc('QA research dependency');linked.variants[0].components=[{id:'rd-link',version_id:research.version_id,variant_id:research.document.variants[0].id,quantity:'1',name:research.document.name}];
  for(const action of ['create','cost_preview','autosave'])await assert.rejects(()=>api(action,{document:linked,draft_id:randomUUID()},chef),/R&D access/);
  const variation=doc('QA restricted base');variation.base={version_id:research.version_id,name:research.document.name};
  await assert.rejects(()=>api('cost_preview',{document:variation},chef),/R&D access/);
  parent=await api('create',{document:linked,status:'draft'});assert.equal((await api('list',{query:parent.document.name},chef)).total,0);
  await assert.rejects(()=>api('get',{id:parent.id,version_id:parent.version_id},chef),/R&D access/);
 })();
 await check('R&D-only and test-only file links are denied while published files remain usable',async()=>{
  for(const user of [chef,kitchen]){assert.equal(await fileAccess(rdFile,user),false);assert.equal(await fileAccess(testFile,user),false);assert.equal(await fileAccess(sharedFile,user),true);}
  assert.equal(await fileAccess(rdFile,owner),true);
  const copied=doc('QA file bypass');copied.files=[{id:rdFile.id,visibility:'kitchen'}];
  await assert.rejects(()=>api('create',{document:copied},chef),/R&D access/);
  await assert.rejects(()=>api('save_resource',{kind:'packaging',name:'QA file bypass',data:{photos:[{file_id:rdFile.id}]}},chef),/R&D access/);
 })();
 await check('one global grant enables every R&D recipe and Chef test logs without granting publishing rights',async()=>{
  await api('save_rd_access',{user_id:chef,can_view_rd:true});
  assert.equal((await api('bootstrap',{},chef)).can_view_rd,true);assert.equal((await api('access')).find(p=>p.user_id===chef).can_view_rd,true);
  for(const r of [research,working])assert.equal((await api('get',{id:r.id},chef)).version_id,r.version_id);
  assert.equal((await api('tests',{id:published.id},chef))[0].id,test.id);assert.equal(await fileAccess(testFile,chef),true);
  research=await api('save',{id:research.id,revision:research.revision,document:research.document,status:'testing'},chef);
  draftId=randomUUID();await api('autosave',{id:research.id,revision:research.revision,draft_id:draftId,status:'testing',document:research.document},chef);
  assert.equal((await api('drafts',{},chef)).find(d=>d.draft_id===draftId).requires_rd,true);
  await assert.rejects(()=>api('set_status',{id:research.id,revision:research.revision,status:'final'},chef),/owner/);
  await assert.rejects(()=>api('save',{id:research.id,revision:research.revision,document:research.document,status:'final'},chef),/owner/);
 })();
 await check('Kitchen R&D access is read-only and keeps costs, private notes and test attachments private',async()=>{
  await api('save_rd_access',{user_id:kitchen,can_view_rd:true});
  const rd=await api('list',{rd:true},kitchen);assert.ok(rd.rows.some(r=>r.id===research.id));assert.ok(rd.rows.some(r=>r.id===working.id));assert.ok(rd.rows.every(r=>r.status==='testing'));
  const r=await api('get',{id:research.id,rd:true},kitchen);assert.equal(r.version_id,research.version_id);assert.equal(r.cost_snapshot,null);assert.equal(r.document.private_notes,undefined);
  assert.equal((await api('get',{id:working.id},kitchen)).version_id,published.version_id);
  assert.equal(await fileAccess(rdFile,kitchen),true);assert.equal(await fileAccess(testFile,kitchen),false);
  for(const action of ['costing','tests','save_test','save'])await assert.rejects(()=>api(action,{id:research.id,recipe_id:research.id,document:research.document},kitchen),/editor/);
 })();
 await check('revocation immediately blocks new reads, hidden drafts and file links without rewriting any saved formulas',async()=>{
  const before=(await db.query('select id,document,cost_snapshot from tlb.recipe_versions order by id')).rows;
  for(const user of [chef,kitchen])await api('save_rd_access',{user_id:user,can_view_rd:false});
  for(const user of [chef,kitchen]){await assert.rejects(()=>api('list',{rd:true},user),/R&D access/);await assert.rejects(()=>api('get',{id:research.id,version_id:research.version_id},user),/R&D access/);assert.equal(await fileAccess(rdFile,user),false);}
  assert.equal((await api('drafts',{},chef)).some(d=>d.draft_id===draftId),false);
  await assert.rejects(()=>api('autosave',{draft_id:draftId,document:doc('Unrestricted attempt')},chef),/R&D access/);
  assert.deepEqual((await db.query('select id,document,cost_snapshot from tlb.recipe_versions order by id')).rows,before);
  await api('save_rd_access',{user_id:chef,can_view_rd:true});await api('save_access',{user_id:chef,permission:null});await api('save_access',{user_id:chef,permission:'chef'});assert.equal((await api('bootstrap',{},chef)).can_view_rd,false);
 })();
 await check('all new R&D helpers and delegated APIs remain private',async()=>{
  for(const signature of ['tlb.recipe_can_view_rd()','tlb.recipe_version_visible(uuid)','tlb.recipe_listing_version(uuid,boolean,boolean)','tlb.recipe_document_visible(jsonb)','tlb.recipe_file_visible(uuid)','tlb.recipe_hidden_versions()','tlb.recipe_api_before_rd_access(text,jsonb)']){
   for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
  }
  assert.equal((await db.query("select count(*)::int n from tlb.recipe_audit where action='rd_access_changed' and actor=$1",[owner])).rows[0].n-previousAudits,5);
 })();
}
