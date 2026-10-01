import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handle,validatePhoto} from '../../supabase/functions/academy-media/handler.ts';
import {inspectOriginalPhoto,originalPhotoLimit} from '../../assets/ordering/academy-photo-format.js';
import {png,jpeg,structuralHeic} from '../helpers/academy-original-photos.mjs';

test('Original formats are determined from bounded PNG/JPEG/HEIC structures',async()=>{
 for(const [mime,bytes] of [['image/png',png],['image/jpeg',jpeg],['image/heic',structuralHeic()]]){assert.deepEqual(validatePhoto(bytes,mime),{width:4,height:3});assert.equal(inspectOriginalPhoto(bytes).mime_type,mime);}
 for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),Buffer.from('%PDF-1.4'),Buffer.from('GIF89a'),png.subarray(0,40),jpeg.subarray(0,20),structuralHeic().subarray(0,100)])assert.throws(()=>inspectOriginalPhoto(bytes));
 assert.throws(()=>validatePhoto(png,'image/jpeg'));assert.throws(()=>validatePhoto(png,'text/html'));assert.throws(()=>inspectOriginalPhoto(Buffer.alloc(originalPhotoLimit+1)));
 assert.throws(()=>inspectOriginalPhoto(structuralHeic(16385,1)));assert.throws(()=>inspectOriginalPhoto(structuralHeic(9000,9000)));
 const avif=structuralHeic();avif.write('avif',8);assert.throws(()=>inspectOriginalPhoto(avif));
 if(process.env.HEIC_TEST_FILE){const real=await readFile(process.env.HEIC_TEST_FILE);assert.equal(inspectOriginalPhoto(real).mime_type,'image/heic');assert.ok(validatePhoto(real,'image/heic').width>0);}
});

test('Original upload service preserves bytes and MIME, rejects mismatches and authorizes every retry',async()=>{
 const fetchBefore=globalThis.fetch,denoBefore=globalThis.Deno,id='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
 globalThis.Deno={env:{get:n=>({SUPABASE_URL:'https://local.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',ALLOWED_ORIGINS:'https://academy.test'}[n]||'')}};
 let mime,bytes,record,mode='normal',uploaded,confirms=0;
 globalThis.fetch=async(url,options={})=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:user});
  if(url.includes('upload_check'))return mode==='denied'?Response.json({},{status:403}):Response.json(record);
  if(url.includes('confirm_upload')){confirms++;return Response.json({uploaded:true});}
  if(options.method==='POST'){assert.equal(options.headers['Content-Type'],mime);assert.equal(options.headers['x-upsert'],'false');uploaded=Buffer.from(options.body);return new Response('',{status:mode.startsWith('retry')?409:200});}
  return new Response(mode==='retry-wrong'?Buffer.from('different bytes'):bytes);
 };
 const request=(body=bytes,type=mime,extra={})=>new Request('https://local.test?id='+id,{method:'POST',headers:{authorization:'Bearer fixture-user','content-type':type,...extra},body});
 try{
  for(const [type,original,ext] of [['image/png',png,'png'],['image/jpeg',jpeg,'jpg'],['image/heic',structuralHeic(),'heic']]){
   mime=type;bytes=original;record={path:id+'.'+ext,mime_type:mime,size_bytes:bytes.length,width:4,height:3};mode='normal';
   assert.equal((await handle(request())).status,200);assert.deepEqual(uploaded,bytes);
   assert.equal((await handle(request(bytes,'image/webp'))).status,400);
   mode='retry-ok';assert.equal((await handle(request())).status,200);
   mode='retry-wrong';assert.equal((await handle(request())).status,409);
   mode='denied';assert.equal((await handle(request())).status,403);
  }
  mode='normal';mime='image/jpeg';bytes=png;record={path:id+'.jpg',mime_type:mime,size_bytes:bytes.length,width:4,height:3};assert.equal((await handle(request())).status,415);
  assert.equal((await handle(request(bytes,mime,{'content-length':String(originalPhotoLimit+1)}))).status,413);assert.equal(confirms,6);
 }finally{globalThis.fetch=fetchBefore;globalThis.Deno=denoBefore;}
});
