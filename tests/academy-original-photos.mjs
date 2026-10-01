import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {setup} from './academy-portal.mjs';
const s=await setup(),{api,h,db,cookie,service}=s,results=[];
const check=async(name,fn)=>{await fn();results.push({name,status:'PASS'});console.log('PASS',name);};
const draft=()=>api(h.ids.customer,'draft_submission',{class_id:cookie.id,title:'Original photo fixture',visibility:'instructor'});
const reserve=(submission,mime_type,extra={})=>api(h.ids.customer,'reserve_media',{purpose:'submission',submission_id:submission.id,mime_type,size_bytes:42,width:4,height:3,...extra});
try{
 await check('Original photo formats receive canonical private paths and a later-conversion marker',async()=>{
  const submission=await draft();
  for(const [mime,ext]of[['image/png','png'],['image/jpeg','jpg'],['image/heic','heic']]){
   const m=await reserve(submission,mime);assert.equal(m.path,m.id+'.'+ext);assert.equal(m.mime_type,mime);
   await db.query("insert into storage.objects(bucket_id,name,metadata) values('academy-student-media',$1,$2::jsonb)",[m.path,JSON.stringify({size:42,mimetype:mime})]);await service('academy_portal_confirm_upload',[m.id,h.ids.customer,'a'.repeat(64)]);
   const [read]=await api(h.ids.customer,'media',{ids:[m.id]});assert.equal(read.mime_type,mime);assert.equal(read.conversion_pending,true);assert.equal((await api(h.ids.stranger,'media',{ids:[m.id]})).length,0);assert.equal((await s.storage(null,m.path)).length,0);
  }
  await api(h.ids.customer,'submit_work',{id:submission.id});assert.equal((await api(h.ids.staff,'submission',{id:submission.id})).media.length,3);assert.equal((await api(h.ids.unverified,'gallery')).posts.length,0);
 });
 await check('Original limits allow phone photos while WebP limits and purpose boundaries remain',async()=>{
  const submission=await draft();await reserve(submission,'image/heic',{width:8064,height:6048,size_bytes:26214400});
  for(const extra of [{size_bytes:26214401},{width:16385},{width:9000,height:9000},{size_bytes:0}])await assert.rejects(reserve(submission,'image/png',extra));
  await assert.rejects(reserve(submission,'image/webp',{size_bytes:5242881}));await assert.rejects(reserve(submission,'image/webp',{width:4097}));
  for(const mime of ['image/gif','image/svg+xml','application/pdf','image/avif',''])await assert.rejects(reserve(submission,mime));
  await assert.rejects(api(h.ids.owner,'reserve_media',{purpose:'class',class_id:cookie.id,mime_type:'image/png',size_bytes:42,width:4,height:3}));
  const legacy=await api(h.ids.customer,'reserve_media',{purpose:'submission',submission_id:submission.id,size_bytes:42,width:4,height:3});assert.equal(legacy.mime_type,'image/webp');assert.ok(legacy.path.endsWith('.webp'));
 });
 await check('Upload confirmation checks original metadata and revocation blocks unfinished original uploads',async()=>{
  const submission=await draft(),m=await reserve(submission,'image/png');await db.query("insert into storage.objects(bucket_id,name,metadata) values('academy-student-media',$1,$2::jsonb)",[m.path,JSON.stringify({size:42,mimetype:'image/jpeg'})]);
  await assert.rejects(service('academy_portal_confirm_upload',[m.id,h.ids.customer,'b'.repeat(64)]));await db.query("update storage.objects set metadata=$2::jsonb where name=$1",[m.path,JSON.stringify({size:43,mimetype:'image/png'})]);await assert.rejects(service('academy_portal_confirm_upload',[m.id,h.ids.customer,'b'.repeat(64)]));
  const account=await api(h.ids.owner,'account',{id:h.ids.customer});await api(h.ids.owner,'revoke',{id:account.enrollments.find(e=>e.class_id===cookie.id&&e.status==='active').id});
  await assert.rejects(h.as(h.ids.customer,()=>db.query('select public.academy_portal_upload_check($1)',[m.id])));await assert.rejects(reserve(submission,'image/png'));
  const bucket=(await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='academy-student-media'")).rows[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),26214400);assert.deepEqual(bucket.allowed_mime_types,['image/webp','image/png','image/jpeg','image/heic']);
 });
}finally{await mkdir('work/academy-original-photos',{recursive:true});await writeFile('work/academy-original-photos/database-results.json',JSON.stringify({results},null,2));await db.close();}
