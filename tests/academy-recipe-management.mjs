import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setup} from './academy-portal.mjs';
import {blankRecipe,addComponent,stage} from '../assets/ordering/recipe-model.js';
import {unwrapRecipeResult} from './backend/recipe-staff-fixture.mjs';

export function teachingFixture(){
 const d=blankRecipe();d.name='Compatibility cake';d.description='Two components';d.private_notes='PRIVATE_SOURCE';
 const v=d.variants[0];v.groups[0].name='Cake';v.groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'1/8',unit:'tsp',brand:'Teaching brand',price:'PRIVATE_PRICE'}];
 v.methods[0].steps[0].instruction='Mix the cake.';v.methods[0].steps[0].timer_minutes='1 1/2';
 const filling=addComponent(v,'Filling');filling.ingredients=[{id:'sugar',name:'Sugar',quantity:'50',unit:'g'}];v.methods[1].steps[0].instruction='Whisk the filling.';
 v.baking=[{...stage(v.groups[0].id),name:'Cake bake',top:'170',bottom:'160',actual_bottom:'155',fan:'Low',minutes:'20–25',core:'95',ingredient_temperature:'18',batter_temperature:'22',resting_temperature:'24',cooling_minutes:'30',freezing_minutes:'10',notes:'Cool fully before assembling.',supplier:'PRIVATE_SUPPLIER'},
  {...stage(filling.id),name:'Filling chill',temperature:'4',minutes:'60'},
  {...stage(''),name:'Final assembly rest',minutes:'15'}];return d;
}

export async function runManagementChecks(){
 for(const legacy of [false,true]){
  const state=await setup({excludeMigrations:legacy?['_academy_visual_email_templates.sql','_academy_approved_comparison_management.sql','_academy_final_recipe_import.sql']:[]});
  const {db,h,api,cookie,upload,storage}=state,owner=h.ids.owner;
  const sourceApi=(action,p={})=>h.as(owner,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(p)])).rows[0].result).then(unwrapRecipeResult);
  const label=legacy?'Deployed Academy API':'Latest Academy API';
  try{
   const document=teachingFixture();let source=await sourceApi('create',{document,status:'production'});const old=source.version_id;
   source=await sourceApi('save',{id:source.id,revision:source.revision,document,status:'production'});
   const choices=await api(owner,'final_recipes');assert.deepEqual(choices,await api(owner,'production_recipes'));assert.deepEqual(choices.map(r=>r.version_id),[source.version_id]);
   await assert.rejects(api(owner,'import_recipe',{version_id:old}),/current Final/);
   console.log('PASS',label,'only current Final can be listed/imported');
   const key=randomUUID(),copy=await api(owner,'import_recipe',{version_id:source.version_id,idempotency_key:key});
   const v=copy.document.variants[0];assert.equal(v.groups[0].ingredients[0].quantity,'1/8');assert.equal(v.methods[0].steps[0].timer_minutes,'1 1/2');
   assert.equal(v.methods[1].group_id,v.groups[1].id);assert.equal(v.baking[0].group_id,v.groups[0].id);assert.equal(v.baking[1].group_id,v.groups[1].id);assert.equal(v.baking[2].group_id,'');
   for(const [field,value] of Object.entries(document.variants[0].baking[0]))if(!['id','supplier'].includes(field))assert.equal(v.baking[0][field],value,field);
   assert.equal(v.baking[1].temperature,'4');assert.ok(!JSON.stringify(copy).includes('PRIVATE_'));
   let saved=await api(owner,'save_recipe',{id:copy.id,revision:copy.revision,title:copy.title,document:{...copy.document,student_notes:'A teaching note'}});
   assert.deepEqual(saved.document.variants,copy.document.variants);
   const details=await api(owner,'admin_recipe',{id:copy.id});assert.equal(details.source.version_id,source.version_id);assert.equal((await api(owner,'admin_recipes'))[0].source.number,2);
   console.log('PASS',label,'latest editor fields, component links, fractions and source provenance survive import/save');
   await api(owner,'assign_recipe',{class_id:cookie.id,recipe_id:copy.id});
   const photo=await upload(owner,{purpose:'recipe',recipe_id:copy.id});
   assert.equal((await api(owner,'admin_media',{purpose:'recipe',recipe_id:copy.id})).length,1);
   const pending=await api(owner,'reserve_media',{purpose:'recipe',recipe_id:copy.id,size_bytes:42,width:100,height:100});
   const submission=await api(h.ids.customer,'draft_submission',{class_id:cookie.id,recipe_id:copy.id,title:'My cake',visibility:'instructor'});
   const thread=await api(h.ids.customer,'start_thread',{class_id:cookie.id,recipe_id:copy.id,subject:'Cake question',body:'How long should I cool it?'});await api(h.ids.customer,'send_message',{id:thread.id});
   assert.equal((await storage(h.ids.customer,photo.path)).length,1);
   await assert.rejects(api(h.ids.customer,'delete_recipe',{id:copy.id,revision:saved.revision}));await assert.rejects(api(h.ids.staff,'delete_recipe',{id:copy.id,revision:saved.revision}));
   await assert.rejects(api(owner,'delete_recipe',{id:copy.id,revision:1}),/changed/);assert.equal((await api(owner,'admin_recipes')).length,1);
   const payload={id:copy.id,revision:saved.revision};assert.equal((await api(owner,'delete_recipe',payload)).deleted,true);assert.equal((await api(owner,'delete_recipe',payload)).deleted,true);
   assert.deepEqual(await api(owner,'admin_recipes'),[]);assert.deepEqual((await api(h.ids.customer,'class',{id:cookie.id})).recipes,[]);
   assert.equal((await api(h.ids.customer,'dashboard')).classes[0].recipe_shortcut,null);
   for(const user of [owner,h.ids.staff,h.ids.customer])await assert.rejects(api(user,'recipe',{id:copy.id,class_id:cookie.id}),/deleted/);
   for(const action of ['admin_recipe','duplicate_recipe','recipe_source_photos'])await assert.rejects(api(owner,action,{id:copy.id,idempotency_key:randomUUID()}),/deleted/);
   await assert.rejects(api(owner,'save_recipe',{id:copy.id,revision:saved.revision,title:'Revive',document:copy.document}),/deleted/);
   await assert.rejects(api(owner,'assign_recipe',{class_id:cookie.id,recipe_id:copy.id}),/deleted/);
   await assert.rejects(api(owner,'import_recipe',{version_id:source.version_id,idempotency_key:key}),/deleted/);
   await assert.rejects(api(owner,'reserve_media',{purpose:'recipe',recipe_id:copy.id,size_bytes:42,width:100,height:100}),/deleted/);
   await assert.rejects(h.as(owner,()=>db.query('select public.academy_portal_upload_check($1)',[pending.id])));
   for(const user of [owner,h.ids.staff,h.ids.customer])assert.deepEqual(await storage(user,photo.path),[]);
   assert.equal((await db.query('select count(*)::int n from tlb.academy_student_recipe_versions where recipe_id=$1',[copy.id])).rows[0].n,2);
   assert.equal((await db.query('select recipe_id from tlb.academy_submissions where id=$1',[submission.id])).rows[0].recipe_id,copy.id);
   assert.equal((await api(h.ids.customer,'thread',{id:thread.thread_id})).messages.length,1);
   assert.equal((await db.query("select count(*)::int n from tlb.academy_audit where action='recipe_deleted'")).rows[0].n,1);
   assert.equal((await sourceApi('get',{id:source.id})).version_id,source.version_id);
   console.log('PASS',label,'owner deletion is revision-checked, retry-safe and revokes recipes/media while retaining history');
  }finally{await db.close();}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runManagementChecks();
