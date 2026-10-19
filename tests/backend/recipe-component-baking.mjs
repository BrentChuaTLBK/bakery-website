import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe,addComponent,freshVariant,scaledCopy} from '../../assets/ordering/recipe-model.js';

const createApi=(db,h)=>(action,payload={},user=h.ids.owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
const bake=record=>record.document.variants[0].baking;
function document(name,{single=false,linked=true}={}){
 const d=blankRecipe();d.name=name;d.private_notes='PRIVATE_BAKING_OWNER_NOTE';
 const v=d.variants[0];v.groups[0].name='Original batter';if(!single)addComponent(v,'Chocolate batter');
 for(const [index,g] of v.groups.entries()){
  g.ingredients=[{id:randomUUID(),name:index?'Cocoa':'Flour',quantity:'100',unit:'g',cost_snapshot:{amount:'200',quantity:'1000',unit:'g'}}];
  v.methods[index].steps[0].instruction=index?'Fold in the cocoa.':'Mix the original batter.';
 }
 v.baking=[{id:randomUUID(),name:'Initial bake',top:'300',bottom:'200',minutes:'12',actual_bottom:'190',temperature:'180',fan:'Low',core:'55',ingredient_temperature:'20',batter_temperature:'23',resting_temperature:'22',cooling_minutes:'30',freezing_minutes:'0',notes:'Cool on a rack.',private_notes:'PRIVATE_STAGE_SECRET',supplier_price:'PRIVATE_STAGE_PRICE'},
  {id:randomUUID(),name:'Browning',top:'320',minutes:'3',notes:'Watch the surface.'}];
 if(linked){v.baking[0].group_id=v.groups[0].id;v.baking[1].group_id=v.groups.at(-1).id;}
 return d;
}
async function legacySnapshot(db,ids){
 const tables=['recipes','recipe_versions','recipe_tests','recipe_drafts'],result={};
 for(const table of tables)result[table]=(await db.query(`select to_jsonb(t) value from tlb.${table} t where ${table==='recipes'?'id':'recipe_id'}=any($1::uuid[]) order by to_jsonb(t)::text`,[ids])).rows;
 return result;
}

// Run against the immediately preceding schema, so migration compatibility is
// checked with actual persisted legacy versions, a draft, and an R&D proposal.
export async function beforeMigration({db,state}){
 const h=await makeHarness(db),api=createApi(db,h),records=[];
 for(const single of [false,true])records.push(await api('create',{document:document(`Baking upgrade ${single?'single':'multiple'} components`,{single,linked:false}),status:'final'}));
 const draftId=randomUUID(),draft=structuredClone(records[0].document);draft.variants[0].baking[0].top='301';
 await api('autosave',{id:records[0].id,draft_id:draftId,revision:records[0].revision,document:draft});
 await api('save_test',{recipe_id:records[0].id,version_id:records[0].version_id,data:{observations:'Preserve pending bake test.'},proposed_document:draft});
 const ids=records.map(r=>r.id);
 state.componentBakingUpgrade={h,records,draftId,snapshot:await legacySnapshot(db,ids),academyDefinition:await h.scalar("select pg_get_functiondef('tlb.academy_recipe_document(jsonb)'::regprocedure)")};
}

export default async function({db,check,state={}}){
 const upgrade=state.componentBakingUpgrade,h=upgrade?.h||state.recipeHarness||await makeHarness(db),api=createApi(db,h);
 const {owner,staff:chef,customer:kitchen,stranger}=h.ids;
 const deny=(action,payload,user)=>assert.rejects(()=>api(action,payload,user),/access|permission|authorized|editor|owner|not found|not available|schedule|blocked/i);
 let saved,original;
 await check('component baking migration preserves existing versions, pending drafts, and R&D records byte-for-byte',async()=>{
  assert.ok(upgrade,'The runner must seed legacy records before applying this migration.');
  assert.deepEqual(await legacySnapshot(db,upgrade.records.map(r=>r.id)),upgrade.snapshot);
  assert.equal(await h.scalar("select pg_get_functiondef('tlb.academy_recipe_document(jsonb)'::regprocedure)"),upgrade.academyDefinition);
  for(const record of upgrade.records){const current=await api('get',{id:record.id});assert.deepEqual(bake(current),bake(record));assert(bake(current).every(stage=>!Object.hasOwn(stage,'group_id')));}
 })();
 await check('component baking saves and reloads all stage fields and bindings without changing costing',async()=>{
  await api('save_access',{user_id:chef,permission:'chef'});await api('save_rd_access',{user_id:chef,can_view_rd:true});
  await api('save_access',{user_id:kitchen,permission:'kitchen'});await api('staff_set_mode',{users:[kitchen],mode:'always'});
  const d=document('Component baking saved recipe'),without=structuredClone(d);without.variants[0].baking=[];
  const before=(await api('cost_preview',{document:without})).snapshot.variants[0];
  saved=await api('create',{document:d,status:'final'});original=structuredClone(saved);
  assert.deepEqual(bake(saved),d.variants[0].baking);assert.deepEqual(bake(await api('get',{id:saved.id})),bake(saved));
  for(const key of ['total','base_cost','adjusted_cost','ingredient_cost','complete'])assert.equal(saved.cost_snapshot.variants[0][key],before[key]);
 })();
 await check('kitchen staff receive component bindings and every allowed baking field, without private extras or costs',async()=>{
  const record=await api('get',{id:saved.id},kitchen),stages=bake(record),source=bake(saved);
  for(const field of ['id','name','group_id','top','bottom','actual_bottom','temperature','fan','minutes','core','ingredient_temperature','batter_temperature','resting_temperature','cooling_minutes','freezing_minutes','notes'])assert.equal(stages[0][field],source[0][field],field);
  assert.equal(stages[0].freezing_minutes,'0');assert.equal(stages[1].group_id,source[1].group_id);
  assert.doesNotMatch(JSON.stringify(record),/PRIVATE_BAKING_OWNER_NOTE|PRIVATE_STAGE_SECRET|PRIVATE_STAGE_PRICE|cost_snapshot|supplier_price/);
  assert.equal(record.cost_snapshot,undefined);
 })();
 await check('invalid and cross-size baking bindings fail atomically on saves, cost previews, and R&D proposals',async()=>{
  const before=await api('get',{id:saved.id}),count=await h.scalar('select count(*) from tlb.recipe_versions where recipe_id=$1',[saved.id]);
  for(const groupId of ['missing',123,{},'x'.repeat(101)]){
   const broken=structuredClone(before.document);broken.variants[0].baking[0].group_id=groupId;
   await assert.rejects(()=>api('save',{id:saved.id,revision:saved.revision,document:broken,status:'draft'}),/existing component.*baking/i);
   await assert.rejects(()=>api('cost_preview',{document:broken}),/existing component.*baking/i);
   await assert.rejects(()=>api('save_test',{recipe_id:saved.id,version_id:saved.version_id,data:{observations:'Invalid binding'},proposed_document:broken}),/existing component.*baking/i);
  }
  const crossSize=structuredClone(before.document),other=freshVariant(crossSize.variants[0],'Another size');other.baking=[];crossSize.variants.push(other);crossSize.variants[0].baking[0].group_id=other.groups[0].id;
  await assert.rejects(()=>api('save',{id:saved.id,revision:saved.revision,document:crossSize,status:'draft'}),/existing component.*baking/i);
  assert.equal(await h.scalar('select count(*) from tlb.recipe_versions where recipe_id=$1',[saved.id]),count);
  assert.deepEqual(await api('get',{id:saved.id}),before);
 })();
 await check('missing and explicit empty baking bindings remain compatible and retain stage order',async()=>{
  const d=document('Compatible unassigned baking',{linked:false});d.variants[0].baking[1].group_id='';
  const record=await api('create',{document:d,status:'final'}),k=await api('get',{id:record.id},kitchen);
  assert.deepEqual(bake(record),d.variants[0].baking);
  assert.equal(Object.hasOwn(bake(k)[0],'group_id'),false);assert.equal(bake(k)[1].group_id,'');
  assert.deepEqual(bake(k).map(s=>s.name),['Initial bake','Browning']);
 })();
 await check('working drafts and chef saves preserve bindings while the approved kitchen version stays unchanged',async()=>{
  const changed=structuredClone(saved.document);changed.variants[0].baking.reverse();changed.variants[0].baking[0].minutes='4';changed.variants[0].groups.reverse();
  const draftId=randomUUID();await api('autosave',{id:saved.id,draft_id:draftId,revision:saved.revision,document:changed},chef);
  const draft=(await api('drafts',{},chef)).find(d=>d.draft_id===draftId);assert.deepEqual(draft.document.variants[0].baking,changed.variants[0].baking);
  saved=await api('save',{id:saved.id,revision:saved.revision,document:changed,status:'draft'},chef);
  assert.deepEqual(bake(saved),changed.variants[0].baking);assert.deepEqual(bake(await api('get',{id:original.id,version_id:original.version_id})),bake(original));
  const approved=await api('get',{id:saved.id},kitchen);assert.equal(approved.version_id,original.version_id);assert.deepEqual(bake(approved).map(s=>[s.id,s.group_id,s.minutes]),bake(original).map(s=>[s.id,s.group_id,s.minutes]));
 })();
 await check('R&D proposals and promotion retain component baking without modifying earlier saved versions',async()=>{
  const proposed=structuredClone(saved.document);proposed.variants[0].baking[0].top='310';
  const log=await api('save_test',{recipe_id:saved.id,version_id:saved.version_id,data:{observations:'Shorter browning'},proposed_document:proposed},chef);
  assert.deepEqual((await api('tests',{id:saved.id},chef)).find(t=>t.id===log.id).proposed_document.variants[0].baking,proposed.variants[0].baking);
  assert.equal((await api('get',{id:saved.id},kitchen)).version_id,original.version_id);
  await deny('promote_test',{test_id:log.id,revision:saved.revision,status:'final'},chef);
  saved=await api('promote_test',{test_id:log.id,revision:saved.revision,status:'final',reason:'Approve component bake test'});
  assert.deepEqual(bake(saved),proposed.variants[0].baking);
  assert.deepEqual(bake(await api('get',{id:original.id,version_id:original.version_id})),bake(original));
  assert.deepEqual(bake(await api('get',{id:saved.id},kitchen)).map(s=>[s.id,s.group_id,s.top]),bake(saved).map(s=>[s.id,s.group_id,s.top]));
 })();
 await check('recipe duplication and version restoration preserve bindings and historical baking values',async()=>{
  const duplicate=await api('duplicate',{version_id:saved.version_id});assert.notEqual(duplicate.id,saved.id);assert.deepEqual(bake(duplicate),bake(saved));
  const before=structuredClone(saved);saved=await api('restore_version',{version_id:original.version_id,revision:saved.revision,status:'draft',reason:'Review original bake'});
  assert.deepEqual(bake(saved),bake(original));assert.deepEqual(bake(await api('get',{id:before.id,version_id:before.version_id})),bake(before));
  const kitchenVersion=await api('get',{id:saved.id},kitchen);assert.equal(kitchenVersion.version_id,before.version_id);
 })();
 await check('scaled saved copies remap local components and keep temperatures, timing, notes, and order unchanged',async()=>{
  const source=structuredClone(original.document),copy=scaledCopy(source,source.variants[0].id,'2'),before=structuredClone(source),record=await api('create',{document:copy,status:'draft'});
  const sourceSize=source.variants[0],copySize=record.document.variants[0];
  for(const [index,stage] of copySize.baking.entries()){
   const {id,group_id,...values}=stage,{id:sourceId,group_id:sourceGroup,...sourceValues}=sourceSize.baking[index];
   assert.deepEqual(values,sourceValues);assert.notEqual(id,sourceId);
   assert.equal(group_id,copySize.groups[sourceSize.groups.findIndex(g=>g.id===sourceGroup)].id);assert.notEqual(group_id,sourceGroup);
  }
  assert.equal(copySize.groups[0].ingredients[0].quantity,'200');assert.deepEqual(source,before);
 })();
 await check('legacy recipes remain editable and restorable without assigning their baking data',async()=>{
  for(const old of upgrade.records){
   const d=structuredClone(old.document);d.description='Legacy recipe remains editable';
   const edited=await api('save',{id:old.id,revision:old.revision,document:d,status:'draft'});
   assert.deepEqual(bake(edited),bake(old));const restored=await api('restore_version',{version_id:old.version_id,revision:edited.revision,status:'draft'});
   assert.deepEqual(bake(restored),bake(old));assert.deepEqual(bake(await api('get',{id:old.id,version_id:old.version_id})),bake(old));
  }
 })();
 await check('baking associations do not bypass staff scope, calendar blocks, owner-only recipes, or write permissions',async()=>{
  const secret=await api('create',{document:document('Private component baking'),status:'final',visibility:'owner'});
  for(const user of [chef,kitchen,stranger,null])await deny('get',{id:secret.id},user);
  for(const user of [stranger,null])await deny('get',{id:original.id},user);
  await deny('save',{id:saved.id,revision:saved.revision,document:saved.document,status:'draft'},kitchen);
  const person=(await api('staff_overview',{from:'2026-10-01',to:'2026-10-31'})).staff.find(s=>s.user_id===kitchen);
  await api('staff_save',{...person,scope_mode:'recipes',scope_ids:[saved.id]});
  assert.equal((await api('get',{id:saved.id},kitchen)).id,saved.id);
  await deny('get',{id:upgrade.records[1].id},kitchen);
  await api('staff_calendar',{users:[kitchen],dates:['2026-10-01'],action:'block',request_id:randomUUID()});
  await deny('get',{id:saved.id},kitchen);
  await api('staff_calendar',{users:[kitchen],dates:['2026-10-01'],action:'restore',request_id:randomUUID()});
  assert.equal((await api('get',{id:saved.id},kitchen)).id,saved.id);
 })();
 await check('Academy student projections remain separate and keep their prior field whitelist',async()=>{
  const source=original.document,before=structuredClone(source);
  const student=(await db.query('select tlb.academy_recipe_document($1::jsonb) value',[JSON.stringify(source)])).rows[0].value;
  assert.deepEqual(student.variants[0].baking.map(s=>s.name),bake(original).map(s=>s.name));
  for(const stage of student.variants[0].baking)assert.deepEqual(Object.keys(stage).sort(),['name','top','bottom','fan','minutes','core'].sort());
  assert.doesNotMatch(JSON.stringify(student),/group_id|PRIVATE_|cost_snapshot|supplier_price/);assert.deepEqual(source,before);
  assert.equal(await h.scalar("select pg_get_functiondef('tlb.academy_recipe_document(jsonb)'::regprocedure)"),upgrade.academyDefinition);
 })();
 await check('component baking validation and kitchen helpers retain their private execution permissions',async()=>{
  for(const role of ['anon','authenticated','service_role'])for(const signature of ['tlb.recipe_validate(jsonb)','tlb.recipe_kitchen_document(jsonb)'])assert.equal(await h.scalar('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
  assert.equal(await h.scalar("select prosecdef from pg_proc where oid='tlb.recipe_validate(jsonb)'::regprocedure"),false);
 })();
}
