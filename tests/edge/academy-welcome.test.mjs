import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../../supabase/functions/academy-media/handler.ts';
import {academyWelcomeImageURL} from '../../assets/ordering/academy-welcome-image.js';

test('Welcome image URLs can only reference the dedicated public WebP bucket',()=>{
 assert.match(academyWelcomeImageURL('welcome/11111111-1111-4111-8111-111111111111.webp'),/\/object\/public\/academy-welcome\/welcome\//);
 for(const path of ['../academy-student-media/private.webp','https://evil.test/a.webp','/private.webp','x%2f..%2fprivate.webp','image.jpg','data:image/svg+xml,bad','a//b.webp',null])assert.equal(academyWelcomeImageURL(path),'');
});

test('Welcome uploads are validated, immutable and isolated from protected media',async()=>{
 const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
 const id='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
 const bytes=Buffer.from('5249464612000000574542505650384c050000002f0000000000','hex');
 let record={path:'welcome/'+id+'.webp',bucket:'academy-welcome',mime_type:'image/webp',width:1,height:1,size_bytes:bytes.length},deny=false,storage=[],confirmations=0,retry=false;
 globalThis.Deno={env:{get:n=>({SUPABASE_URL:'https://local.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',ALLOWED_ORIGINS:'https://academy.test'}[n]||'')}};
 globalThis.fetch=async(url,options={})=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:user});
  if(url.includes('upload_check'))return deny?Response.json({},{status:403}):Response.json(record);
  if(url.includes('confirm_upload')){confirmations++;return Response.json({uploaded:true});}
  storage.push({url,method:options.method||'GET'});
  if(options.method==='POST'){assert.equal(options.headers['x-upsert'],'false');return new Response('',{status:retry?409:200});}
  return new Response(bytes);
 };
 const request=(type='image/webp',extra={})=>new Request('https://local.test?id='+id,{method:'POST',headers:{authorization:'Bearer fixture-user','content-type':type,...extra},body:bytes});
 try{
  assert.equal((await handle(request())).status,200);assert.equal(storage.length,1);assert.match(storage[0].url,/\/storage\/v1\/object\/academy-welcome\/welcome\//);assert.equal(confirmations,1);
  retry=true;assert.equal((await handle(request())).status,200);assert.match(storage.at(-1).url,/\/object\/authenticated\/academy-welcome\//);assert.equal(confirmations,2);
  const before=storage.length;record={...record,mime_type:'image/png'};assert.equal((await handle(request('image/png'))).status,415);assert.equal(storage.length,before);
  record={...record,mime_type:'image/webp',bucket:'unrelated-public-bucket'};assert.equal((await handle(request())).status,403);assert.equal(storage.length,before);
  record={...record,bucket:'academy-welcome'};assert.equal((await handle(request('image/webp',{'content-length':'5242881'}))).status,413);assert.equal(storage.length,before);
  deny=true;assert.equal((await handle(request())).status,403);assert.equal(storage.length,before);
 }finally{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;}
});
