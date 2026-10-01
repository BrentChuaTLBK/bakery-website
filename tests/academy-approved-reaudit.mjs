import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {setup} from './academy-portal.mjs';
const s=await setup(),{api,h,db,cookie,cupcake}=s,results=[];
const check=async(name,fn)=>{await fn();results.push({name,status:'PASS'});console.log('PASS',name);};
try{
 const module=await api(h.ids.owner,'save_module',{class_id:cookie.id,name:'Working with dough'});
 const recipe=await api(h.ids.owner,'save_recipe',{title:'Teaching dough',document:{variants:[]}});await api(h.ids.owner,'assign_recipe',{class_id:cookie.id,recipe_id:recipe.id,module_id:module.id});
 const ids=[];
 for(let i=0;i<112;i++){
  const id=randomUUID();ids.push(id);await db.query("insert into tlb.academy_message_threads(id,user_id,class_id,instructor_id,subject,type,last_activity,module_id,recipe_id) values($1,$2,$3,$4,$5,'question','2026-09-30T12:00:00Z',$6,$7)",[id,h.ids.customer,cookie.id,h.ids.staff,`Question ${String(i).padStart(3,'0')}`,module.id,recipe.id]);
  await db.query("insert into tlb.academy_messages(thread_id,sender_id,body,submitted,created_at) values($1,$2,$3,true,'2026-09-30T12:00:00Z')",[id,h.ids.customer,'Please help\nwith this dough. '+i]);
 }
 const foreign=await api(h.ids.stranger,'start_thread',{class_id:cupcake.id,subject:'Foreign conversation',body:'FOREIGN PRIVATE PREVIEW'});await api(h.ids.stranger,'send_message',{id:foreign.id});
 await check('More than 100 conversations paginate with complete, stable, duplicate-free history',async()=>{
  for(const actor of [h.ids.customer,h.ids.staff]){const found=[];let cursor=null;do{const page=await api(actor,'thread_page',{limit:25,cursor});assert.ok(page.threads.length<=25);found.push(...page.threads.map(t=>t.id));cursor=page.next_cursor;}while(cursor);assert.equal(new Set(found).size,112);assert.deepEqual(found,[...ids].sort().reverse());}
  assert.equal((await api(h.ids.customer,'threads')).length,100);
 });
 await check('Student names and subjects are searched literally inside the authorized class scope',async()=>{
  assert.equal((await api(h.ids.staff,'thread_page',{query:'aLiCe BAker',limit:50})).threads.length,50);
  const match=await api(h.ids.staff,'thread_page',{query:'question 109'});assert.equal(match.threads.length,1);assert.equal(match.threads[0].subject,'Question 109');assert.equal(match.threads[0].last_message_preview,'Please help with this dough. 109');assert.equal(match.threads[0].recipe_title,'Teaching dough');
  for(const query of ['%','_','Foreign','customer@example.test'])assert.deepEqual((await api(h.ids.staff,'thread_page',{query})).threads,[]);
  assert.deepEqual((await api(h.ids.staff,'thread_page',{class_id:cupcake.id})).threads,[]);assert.deepEqual((await api(h.ids.teacher2,'thread_page',{query:'Alice'})).threads,[]);assert.deepEqual((await api(h.ids.stranger,'thread_page',{query:'Question'})).threads,[]);
 });
 await check('Anonymous calls, malformed cursors and unbounded or invalid queries are denied',async()=>{
  for(const action of ['thread_page','thread','admin_attention'])await assert.rejects(api(null,action,{id:ids[0]}));
  for(const p of [{limit:0},{limit:51},{limit:100000},{query:'x'.repeat(161)},{filter:'bogus'},{cursor:{at:'2026-09-30T12:00:00Z'}},{cursor:{id:ids[0]}}])await assert.rejects(api(h.ids.customer,'thread_page',p));
  await assert.rejects(h.as(h.ids.customer,()=>db.query("select tlb.academy_reaudit_read('thread_page','{}')")));
  await assert.rejects(api(h.ids.customer,'admin_attention'));await assert.rejects(api(h.ids.staff,'admin_attention'));
 });
 await check('Open thread returns authorized recipe/module context and leaves read state untouched when requested',async()=>{
  const thread=await api(h.ids.staff,'thread',{id:ids[0],mark_read:false});assert.equal(thread.module_name,'Working with dough');assert.equal(thread.recipe_title,'Teaching dough');assert.equal(thread.recipe_id,recipe.id);assert.equal(thread.account_name,'Alice Baker');assert.ok(thread.messages[0].created_at);assert.equal((await api(h.ids.staff,'thread_page',{query:'Question 000'})).threads[0].unread,1);
  await assert.rejects(api(h.ids.teacher2,'thread',{id:ids[0]}));await assert.rejects(api(h.ids.stranger,'thread',{id:ids[0]}));
 });
 await check('Needs-reply counts match the latest submitted sender and ignore unsent drafts',async()=>{
  assert.equal((await api(h.ids.owner,'admin_attention')).needs_reply,113);
  await api(h.ids.staff,'draft_reply',{id:ids[0],body:'UNSENT SECRET'});assert.equal((await api(h.ids.staff,'thread_page',{query:'Question 000'})).threads[0].last_message_preview,'Please help with this dough. 0');
  const reply=await api(h.ids.staff,'draft_reply',{id:ids[0],body:'Chill the dough first.'});await api(h.ids.staff,'send_message',{id:reply.id});assert.equal((await api(h.ids.owner,'admin_attention')).needs_reply,112);assert.equal((await api(h.ids.staff,'thread_page',{query:'Question 000',filter:'needs_reply'})).threads.length,0);
  await api(h.ids.staff,'resolve_thread',{id:ids[1],resolved:true});assert.equal((await api(h.ids.owner,'admin_attention')).needs_reply,111);assert.equal((await api(h.ids.staff,'thread_page',{filter:'resolved'})).threads.length,1);
  const followup=await api(h.ids.customer,'draft_reply',{id:ids[0],body:'I still need help.'});await api(h.ids.customer,'send_message',{id:followup.id});assert.equal((await api(h.ids.owner,'admin_attention')).needs_reply,112);
 });
 await check('Pending Gallery attention excludes private work, and moderation filters before its limit',async()=>{
  for(const visibility of ['gallery','instructor']){const post=await api(h.ids.customer,'draft_submission',{class_id:cookie.id,title:'Audience test',visibility});await s.upload(h.ids.customer,{purpose:'submission',submission_id:post.id});await api(h.ids.customer,'submit_work',{id:post.id});}
  assert.equal((await api(h.ids.owner,'admin_attention')).pending_gallery,1);const queue=await api(h.ids.owner,'admin_submissions',{status:'pending',visibility:'gallery'});assert.equal(queue.length,1);assert.equal(queue[0].visibility,'gallery');
  assert.equal((await api(h.ids.owner,'admin_submissions',{status:'pending'})).length,2);
 });
 await check('Old cursors and search cannot recover conversations after class access is revoked',async()=>{
  const page=await api(h.ids.customer,'thread_page',{limit:10});const account=await api(h.ids.owner,'account',{id:h.ids.customer});await api(h.ids.owner,'revoke',{id:account.enrollments.find(e=>e.class_id===cookie.id).id});assert.deepEqual((await api(h.ids.customer,'thread_page',{cursor:page.next_cursor,query:'Question'})).threads,[]);await assert.rejects(api(h.ids.customer,'thread',{id:ids[0]}));
  await api(h.ids.owner,'save_instructor',{id:h.ids.staff,display_name:'Chef Cookie',active:false});assert.deepEqual((await api(h.ids.staff,'thread_page',{query:'Alice'})).threads,[]);
 });
}catch(error){results.push({name:'Approved re-audit database',status:'FAIL',error:error.message});console.error(error);process.exitCode=1;}
finally{await mkdir('tests/artifacts/academy-portal',{recursive:true});await writeFile('tests/artifacts/academy-portal/reaudit-database-results.json',JSON.stringify({results},null,2));await db.close();}
