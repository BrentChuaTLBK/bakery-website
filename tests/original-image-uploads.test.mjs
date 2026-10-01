import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {inspectImage} from '../assets/ordering/image-format.js';
import {setup} from './academy-portal.mjs';
import {blankRecipe} from '../assets/ordering/recipe-model.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSsAAAAASUVORK5CYII=','base64');
const jpeg=await readFile('assets/img/team/1stPicAboutme.jpg'),heic=await readFile('assets/CustomOrders/DripCakes/Drip14.HEIC');
test('real original PNG, JPEG and HEIC are recognized by bytes; truncated, renamed, oversized and false HEIC inputs fail',()=>{
 for(const [bytes,mime]of [[png,'image/png'],[jpeg,'image/jpeg'],[heic,'image/heic']]){const info=inspectImage(bytes);assert.equal(info.mime,mime);assert(info.width>0&&info.height>0);assert.throws(()=>inspectImage(bytes.subarray(0,bytes.length-1)));}
 for(const bytes of [Buffer.from('<svg/>'),Buffer.from('%PDF-1.7'),Buffer.from('GIF89a'),Buffer.concat([heic.subarray(0,32),Buffer.from('not a photo')]),new Uint8Array(25*1024*1024+1)])assert.throws(()=>inspectImage(bytes));
 const bomb=Buffer.from(png);bomb.writeUInt32BE(1000000,16);bomb.writeUInt32BE(1000000,20);assert.throws(()=>inspectImage(bomb));
 assert.equal(inspectImage(heic).extension,'heic');
});

test('original formats persist in recipe and Academy storage with existing privacy and ownership rules',async()=>{
 const {db,h,api,service,cookie,storage}=await setup();await db.exec('grant insert on storage.objects to authenticated');
 const recipe=(user,action,payload)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) r',[action,JSON.stringify(payload)])).rows[0].r);
 const academy=(user,action,payload)=>h.as(user,async()=>(await db.query('select public.academy_api($1,$2::jsonb) r',[action,JSON.stringify(payload)])).rows[0].r);
 try{
  const draft=await api(h.ids.customer,'draft_submission',{class_id:cookie.id,title:'Original photos',visibility:'instructor'}),recipeFiles=[];
  for(const [bytes,mime]of [[png,'image/png'],[jpeg,'image/jpeg'],[heic,'image/heic']]){
   const info=inspectImage(bytes),hash=createHash('sha256').update(bytes).digest('hex');
   const file=await recipe(h.ids.owner,'reserve_file',{filename:'original.'+info.extension,mime_type:mime,size_bytes:bytes.length,sha256:hash});
   assert.equal(file.mime_type,mime);
   await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:bytes.length,mimetype:mime})]);
   await recipe(h.ids.owner,'confirm_file',{id:file.id});recipeFiles.push(file);
   const media=await api(h.ids.customer,'reserve_media',{purpose:'submission',submission_id:draft.id,mime_type:mime,size_bytes:bytes.length,width:info.width,height:info.height});
   assert.equal(media.mime_type,mime);assert.equal(media.path,media.id+'.'+info.extension);
   await assert.rejects(h.as(h.ids.stranger,()=>db.query('select public.academy_portal_upload_check($1)',[media.id])));
   await db.query("insert into storage.objects(bucket_id,name,metadata) values('academy-student-media',$1,$2::jsonb)",[media.path,JSON.stringify({size:bytes.length,mimetype:mime})]);
   await service('academy_portal_confirm_upload',[media.id,h.ids.customer,hash]);
   assert.equal((await storage(h.ids.customer,media.path)).length,1);assert.equal((await storage(h.ids.stranger,media.path)).length,0);assert.equal((await storage(null,media.path)).length,0);
   const id=randomUUID(),path=id+'.'+info.extension;
   await h.as(h.ids.owner,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('academy-photos',$1,$2::jsonb)",[path,JSON.stringify({size:bytes.length,mimetype:mime})]));
   const asset=await academy(h.ids.owner,'register_asset',{id,mime_type:mime,name:'Original',width:info.width,height:info.height});assert.equal(asset.storage_path,path);
   await assert.rejects(academy(h.ids.staff,'register_asset',{id:randomUUID(),mime_type:mime,name:'Forbidden',width:info.width,height:info.height}));
  }
  await api(h.ids.customer,'submit_work',{id:draft.id});assert.equal((await api(h.ids.stranger,'gallery')).posts.length,0);
  const doc=blankRecipe();doc.name='Original format recipe';doc.variants[0].groups[0].ingredients[0].name='Water';doc.variants[0].groups[0].ingredients[0].quantity='1';doc.variants[0].methods[0].steps[0].instruction='Mix.';doc.photos=recipeFiles.map(f=>({id:randomUUID(),file_id:f.id,path:f.path,caption:f.filename}));
  const saved=await recipe(h.ids.owner,'create',{document:doc,status:'draft'});assert.equal(saved.document.photos.length,3);
  await assert.rejects(recipe(h.ids.owner,'reserve_file',{filename:'fake.svg',mime_type:'image/svg+xml',size_bytes:50,sha256:'a'.repeat(64)}));
  await assert.rejects(api(h.ids.customer,'reserve_media',{purpose:'submission',submission_id:draft.id,mime_type:'image/svg+xml',size_bytes:50,width:10,height:10}));
 }finally{await db.close();}
});
