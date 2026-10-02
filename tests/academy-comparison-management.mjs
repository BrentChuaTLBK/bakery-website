import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {setup} from './academy-portal.mjs';
const s=await setup(),{db,h,api,service,cookie,cupcake,upload,storage}=s,results=[];
const test=async(name,fn)=>{try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}catch(error){results.push({name,status:'FAIL',error:error.message});console.error('FAIL',name,error.message,error.where||'');throw error;}};
const deny=async(actors,action,p={})=>{for(const actor of actors)await assert.rejects(api(actor,action,p));};
const photo=async(actor,p={})=>upload(actor,p), outsiders=[null,h.ids.customer,h.ids.stranger,h.ids.teacher2,h.ids.unverified];
const doc={variants:[{name:'Main',groups:[{name:'Dough',ingredients:[{name:'Flour',quantity:'250',unit:'g'}]}],methods:[{name:'Bake',steps:[{instruction:'Bake until golden.',temperature:'175 °C',timer_minutes:'20'}]}]}]};
const submission=async(actor,classId,visibility='gallery',extra={})=>{const a=await api(actor,'draft_submission',{class_id:classId,title:'Comparison work '+randomUUID().slice(0,6),visibility,...extra});await photo(actor,{purpose:'submission',submission_id:a.id});return api(actor,'submit_work',{id:a.id});};
let module1,module2,recipe1,recipe2,privateWork,galleryWork,feedback,welcome;
try{
 await test('Anonymous welcome read exposes only display configuration; all protected actions stay gated',async()=>{
  assert.deepEqual(await api(null,'public_welcome'),{photo_path:null,photo_alt:'',revision:1});
  for(const action of ['dashboard','accounts_page','welcome_config','admin_submissions_page','instructor_attention','admin_recipes'])await assert.rejects(api(null,action));
  await deny([h.ids.customer,h.ids.staff],'welcome_config');
 });
 await test('Welcome uploads stay owner-only, WebP-only, bounded, and in a separate public bucket',async()=>{
  const p={purpose:'welcome',size_bytes:42,width:100,height:100};await deny([null,h.ids.customer,h.ids.staff],'reserve_media',p);
  for(const patch of [{mime_type:'image/png'},{size_bytes:5242881},{width:5000},{class_id:cookie.id}])await assert.rejects(api(h.ids.owner,'reserve_media',{...p,...patch}));
  welcome=await api(h.ids.owner,'reserve_media',p);assert.equal(welcome.bucket,'academy-welcome');
  const check=await h.as(h.ids.owner,async()=>(await db.query('select public.academy_portal_upload_check($1) result',[welcome.id])).rows[0].result);assert.equal(check.bucket,'academy-welcome');
  await assert.rejects(h.as(h.ids.customer,()=>db.query('select public.academy_portal_upload_check($1)',[welcome.id])));
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('academy-student-media',$1,'{\"size\":42,\"mimetype\":\"image/webp\"}')",[welcome.path]);
  await assert.rejects(service('academy_portal_confirm_upload',[welcome.id,h.ids.owner,'a'.repeat(64)]));
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('academy-welcome',$1,'{\"size\":41,\"mimetype\":\"image/webp\"}')",[welcome.path]);
  await assert.rejects(service('academy_portal_confirm_upload',[welcome.id,h.ids.owner,'a'.repeat(64)]));
  await db.query("update storage.objects set metadata='{\"size\":42,\"mimetype\":\"image/webp\"}' where bucket_id='academy-welcome' and name=$1",[welcome.path]);await service('academy_portal_confirm_upload',[welcome.id,h.ids.owner,'a'.repeat(64)]);
  assert.equal((await db.query("select public from storage.buckets where id='academy-welcome'")).rows[0].public,true);
  assert.equal((await db.query("select public from storage.buckets where id='academy-student-media'")).rows[0].public,false);
  await db.exec('grant insert,update,delete on storage.objects to authenticated;');
  await assert.rejects(h.as(h.ids.owner,()=>db.query("insert into storage.objects(bucket_id,name) values('academy-welcome','forged.webp')")));
 });
 await test('Welcome saving rejects private assets and stale edits; public output contains no actor or protected identifiers',async()=>{
  const privateAsset=await photo(h.ids.owner,{purpose:'class',class_id:cookie.id});
  await assert.rejects(api(h.ids.owner,'save_welcome_config',{media_id:privateAsset.id,photo_alt:'Wrong',revision:1}));
  await assert.rejects(api(h.ids.customer,'save_welcome_config',{media_id:welcome.id,photo_alt:'Baking class',revision:1}));
  const saved=await api(h.ids.owner,'save_welcome_config',{media_id:welcome.id,photo_alt:'Students baking together',revision:1});assert.equal(saved.revision,2);
  await assert.rejects(api(h.ids.owner,'save_welcome_config',{media_id:null,photo_alt:'',revision:1}));
  assert.deepEqual(await api(null,'public_welcome'),{photo_path:welcome.path,photo_alt:'Students baking together',revision:2});
  assert.deepEqual(await api(h.ids.customer,'media',{ids:[welcome.id]}),[]);
  const altOnly=await api(h.ids.owner,'save_welcome_config',{photo_alt:'Students preparing dough',revision:2});assert.equal(altOnly.photo_path,welcome.path);assert.equal(altOnly.revision,3);
  const reset=await api(h.ids.owner,'save_welcome_config',{media_id:null,photo_alt:'',revision:3});assert.equal(reset.photo_path,null);assert.deepEqual(await api(null,'public_welcome'),{photo_path:null,photo_alt:'',revision:4});
 });
 await test('Account pagination is complete, stable, literal, and restricted to the owner',async()=>{
  for(let i=0;i<61;i++){const id=randomUUID();await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)",[id,`page${i}@example.test`,JSON.stringify({full_name:'Paged Student '+i,phone:'555'+i})]);}
  await deny([null,h.ids.customer,h.ids.staff],'accounts_page',{query:'Paged'});
  let cursor=null,ids=[];do{const p=await api(h.ids.owner,'accounts_page',{query:'Paged',cursor,limit:13});assert.equal(p.total,61);ids.push(...p.accounts.map(a=>a.id));cursor=p.next_cursor;}while(cursor);
  assert.equal(new Set(ids).size,61);assert.equal(ids.length,61);
  assert.equal((await api(h.ids.owner,'accounts_page',{query:'%'})).total,0);
  const members=await api(h.ids.owner,'accounts_page',{class_id:cookie.id});assert.ok(members.accounts.some(a=>a.id===h.ids.customer&&a.class_ids.includes(cookie.id)));
 });
 await test('Lost reservation responses replay one authorized upload and reject changed, cancelled, or abandoned requests',async()=>{
  const a=await api(h.ids.customer,'draft_submission',{class_id:cookie.id,title:'Retry reservation',visibility:'instructor'});
  const p={purpose:'submission',submission_id:a.id,size_bytes:42,width:100,height:100,idempotency_key:randomUUID()};
  const reserved=await api(h.ids.customer,'reserve_media',p),replayed=await api(h.ids.customer,'reserve_media',p);assert.equal(replayed.id,reserved.id);assert.equal((await db.query('select count(*) n from tlb.academy_portal_media where submission_id=$1',[a.id])).rows[0].n,1);
  await assert.rejects(api(h.ids.customer,'reserve_media',{...p,width:101}));await assert.rejects(api(h.ids.stranger,'reserve_media',p));
  await api(h.ids.customer,'cancel_draft',{id:a.id,kind:'submission'});await assert.rejects(api(h.ids.customer,'reserve_media',p));
  const ownerPayload={purpose:'class',class_id:cookie.id,size_bytes:42,width:100,height:100,idempotency_key:randomUUID()};const ownerMedia=await api(h.ids.owner,'reserve_media',ownerPayload);await db.query('update tlb.academy_portal_media set abandoned_at=now() where id=$1',[ownerMedia.id]);await assert.rejects(api(h.ids.owner,'reserve_media',ownerPayload));
  const draft=await api(h.ids.customer,'start_thread',{class_id:cookie.id,subject:'Retry reply reservation',body:'Draft'}),messagePayload={purpose:'message',message_id:draft.id,size_bytes:42,width:100,height:100,idempotency_key:randomUUID()};const messageMedia=await api(h.ids.customer,'reserve_media',messagePayload);assert.equal((await api(h.ids.customer,'reserve_media',messagePayload)).id,messageMedia.id);await api(h.ids.customer,'cancel_draft',{id:draft.id,kind:'message'});await assert.rejects(api(h.ids.customer,'reserve_media',messagePayload));
 });
 await test('Welcome save response replay increments once and cannot overwrite a later edit',async()=>{
  const current=await api(h.ids.owner,'welcome_config'),p={media_id:welcome.id,photo_alt:'Public cookies',revision:current.revision,idempotency_key:randomUUID()};const saved=await api(h.ids.owner,'save_welcome_config',p);assert.deepEqual(await api(h.ids.owner,'save_welcome_config',p),saved);assert.equal((await api(h.ids.owner,'welcome_config')).revision,current.revision+1);
  await assert.rejects(api(h.ids.owner,'save_welcome_config',{...p,photo_alt:'Changed retry'}));await assert.rejects(api(h.ids.customer,'save_welcome_config',p));
  const later=await api(h.ids.owner,'save_welcome_config',{photo_alt:'Later edit',revision:saved.revision,idempotency_key:randomUUID()});await api(h.ids.owner,'save_welcome_config',p);assert.equal((await api(null,'public_welcome')).photo_alt,'Later edit');assert.equal((await api(h.ids.owner,'welcome_config')).revision,later.revision);
 });
 await test('Multi-class assignments are atomic, deduplicated, and preserve newsletter preferences',async()=>{
  await deny([null,h.ids.customer,h.ids.staff],'assign_classes',{class_ids:[cookie.id],user_ids:[h.ids.stranger]});
  await assert.rejects(api(h.ids.owner,'assign_classes',{class_ids:[cupcake.id,randomUUID()],user_ids:[h.ids.customer]}));
  assert.equal((await api(h.ids.owner,'account',{id:h.ids.customer})).enrollments.filter(e=>e.class_id===cupcake.id&&e.status==='active').length,0);
  const r=await api(h.ids.owner,'assign_classes',{class_ids:[cookie.id,cupcake.id,cookie.id],user_ids:[h.ids.customer,h.ids.stranger,h.ids.customer]});assert.equal(r.assigned,2);assert.equal(r.existing,2);assert.equal(r.outcomes.length,4);
  const again=await api(h.ids.owner,'assign_classes',{class_ids:[cookie.id,cupcake.id],user_ids:[h.ids.customer,h.ids.stranger]});assert.equal(again.assigned,0);assert.equal(again.existing,4);assert.equal((await api(h.ids.customer,'dashboard')).academy_newsletter,false);
 });
 await test('Module visibility and recipe visibility block direct student reads and media paths',async()=>{
  module1=await api(h.ids.owner,'save_module',{class_id:cookie.id,name:'First module',sort_order:0});module2=await api(h.ids.owner,'save_module',{class_id:cookie.id,name:'Second module',sort_order:1});
  recipe1=await api(h.ids.owner,'save_recipe',{title:'Teaching recipe one',document:doc});recipe2=await api(h.ids.owner,'save_recipe',{title:'Teaching recipe two',document:doc});
  await api(h.ids.owner,'assign_recipe',{class_id:cookie.id,module_id:module1.id,recipe_id:recipe1.id});await api(h.ids.owner,'assign_recipe',{class_id:cookie.id,module_id:module1.id,recipe_id:recipe2.id});
  const recipePhoto=await photo(h.ids.owner,{purpose:'recipe',recipe_id:recipe1.id}),modulePhoto=await photo(h.ids.owner,{purpose:'module',module_id:module1.id});
  await deny([h.ids.customer,h.ids.staff],'set_module_visibility',{class_id:cookie.id,id:module1.id,visible:false});
  await api(h.ids.owner,'set_module_visibility',{class_id:cookie.id,id:module1.id,visible:false});
  const student=await api(h.ids.customer,'class',{id:cookie.id});assert.equal(student.modules.some(m=>m.id===module1.id),false);assert.equal(student.recipes.length,0);assert.equal(student.module_count,1);
  await assert.rejects(api(h.ids.customer,'recipe',{class_id:cookie.id,id:recipe1.id}));assert.equal((await storage(h.ids.customer,recipePhoto.path)).length,0);assert.equal((await storage(h.ids.customer,modulePhoto.path)).length,0);
  assert.equal((await api(h.ids.owner,'class',{id:cookie.id})).modules.find(m=>m.id===module1.id).visible,false);
  await api(h.ids.owner,'set_module_visibility',{class_id:cookie.id,id:module1.id,visible:true});await api(h.ids.owner,'set_recipe_visibility',{class_id:cookie.id,recipe_id:recipe1.id,visible:false});
  await assert.rejects(api(h.ids.customer,'recipe',{class_id:cookie.id,id:recipe1.id}));assert.equal((await storage(h.ids.customer,recipePhoto.path)).length,0);
  await api(h.ids.owner,'set_recipe_visibility',{class_id:cookie.id,recipe_id:recipe1.id,visible:true});assert.equal((await api(h.ids.customer,'recipe',{class_id:cookie.id,id:recipe1.id})).id,recipe1.id);
 });
 await test('Curriculum reorders require an exact scope and preserve history when removing a placement',async()=>{
  await assert.rejects(api(h.ids.owner,'reorder_modules',{class_id:cookie.id,ids:[module1.id,module1.id]}));await api(h.ids.owner,'reorder_modules',{class_id:cookie.id,ids:[module2.id,module1.id]});assert.equal((await api(h.ids.owner,'class',{id:cookie.id})).modules[0].id,module2.id);
  await assert.rejects(api(h.ids.owner,'reorder_recipes',{class_id:cookie.id,module_id:module1.id,ids:[recipe2.id]}));await api(h.ids.owner,'reorder_recipes',{class_id:cookie.id,module_id:module1.id,ids:[recipe2.id,recipe1.id]});assert.equal((await api(h.ids.customer,'class',{id:cookie.id})).recipes[0].id,recipe2.id);
  privateWork=await submission(h.ids.customer,cookie.id,'instructor',{module_id:module1.id,recipe_id:recipe1.id});
  await api(h.ids.owner,'unlink_recipe',{class_id:cookie.id,recipe_id:recipe1.id});await assert.rejects(api(h.ids.customer,'recipe',{class_id:cookie.id,id:recipe1.id}));assert.equal((await api(h.ids.staff,'submission',{id:privateWork.id})).title,privateWork.title);
  await api(h.ids.owner,'assign_recipe',{class_id:cookie.id,module_id:module1.id,recipe_id:recipe1.id});
  await api(h.ids.owner,'delete_module',{class_id:cookie.id,id:module1.id});assert.equal((await api(h.ids.owner,'class',{id:cookie.id})).modules.length,1);assert.equal((await api(h.ids.staff,'submission',{id:privateWork.id})).title,privateWork.title);
  await api(h.ids.owner,'reorder_modules',{class_id:cookie.id,ids:[module2.id]});
  await assert.rejects(api(h.ids.owner,'assign_recipe',{class_id:cookie.id,module_id:module1.id,recipe_id:recipe1.id}));await api(h.ids.owner,'assign_recipe',{class_id:cookie.id,module_id:module2.id,recipe_id:recipe1.id});
 });
 await test('Recipe usage and source metadata are owner-only; duplication is independent and replay-safe',async()=>{
  const before=await api(h.ids.owner,'admin_recipe',{id:recipe1.id});assert.equal(before.used_in[0].class_id,cookie.id);assert.equal(before.used_in[0].module_id,module2.id);
  await deny([h.ids.customer,h.ids.staff],'admin_recipe',{id:recipe1.id});const p={id:recipe1.id,title:'Independent copy',idempotency_key:randomUUID()};const copied=await api(h.ids.owner,'duplicate_recipe',p);assert.equal((await api(h.ids.owner,'duplicate_recipe',p)).id,copied.id);assert.notEqual(copied.id,recipe1.id);
  await assert.rejects(api(h.ids.owner,'duplicate_recipe',{...p,title:'Changed retry'}));assert.deepEqual((await api(h.ids.owner,'admin_recipe',{id:copied.id})).used_in,[]);
  await api(h.ids.owner,'save_recipe',{id:copied.id,revision:copied.revision,title:'Edited copy',document:{variants:[]}});assert.equal((await api(h.ids.owner,'admin_recipe',{id:recipe1.id})).title,'Teaching recipe one');
 });
 await test('Photo albums enforce context, cover/order selection, and immediate removal access revocation',async()=>{
  const first=await photo(h.ids.owner,{purpose:'recipe',recipe_id:recipe1.id}),second=await photo(h.ids.owner,{purpose:'recipe',recipe_id:recipe1.id});
  const all=await api(h.ids.owner,'admin_media',{purpose:'recipe',recipe_id:recipe1.id});await deny([h.ids.staff,h.ids.customer],'remove_admin_media',{id:first.id});
  await api(h.ids.owner,'set_media_cover',{id:second.id});assert.equal((await api(h.ids.owner,'admin_media',{purpose:'recipe',recipe_id:recipe1.id})).find(x=>x.id===second.id).is_cover,true);assert.equal((await api(h.ids.customer,'recipe',{class_id:cookie.id,id:recipe1.id})).media[0].id,second.id);
  await assert.rejects(api(h.ids.owner,'reorder_media',{purpose:'recipe',recipe_id:recipe1.id,ids:[first.id]}));
  const ids=all.map(x=>x.id).reverse();await api(h.ids.owner,'reorder_media',{purpose:'recipe',recipe_id:recipe1.id,ids});assert.deepEqual((await api(h.ids.owner,'admin_media',{purpose:'recipe',recipe_id:recipe1.id})).map(x=>x.id),ids);
  await api(h.ids.owner,'remove_admin_media',{id:first.id});assert.equal((await storage(h.ids.customer,first.path)).length,0);assert.equal((await api(h.ids.owner,'admin_media',{purpose:'recipe',recipe_id:recipe1.id})).some(x=>x.id===first.id),false);
  assert.equal((await db.query("select count(*) n from storage.objects where bucket_id='academy-student-media' and name=$1",[first.path])).rows[0].n,1);
 });
 await test('Paged review is class-scoped, searchable, complete, and labels actor roles',async()=>{
  galleryWork=await submission(h.ids.customer,cookie.id);const other=await submission(h.ids.stranger,cupcake.id);
  for(let i=0;i<53;i++)await db.query("insert into tlb.academy_submissions(user_id,class_id,title,visibility,submitted) values($1,$2,$3,'gallery',true)",[h.ids.customer,cookie.id,'Review page '+i]);
  await deny([null,h.ids.customer],'admin_submissions_page');let cursor=null,ids=[];do{const p=await api(h.ids.staff,'admin_submissions_page',{query:'Review page',status:'pending',visibility:'gallery',cursor,limit:11});assert.equal(p.total,53);assert.ok(p.submissions.every(x=>x.class_id===cookie.id&&x.actor_role==='student'));ids.push(...p.submissions.map(x=>x.id));cursor=p.next_cursor;}while(cursor);assert.equal(new Set(ids).size,53);
  assert.equal((await api(h.ids.staff,'admin_submissions_page',{class_id:cupcake.id})).total,0);await assert.rejects(api(h.ids.staff,'moderate',{id:other.id,status:'approved'}));
 });
 await test('Reviewed bulk approval and undo preserve privacy, reject cross-class input, and cannot overwrite later moderation',async()=>{
  await assert.rejects(api(h.ids.staff,'reviewed_bulk_approve',{ids:[galleryWork.id],reviewed_ids:[]}));
  await assert.rejects(api(h.ids.staff,'reviewed_bulk_approve',{ids:[privateWork.id],reviewed_ids:[privateWork.id]}));
  const approved=await api(h.ids.staff,'reviewed_bulk_approve',{ids:[galleryWork.id],reviewed_ids:[galleryWork.id]});assert.equal(approved.approved,1);assert.ok(approved.undo_token);
  await assert.rejects(api(h.ids.owner,'undo_moderation',{undo_token:approved.undo_token}));await api(h.ids.staff,'undo_moderation',{undo_token:approved.undo_token});assert.equal((await api(h.ids.staff,'submission',{id:galleryWork.id})).moderation,'pending');
  await assert.rejects(api(h.ids.staff,'undo_moderation',{undo_token:approved.undo_token}));
  const hidden=await api(h.ids.staff,'moderate',{id:galleryWork.id,status:'hidden'});await api(h.ids.owner,'moderate',{id:galleryWork.id,status:'archived'});await assert.rejects(api(h.ids.staff,'undo_moderation',{undo_token:hidden.undo_token}));assert.equal((await api(h.ids.owner,'submission',{id:galleryWork.id})).moderation,'archived');
 });
 await test('Instructor attention and seen state are scoped per instructor and do not expose private work',async()=>{
  assert.equal((await api(h.ids.staff,'instructor_attention')).private_unseen,1);assert.equal((await api(h.ids.teacher2,'instructor_attention')).private_unseen,0);await deny([null,h.ids.customer,h.ids.teacher2],'mark_submission_seen',{id:privateWork.id});
  await api(h.ids.staff,'mark_submission_seen',{id:privateWork.id});assert.equal((await api(h.ids.staff,'instructor_attention')).private_unseen,0);assert.equal((await api(h.ids.owner,'instructor_attention')).private_unseen,1);
 });
 await test('Private submission feedback creates one linked private conversation and idempotent message delivery',async()=>{
  const p={id:privateWork.id,body:'Your texture is lovely. Try a lighter mix next time.',idempotency_key:randomUUID()};await deny(outsiders,'submission_feedback',p);
  feedback=await api(h.ids.staff,'submission_feedback',p);assert.equal((await api(h.ids.staff,'submission_feedback',p)).id,feedback.id);const second=await api(h.ids.staff,'submission_feedback',{...p,body:'One more tip.',idempotency_key:randomUUID()});assert.equal(second.thread_id,feedback.thread_id);
  const thread=await api(h.ids.customer,'thread',{id:feedback.thread_id});assert.equal(thread.submission_id,privateWork.id);assert.equal(thread.messages.length,2);await assert.rejects(api(h.ids.teacher2,'thread',{id:feedback.thread_id}));
  const page=await api(h.ids.staff,'admin_submissions_page',{visibility:'instructor'});assert.equal(page.submissions.find(x=>x.id===privateWork.id).feedback_thread_id,feedback.thread_id);
  assert.equal((await db.query("select count(*) n from tlb.outbox where event_key=$1",['academy:reply:'+feedback.id])).rows[0].n,1);assert.equal((await api(h.ids.customer,'gallery')).posts.some(x=>x.id===privateWork.id),false);
 });
 await test('Announcements retain optional importance across legacy updates and project it to students',async()=>{
  const original={title:'Important update',summary:'Please read',content:'Class starts early.',status:'published',important:true,idempotency_key:randomUUID()};const a=await api(h.ids.owner,'save_announcement',original);let r=(await api(h.ids.owner,'admin_announcements')).find(x=>x.id===a.id);assert.equal(r.important,true);
  assert.equal((await api(h.ids.customer,'dashboard')).announcements.find(x=>x.id===a.id).important,true);assert.equal((await api(h.ids.customer,'announcement',{id:a.id})).important,true);
  await api(h.ids.owner,'save_announcement',{id:a.id,revision:r.revision,title:r.title,content:r.content,status:'published'});assert.equal((await api(h.ids.customer,'announcement',{id:a.id})).important,true);
  r=(await api(h.ids.owner,'admin_announcements')).find(x=>x.id===a.id);await api(h.ids.owner,'save_announcement',{id:a.id,revision:r.revision,title:r.title,content:r.content,status:'published',important:false});await api(h.ids.owner,'save_announcement',original);assert.equal((await api(h.ids.customer,'announcement',{id:a.id})).important,false);
 });
 await test('Recipient review identifies matched/excluded accounts and send checks the reviewed identity set',async()=>{
  await api(h.ids.customer,'newsletter',{academy:true});const customer=(await db.query('select email from auth.users where id=$1',[h.ids.customer])).rows[0].email;
  const p={kind:'marketing',audience:'selected',user_ids:[h.ids.customer,h.ids.stranger,h.ids.unverified],emails:[customer,'missing@example.test'],subject:'A class update',body:'A message to our Academy.'};
  await deny([h.ids.staff,h.ids.customer],'broadcast_preview',p);const preview=await api(h.ids.owner,'broadcast_preview',p);assert.equal(preview.recipients,1);assert.equal(preview.matched[0].user_id,h.ids.customer);assert.equal(preview.intended_count,4);assert.ok(preview.excluded.some(x=>x.reason==='Not subscribed to Academy newsletter'));assert.ok(preview.excluded.some(x=>x.reason==='Email not confirmed'));assert.ok(preview.excluded.some(x=>x.email==='missing@example.test'&&x.reason==='Account not found'));
  await assert.rejects(api(h.ids.owner,'broadcast_send',{...p,reviewed_user_ids:[h.ids.customer,h.ids.stranger],idempotency_key:randomUUID()}));
  await api(h.ids.customer,'newsletter',{academy:false});await assert.rejects(api(h.ids.owner,'broadcast_send',{...p,reviewed_user_ids:[h.ids.customer],idempotency_key:randomUUID()}));
  const operational=await api(h.ids.owner,'broadcast_preview',{...p,kind:'operational'});assert.equal(operational.recipients,2);
 });
 await test('Cancel draft retires only the actor unsent work and media; sent work remains immutable',async()=>{
  const a=await api(h.ids.customer,'draft_submission',{class_id:cookie.id,title:'Unfinished',visibility:'instructor'}),m=await photo(h.ids.customer,{purpose:'submission',submission_id:a.id});
  await deny([h.ids.stranger,h.ids.staff,h.ids.owner],'cancel_draft',{id:a.id,kind:'submission'});await api(h.ids.customer,'cancel_draft',{id:a.id,kind:'submission'});await api(h.ids.customer,'cancel_draft',{id:a.id,kind:'submission'});
  await assert.rejects(api(h.ids.customer,'submit_work',{id:a.id}));await assert.rejects(api(h.ids.customer,'reserve_media',{purpose:'submission',submission_id:a.id,size_bytes:42,width:100,height:100}));assert.equal((await storage(h.ids.customer,m.path)).length,0);await assert.rejects(service('academy_portal_confirm_upload',[m.id,h.ids.customer,'a'.repeat(64)]));
  const draft=await api(h.ids.customer,'start_thread',{class_id:cookie.id,subject:'Unsent',body:'Draft message'});const mp=await photo(h.ids.customer,{purpose:'message',message_id:draft.id});await api(h.ids.customer,'cancel_draft',{id:draft.id,kind:'message'});await assert.rejects(api(h.ids.customer,'send_message',{id:draft.id}));assert.equal((await storage(h.ids.customer,mp.path)).length,0);
  await assert.rejects(api(h.ids.customer,'cancel_draft',{id:privateWork.id,kind:'submission'}));await assert.rejects(api(h.ids.staff,'cancel_draft',{id:feedback.id,kind:'message'}));
 });
 await test('New data remains private with RLS and internal functions stay inaccessible',async()=>{
  for(const table of ['academy_welcome_settings','academy_submission_reads','academy_moderation_undo']){assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',['tlb.'+table])).rows[0].relrowsecurity,true);for(const actor of [null,h.ids.customer,h.ids.staff,h.ids.owner])await assert.rejects(h.as(actor,()=>db.query('select * from tlb.'+table)));}
  for(const actor of [null,h.ids.customer,h.ids.staff,h.ids.owner])await assert.rejects(h.as(actor,()=>db.query("select tlb.academy_comparison_api('accounts_page','{}')")));
  const tables=(await db.query('select tlb.academy_backup_tables() t')).rows[0].t;assert.ok(tables.includes('academy_welcome_settings')&&tables.includes('academy_submission_reads'));assert.equal(tables.includes('academy_moderation_undo'),false);
 });
 console.log(`${results.length} comparison management database checks passed`);
}finally{await mkdir('work/full-experience-audit/implementation',{recursive:true});await writeFile('work/full-experience-audit/implementation/backend-results.json',JSON.stringify({results},null,2));await db.close();}
