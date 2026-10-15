import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {digestBytes} from '../../assets/ordering/recipe-archive.js';

// Exercise the public gateway as real roles. Direct SQL is limited to fixture
// upload completion, immutable-state assertions and private ACL inspection.
export default async function({db,check,state={}}){
 const h=state.recipeHarness||await makeHarness(db),{owner,staff:chef,customer:kitchen,stranger}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 const deny=(action,payload,user)=>assert.rejects(()=>api(action,payload,user),/access|permission|authorized|editor|owner|not found|not available/i,`${action} must deny an inaccessible recipe`);
 const fileAccess=(file,user,write=false)=>h.as(user,async()=>(await db.query('select public.recipe_file_access($1,$2) allowed',[file.path,write])).rows[0].allowed);
 const prefix='Owner privacy QA';
 const doc=name=>{const d=blankRecipe();d.name=`${prefix} ${name}`;d.description='Visibility security fixture';d.private_notes='OWNER_SECRET_NOTE';d.variants[0].yield={quantity:'1',unit:'cake',portions:'8'};d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g',cost_snapshot:{amount:'100',quantity:'1000',unit:'g'}}];d.variants[0].methods[0].steps[0].instruction='Mix and bake.';return d;};
 const bytes=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6v8AAAAASUVORK5CYII=','base64'));
 const photo=async(name,user=owner)=>{const f=await api('reserve_file',{filename:name,mime_type:'image/png',size_bytes:bytes.length,sha256:digestBytes(bytes)},user);await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[f.path,JSON.stringify({size:bytes.length,mimetype:'image/png'})]);await api('confirm_file',{id:f.id},user);return f;};
 const snapshot=async()=>Object.fromEntries(await Promise.all(['recipes','recipe_versions','recipe_tests','recipe_runs','recipe_drafts','recipe_resources','recipe_links','recipe_file_links'].map(async table=>[table,(await db.query(`select to_jsonb(t) row from tlb.${table} t order by to_jsonb(t)::text`)).rows])));
 let shared,privateFinal,privateOld,privateResearch,privateDraft,privateTest,sharedTest,privatePhoto,testPhoto,sharedPhoto,hiddenChefDraft;

 await check('owner visibility is independent of Chef and Kitchen R&D grants; omitted visibility retains shared defaults',async()=>{
  for(const [user,permission] of [[chef,'chef'],[kitchen,'kitchen']]){await api('save_access',{user_id:user,permission});await api('save_rd_access',{user_id:user,can_view_rd:true});}
  await api('staff_set_mode',{users:[kitchen],mode:'always'});
  for(const user of [chef,kitchen])assert.equal((await api('bootstrap',{},user)).can_view_rd,true);
  sharedPhoto=await photo('shared.png');privatePhoto=await photo('owner.png');testPhoto=await photo('owner-test.png');
  const sd=doc('shared Final');sd.files=[{id:sharedPhoto.id,visibility:'kitchen'}];shared=await api('create',{document:sd,status:'final'});
  assert.equal(shared.visibility,'staff');for(const user of [chef,kitchen])assert.equal((await api('get',{id:shared.id},user)).id,shared.id);
  const pd=doc('ONLYOWNERFINALXYZ');pd.files=[{id:privatePhoto.id,visibility:'kitchen'}];privateOld=await api('create',{document:pd,status:'final',visibility:'owner'});
  privateFinal=await api('save',{id:privateOld.id,revision:privateOld.revision,document:{...pd,description:'Second immutable version'},status:'final'});
  privateResearch=await api('create',{document:doc('ONLYOWNERRESEARCHXYZ'),status:'testing',visibility:'owner'});
  privateDraft=await api('create',{document:doc('ONLYOWNERDRAFTXYZ'),status:'draft',visibility:'owner'});
  privateTest=await api('save_test',{recipe_id:privateFinal.id,version_id:privateFinal.version_id,data:{observations:'PRIVATE_TEST_OBSERVATIONS',photos:[{id:testPhoto.id,path:testPhoto.path}]},proposed_document:privateFinal.document});
  sharedTest=await api('save_test',{recipe_id:shared.id,version_id:shared.version_id,data:{observations:'Shared observations'},proposed_document:shared.document});
  await api('record_run',{version_id:privateFinal.version_id,variant_id:privateFinal.document.variants[0].id,multiplier:'2',actual_yield:'2',produced_on:'2026-10-01',notes:'PRIVATE_RUN'});
  assert.equal(privateFinal.visibility,'owner');assert.equal((await api('get',{id:privateFinal.id})).visibility,'owner');
 })();

 await check('private recipes never enter staff list rows, counts, searches, filters or Chef costing summaries',async()=>{
  for(const user of [chef,kitchen]){
   const list=await api('list',{query:prefix},user);assert.equal(list.total,1);assert.deepEqual(list.rows.map(r=>r.id),[shared.id]);assert.equal(list.rows[0].visibility,'staff');
   for(const query of ['ONLYOWNERFINALXYZ','ONLYOWNERRESEARCHXYZ','ONLYOWNERDRAFTXYZ'])for(const extra of [{},{rd:true},{status:'final'},{status:'draft'},{include_archived:true}]){const result=await api('list',{query,...extra},user);assert.equal(result.total,0,`${user===chef?'Chef':'Kitchen'} list ${query} ${JSON.stringify(extra)} returned ${JSON.stringify(result)}`);assert.deepEqual(result.rows,[]);}
   assert.equal(JSON.stringify(await api('bootstrap',{},user)).includes('PRIVATE_'),false);
  }
  const all=await api('list',{query:prefix});assert.equal(all.total,4);assert.equal(all.rows.filter(r=>r.visibility==='owner').length,3);
  assert.equal((await api('costing_overview',{query:'ONLYOWNER',mode:'all'},chef)).total,0,'Chef private costing overview');
  assert.equal((await api('costing_overview',{query:shared.document.name,mode:'all'},chef)).total,1);
 })();

 await check('forged recipe, version, test and mixed parent IDs cannot read, copy, restore or mutate owner recipes',async()=>{
  const before=await snapshot();
  const requests=[
   ['get',{id:privateFinal.id}],['get',{id:privateFinal.id,version_id:privateOld.version_id}],['get',{id:privateResearch.id,rd:true}],
   ['get',{id:shared.id,version_id:privateOld.version_id}],['versions',{id:privateFinal.id}],['costing',{id:privateFinal.id}],
   ['costing',{id:shared.id,version_id:privateFinal.version_id}],['library_costs',{recipes:[{id:shared.id},{id:privateFinal.id,version_id:privateOld.version_id}]}],
   ['duplicate',{version_id:privateOld.version_id}],['duplicate',{version_id:privateOld.version_id,mode:'variation'}],
   ['restore_version',{version_id:privateOld.version_id,revision:privateFinal.revision}],
   ['save',{id:privateFinal.id,revision:privateFinal.revision,document:doc('forged replacement'),status:'draft'}],
   ['autosave',{id:privateFinal.id,draft_id:randomUUID(),revision:privateFinal.revision,document:doc('forged autosave')}],
   ['tests',{id:privateFinal.id}],['audit',{id:privateFinal.id}],['runs',{id:privateFinal.id}],
   ['save_test',{recipe_id:privateFinal.id,version_id:privateFinal.version_id,data:{observations:'forged'}}],
   ['save_test',{id:privateTest.id,recipe_id:shared.id,version_id:shared.version_id,revision:privateTest.revision,data:{observations:'cross-recipe overwrite'}}],
   ['save_test',{recipe_id:shared.id,version_id:privateFinal.version_id,data:{observations:'cross-recipe version'}}],
   ['promote_test',{test_id:privateTest.id,revision:privateFinal.revision}],
   ['record_run',{version_id:privateFinal.version_id,variant_id:privateFinal.document.variants[0].id,multiplier:'1',actual_yield:'1',produced_on:'2026-10-01'}],
   ['favorite',{id:privateFinal.id,favorite:true}],['set_status',{id:privateFinal.id,revision:privateFinal.revision,status:'final'}],
   ['delete',{id:privateFinal.id,revision:privateFinal.revision}],['undelete',{id:privateFinal.id,revision:privateFinal.revision}],
   ['set_visibility',{id:privateFinal.id,revision:privateFinal.revision,visibility:'staff'}]
  ];
  for(const user of [chef,kitchen])for(const [action,payload] of requests)await deny(action,payload,user);
  for(const action of ['get','scale','access_check'])await deny(action,{id:privateFinal.id,version_id:privateFinal.version_id,root_id:shared.id,root_version:shared.version_id},kitchen);
  assert.equal((await api('scale',{id:shared.id},kitchen)).allowed,true);
  assert.deepEqual(await snapshot(),before,'Denied requests must not change recipe data');
 })();

 await check('visibility changes require an owner and current revision without changing status, formulas, costs or version history',async()=>{
  let target=await api('create',{document:doc('transition Final'),status:'final'});
  const saved=await api('get',{id:target.id}),versions=await api('versions',{id:target.id});
  const auditBefore=(await api('audit',{id:target.id})).length;
  for(const user of [chef,kitchen,stranger,null])await deny('set_visibility',{id:target.id,revision:target.revision,visibility:'owner'},user);
  for(const visibility of ['','private','public',null,{},['owner']])await assert.rejects(()=>api('set_visibility',{id:target.id,revision:target.revision,visibility}));
  const restricted=await api('set_visibility',{id:target.id,revision:target.revision,visibility:'owner'});
  assert.equal(restricted.visibility,'owner');assert.equal(Number(restricted.revision),Number(target.revision)+1);
  for(const key of ['status','version','version_id','production_version_id','document','cost_snapshot'])assert.deepEqual(restricted[key],saved[key],key);
  assert.deepEqual(await api('versions',{id:target.id}),versions);assert.equal((await api('audit',{id:target.id})).length,auditBefore+1);
  const audit=(await api('audit',{id:target.id}))[0];assert.equal(audit.actor,owner);assert.match(audit.action,/visibility/);assert.match(JSON.stringify(audit.details),/owner/);assert.match(JSON.stringify(audit.details),/staff/);
  await assert.rejects(()=>api('set_visibility',{id:target.id,revision:target.revision,visibility:'staff'}),/changed|window|revision/i);
  for(const user of [chef,kitchen])await deny('get',{id:target.id},user);
  target=await api('set_visibility',{id:target.id,revision:restricted.revision,visibility:'staff'});
  for(const user of [chef,kitchen])assert.equal((await api('get',{id:target.id},user)).version_id,saved.version_id);
  assert.deepEqual(target.document,saved.document);assert.deepEqual(target.cost_snapshot,saved.cost_snapshot);
 })();

 await check('only owners can assign visibility through create, save or autosave and omission preserves an existing private recipe',async()=>{
  for(const visibility of ['owner','staff'])for(const user of [chef,kitchen]){
   await deny('create',{document:doc('forged visibility'),status:'draft',visibility},user);
   await deny('save',{id:shared.id,revision:shared.revision,document:shared.document,status:'draft',visibility},user);
   await deny('autosave',{draft_id:randomUUID(),document:doc('forged visibility draft'),visibility},user);
  }
  const saved=await api('save',{id:privateDraft.id,revision:privateDraft.revision,document:{...privateDraft.document,description:'Still private'},status:'draft'});assert.equal(saved.visibility,'owner');privateDraft=saved;
  const created=await api('create',{document:doc('Chef shared draft'),status:'draft'},chef);assert.equal(created.visibility,'staff');
  const updated=await api('save',{id:created.id,revision:created.revision,document:{...created.document,description:'Chef editing still works'},status:'draft'},chef);assert.equal(updated.visibility,'staff');
  const published=await api('save',{id:privateDraft.id,revision:privateDraft.revision,document:privateDraft.document,status:'draft',visibility:'staff'});assert.equal(published.visibility,'staff');
  privateDraft=await api('set_visibility',{id:published.id,revision:published.revision,visibility:'owner'});
 })();

 await check('owner duplicates and variations inherit owner visibility even when their status becomes Draft',async()=>{
  for(const mode of ['copy','variation','test']){const copy=await api('duplicate',{version_id:privateFinal.version_id,mode,name:`${prefix} private ${mode}`});assert.equal(copy.visibility,'owner');for(const user of [chef,kitchen])await deny('get',{id:copy.id,rd:mode==='test'},user);}
  const copy=await api('duplicate',{version_id:shared.version_id,name:`${prefix} shared copy`},chef);assert.equal(copy.visibility,'staff');assert.equal((await api('get',{id:copy.id},chef)).id,copy.id);
 })();

 await check('owner-only autosaves retain privacy and staff working copies disappear immediately when their recipe becomes private',async()=>{
  const standalone=randomUUID();await api('autosave',{draft_id:standalone,document:doc('private unsaved draft'),visibility:'owner'});
  assert.equal((await api('drafts')).find(d=>d.draft_id===standalone).visibility,'owner');
  await api('autosave',{draft_id:standalone,document:doc('private unsaved draft edited')});assert.equal((await api('drafts')).find(d=>d.draft_id===standalone).visibility,'owner');
  const target=await api('create',{document:doc('staff working copy'),status:'draft'});hiddenChefDraft=randomUUID();
  await api('autosave',{id:target.id,revision:target.revision,draft_id:hiddenChefDraft,document:target.document},chef);
  assert.ok((await api('drafts',{},chef)).some(d=>d.draft_id===hiddenChefDraft));
  const hidden=await api('set_visibility',{id:target.id,revision:target.revision,visibility:'owner'});
  assert.equal((await api('drafts',{},chef)).some(d=>d.draft_id===hiddenChefDraft),false);
  await deny('autosave',{draft_id:hiddenChefDraft,document:doc('draft ID reuse without recipe ID')},chef);
  await deny('autosave',{draft_id:hiddenChefDraft,id:shared.id,document:shared.document},chef);
  await api('set_visibility',{id:target.id,revision:hidden.revision,visibility:'staff'});
  assert.ok((await api('drafts',{},chef)).some(d=>d.draft_id===hiddenChefDraft));await api('remove_draft',{draft_id:hiddenChefDraft},chef);
 })();

 await check('an unsaved owner-only draft keeps the saved shared photo usable and cannot prevent explicit resharing',async()=>{
  const publishedPhoto=await photo('published-photo.png'),newDraftPhoto=await photo('new-private-draft-photo.png'),d=doc('shared recipe with private pending draft');d.files=[{id:publishedPhoto.id,visibility:'kitchen'}];
  let recipe=await api('create',{document:d,status:'final'});
  const pending={...recipe.document,files:[...recipe.document.files,{id:newDraftPhoto.id,visibility:'kitchen'}]};
  await api('autosave',{id:recipe.id,revision:recipe.revision,draft_id:randomUUID(),document:pending,visibility:'owner'});
  assert.equal((await api('get',{id:recipe.id})).visibility,'staff','Autosaving a visibility choice does not publish that choice');
  for(const user of [chef,kitchen])assert.equal((await api('get',{id:recipe.id},user)).id,recipe.id,'The saved shared recipe remains usable before Save');
  assert.equal(await fileAccess(publishedPhoto,chef),true);assert.equal(await fileAccess(newDraftPhoto,chef),false,'A genuinely new private draft attachment remains protected');
  recipe=await api('set_visibility',{id:recipe.id,revision:recipe.revision,visibility:'owner'});for(const user of [chef,kitchen])await deny('get',{id:recipe.id},user);
  assert.equal(await fileAccess(publishedPhoto,chef),false,'Publishing Owner only still protects the saved recipe attachment');
  recipe=await api('set_visibility',{id:recipe.id,revision:recipe.revision,visibility:'staff'});
  for(const user of [chef,kitchen])assert.equal((await api('get',{id:recipe.id},user)).id,recipe.id,'A retained private working draft cannot defeat explicit sharing');
  assert.equal(await fileAccess(publishedPhoto,chef),true);assert.equal(await fileAccess(newDraftPhoto,chef),false);
 })();

 await check('pinned historical components and variation bases cannot disclose owner recipes through shared parents',async()=>{
  for(const kind of ['component','base']){
   const d=doc(`parent with private ${kind}`);
   if(kind==='base')d.base={version_id:privateOld.version_id,name:privateOld.document.name};
   else d.variants[0].components=[{id:'private-component',version_id:privateOld.version_id,variant_id:privateOld.document.variants[0].id,quantity:'1',unit:'cake',mode:'pinned'}];
   for(const [action,payload] of [['create',{document:d,status:'draft'}],['save',{id:shared.id,revision:shared.revision,document:d,status:'draft'}],['cost_preview',{document:d}],['autosave',{draft_id:randomUUID(),document:d}],['save_test',{recipe_id:shared.id,version_id:shared.version_id,data:{observations:'Private proposed dependency'},proposed_document:d}]])await deny(action,payload,chef);
   const parent=await api('create',{document:d,status:'final'});assert.equal(parent.visibility,'staff');
   for(const user of [chef,kitchen]){assert.equal((await api('list',{query:parent.document.name},user)).total,0);await deny('get',{id:parent.id},user);}
   assert.equal((await api('costing_overview',{query:parent.document.name,mode:'all'},chef)).total,0);
   await deny('export_authorize',{version_ids:[parent.version_id]},chef);
   await deny('get',{id:privateOld.id,version_id:privateOld.version_id,root_id:parent.id,root_version:parent.version_id},kitchen);
  }
 })();

 await check('restricting a previously shared component immediately removes every linked parent until owner sharing is restored',async()=>{
  let child=await api('create',{document:doc('shared component'),status:'final'});const originalVersion=child.version_id;
  const d=doc('shared linked parent');d.variants[0].components=[{id:'child',version_id:child.version_id,variant_id:child.document.variants[0].id,quantity:'1',unit:'cake',mode:'pinned'}];const parent=await api('create',{document:d,status:'final'});
  for(const user of [chef,kitchen])assert.equal((await api('get',{id:parent.id},user)).id,parent.id);
  child=await api('save',{id:child.id,revision:child.revision,document:child.document,status:'final'});
  child=await api('set_visibility',{id:child.id,revision:child.revision,visibility:'owner'});
  for(const user of [chef,kitchen]){assert.equal((await api('list',{query:parent.document.name},user)).total,0);await deny('get',{id:parent.id},user);await deny('get',{id:child.id,version_id:originalVersion,root_id:parent.id,root_version:parent.version_id},user);}
  await api('set_visibility',{id:child.id,revision:child.revision,visibility:'staff'});for(const user of [chef,kitchen])assert.equal((await api('get',{id:parent.id},user)).id,parent.id);
 })();

 await check('private recipe and testing attachments cannot be read, signed or copied into recipes, drafts or resources by staff',async()=>{
  for(const file of [privatePhoto,testPhoto]){
   assert.equal(await fileAccess(file,owner),true);
   for(const user of [chef,kitchen]){assert.equal(await fileAccess(file,user),false);assert.equal(await fileAccess(file,user,true),false);await deny('media_authorize',{recipe_id:privateFinal.id,version_id:privateFinal.version_id,file_id:file.id},user);}
   const copied=doc('attachment laundering');copied.files=[{id:file.id,visibility:'kitchen'}];copied.photos=[{id:'photo',file_id:file.id}];
   for(const [action,payload] of [['create',{document:copied,status:'draft'}],['cost_preview',{document:copied}],['autosave',{draft_id:randomUUID(),document:copied}],['save_resource',{kind:'packaging',name:'Private photo laundering',data:{photos:[{file_id:file.id}]}}],['save_test',{recipe_id:shared.id,version_id:shared.version_id,data:{photos:[{id:file.id,path:file.path}]}}],['save_test',{id:sharedTest.id,recipe_id:shared.id,version_id:shared.version_id,revision:sharedTest.revision,data:{photos:[{id:file.id,path:file.path}]}}]])await deny(action,payload,chef);
  }
  assert.equal(await fileAccess(sharedPhoto,chef),true);assert.equal((await api('media_authorize',{recipe_id:shared.id,file_id:sharedPhoto.id},kitchen)).path,sharedPhoto.path);
 })();

 await check('a Chef uploader loses attachment access when an owner makes the attached recipe private',async()=>{
  const file=await photo('chef-upload.png',chef);assert.equal(await fileAccess(file,chef),true);assert.equal(await fileAccess(file,chef,true),false,'Confirmed uploads are already immutable');
  const d=doc('Chef uploaded attachment');d.files=[{id:file.id,visibility:'kitchen'}];let recipe=await api('create',{document:d,status:'final'});
  recipe=await api('set_visibility',{id:recipe.id,revision:recipe.revision,visibility:'owner'});
  assert.equal(await fileAccess(file,chef),false);assert.equal(await fileAccess(file,chef,true),false);
  await deny('confirm_file',{id:file.id},chef);
  assert.equal(await fileAccess(file,owner),true);
 })();

 await check('private test snapshots protect proposed-formula and nested-data attachments even without file-link rows',async()=>{
  for(const location of ['proposed_document','proposed_document_braced','proposed_document_uppercase','nested_data','proposed_path','nested_path']){
   const file=await photo(`private-test-${location}.png`),proposed=doc(`private proposed ${location}`);
   const data={observations:'Owner-only testing snapshot'};
   if(location.startsWith('proposed_document'))proposed.files=[{id:location.endsWith('braced')?`{${file.id}}`:location.endsWith('uppercase')?file.id.toUpperCase():file.id,visibility:'kitchen'}];
   else if(location==='proposed_path')proposed.photos=[{path:file.path,caption:'Legacy path-only proposed photo'}];
   else data.details={attachment:location==='nested_path'?{path:file.path}:{file_id:file.id}};
   const test=await api('save_test',{recipe_id:privateFinal.id,version_id:privateFinal.version_id,data,proposed_document:proposed});
   assert.ok(test.id);assert.equal(await h.scalar('select count(*)::int from tlb.recipe_file_links where file_id=$1',[file.id]),0,'This attachment deliberately bypasses the legacy file-link table');
   for(const user of [chef,kitchen])assert.equal(await fileAccess(file,user),false,`${location} attachment must be private`);
   assert.equal(await fileAccess(file,owner),true);
   await deny('save_resource',{kind:'packaging',name:`Cannot copy ${location}`,data:{photos:[{file_id:file.id}]}},chef);
   await api('save_test',{id:test.id,recipe_id:privateFinal.id,version_id:privateFinal.version_id,revision:test.revision,data:{observations:'Owner removed old attachment'},proposed_document:doc('Private revised test')});
   assert.equal(await fileAccess(file,chef),false,`${location} attachment remains private in its immutable audit history`);
  }
 })();

 await check('private dependencies in shared testing snapshots and working drafts also protect their unlinked attachments',async()=>{
  for(const location of ['test_base','test_component','test_base_braced','test_base_uppercase','test_component_compact','draft_base','draft_component','draft_path_base']){
   const file=await photo(`${location}.png`),proposed=doc(`shared ${location}`);proposed.files=[{id:file.id,visibility:'kitchen'}];
   if(location==='draft_path_base'){proposed.files=[];proposed.photos=[{path:file.path,caption:'Legacy path-only draft photo'}];}
   const versionRef=location.endsWith('braced')?`{${privateOld.version_id}}`:location.endsWith('uppercase')?privateOld.version_id.toUpperCase():location.endsWith('compact')?privateOld.version_id.replaceAll('-',''):privateOld.version_id;
   if(location.includes('base'))proposed.base={version_id:versionRef,name:privateOld.document.name};
   else proposed.variants[0].components=[{id:'private-component',version_id:versionRef,variant_id:privateOld.document.variants[0].id,quantity:'1',unit:'cake',mode:'pinned'}];
   if(location.startsWith('test')){
    const test=await api('save_test',{recipe_id:shared.id,version_id:shared.version_id,data:{observations:'Proposed formula with owner-only dependency'},proposed_document:proposed});
    assert.equal((await api('tests',{id:shared.id},chef)).some(t=>t.id===test.id),false,'The proposed formula must stay hidden');
    await deny('save_test',{id:test.id,recipe_id:shared.id,version_id:shared.version_id,revision:test.revision,data:{observations:'Chef tried to replace hidden test'},proposed_document:shared.document},chef);
    await api('save_test',{id:test.id,recipe_id:shared.id,version_id:shared.version_id,revision:test.revision,data:{observations:'Owner removed hidden proposal'},proposed_document:shared.document});
    assert.equal((await api('tests',{id:shared.id},chef)).some(t=>t.id===test.id),true,'An owner can replace a hidden proposal with an entirely shared one');
   }else await api('autosave',{id:shared.id,revision:shared.revision,draft_id:randomUUID(),document:proposed});
   assert.equal(await h.scalar('select count(*)::int from tlb.recipe_file_links where file_id=$1',[file.id]),0);
   for(const user of [chef,kitchen])assert.equal(await fileAccess(file,user),false,`${location} dependency must protect its attachment`);
   await deny('save_resource',{kind:'packaging',name:`Cannot copy ${location}`,data:{photos:[{file_id:file.id}]}},chef);
  }
 })();

 await check('a shared resource cannot launder owner-only photos or their metadata into staff catalog responses',async()=>{
  const resource=await api('save_resource',{kind:'packaging',name:`${prefix} shared packaging photo`,data:{photos:[{file_id:privatePhoto.id,caption:'PRIVATE_RESOURCE_CAPTION'}]}});
  const catalog=await api('resources',{kind:'packaging',query:resource.name},chef);assert.ok(catalog.rows.some(r=>r.id===resource.id));
  for(const secret of [privatePhoto.id,privatePhoto.path,'PRIVATE_RESOURCE_CAPTION'])assert.equal(JSON.stringify(catalog).includes(secret),false,secret);
  assert.equal(await fileAccess(privatePhoto,chef),false,'Shared resource references do not override private attachment ownership');
  const testResource=await api('save_resource',{kind:'packaging',name:`${prefix} shared test photo`,data:{photos:[{file_id:testPhoto.id}]}});
  const testsCatalog=await api('resources',{kind:'packaging',query:testResource.name},chef);for(const secret of [testPhoto.id,testPhoto.path])assert.equal(JSON.stringify(testsCatalog).includes(secret),false,secret);
 })();

 await check('export authorization rechecks prepared versions and rejects private, mixed or malformed version IDs',async()=>{
  assert.equal((await api('export_authorize',{version_ids:[shared.version_id]},chef)).allowed,true);
  assert.equal((await api('export_authorize',{version_ids:[privateFinal.version_id]})).allowed,true);
  for(const user of [chef,kitchen])for(const version_ids of [[privateFinal.version_id],[shared.version_id,privateOld.version_id]])await deny('export_authorize',{version_ids},user);
  for(const version_ids of [null,'not-an-array',[null],['not-a-uuid'],[{}]])await assert.rejects(()=>api('export_authorize',{version_ids},chef));
  await deny('export_authorize',{version_ids:[randomUUID()]},chef);
  let prepared=await api('create',{document:doc('prepared print'),status:'final'});assert.equal((await api('export_authorize',{version_ids:[prepared.version_id]},chef)).allowed,true);
  prepared=await api('set_visibility',{id:prepared.id,revision:prepared.revision,visibility:'owner'});await deny('export_authorize',{version_ids:[prepared.version_id]},chef);
 })();

 await check('new visibility helpers and delegated gateways grant no direct authenticated, anonymous or service access',async()=>{
  const helpers=(await db.query("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tlb' and p.proname like 'recipe_%'")).rows;
  assert.ok(helpers.some(h=>/visibility|owner/.test(h.signature)),'The new privacy helpers must be included in this ACL check');
  for(const {signature} of helpers)for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,$2,'execute')",[role,signature]),false,`${role}: ${signature}`);
  for(const user of [chef,kitchen,stranger])await assert.rejects(()=>h.as(user,()=>db.query('select visibility from tlb.recipes')),/permission denied/);
 })();

 await check('public recipe and Storage authorization stay responsive with 1,000 saved versions and private history',async()=>{
  // Bulk SQL creates historical fixtures only; the measured operations use the
  // authenticated public gateways. One private recipe prevents the all-shared
  // fast path from masking a repeated scan across the entire library.
  const codePrefix=`VIS-PERF-${randomUUID().slice(0,8)}-`,history=doc('Performance history');
  await db.query("insert into tlb.recipes(id,code,name,visibility,created_by) select gen_random_uuid(),$2||n::text,'Visibility performance history '||n,case when n=1 then 'owner' else 'staff' end,$1::uuid from generate_series(1,1000)n",[owner,codePrefix]);
  await db.query("insert into tlb.recipe_versions(recipe_id,number,status,document,created_by) select id,1,'production',$1::jsonb,$2::uuid from tlb.recipes where code like $3||'%'",[JSON.stringify(history),owner,codePrefix]);
  await db.query("update tlb.recipes r set current_version_id=v.id,production_version_id=v.id from tlb.recipe_versions v where v.recipe_id=r.id and r.code like $1||'%'",[codePrefix]);
  await db.query("insert into tlb.recipe_audit(recipe_id,actor,action,details) select id,$1::uuid,'version_created',jsonb_build_object('version_id',current_version_id,'document',$2::jsonb) from tlb.recipes where code like $3||'%' order by code limit 150",[owner,JSON.stringify(history),codePrefix]);
  await db.query("insert into tlb.recipe_drafts(user_id,draft_id,recipe_id,document) select $1::uuid,gen_random_uuid(),id,$2::jsonb from tlb.recipes where code like $3||'%' order by code limit 5",[owner,JSON.stringify(history),codePrefix]);
  await db.query("insert into tlb.recipe_tests(recipe_id,version_id,number,data,proposed_document,created_by,updated_by) select id,current_version_id,1,'{}',$1::jsonb,$2::uuid,$2::uuid from tlb.recipes where code like $3||'%' order by code limit 8",[JSON.stringify(history),owner,codePrefix]);
  assert.equal(await h.scalar("select count(*)::int from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id where r.code like $1||'%'",[codePrefix]),1000);
  const image=await photo('performance-shared.png'),document=doc('Performance public read');document.files=[{id:image.id,visibility:'kitchen'}];
  const recipe=await api('create',{document,status:'final'}),started=performance.now();
  for(let i=0;i<3;i++)assert.equal((await api('get',{id:recipe.id},chef)).id,recipe.id);
  const access=await api('access_check',{id:recipe.id,version_id:recipe.version_id},chef);assert.equal(access.access.allowed,true);
  assert.equal(await fileAccess(image,chef),true);assert.equal(await fileAccess(privatePhoto,chef),false);
  const elapsed=performance.now()-started;
  assert.ok(elapsed<4000,`Six authenticated public reads took ${Math.round(elapsed)}ms; expected under 4000ms for this in-memory fixture`);
 })();

}
