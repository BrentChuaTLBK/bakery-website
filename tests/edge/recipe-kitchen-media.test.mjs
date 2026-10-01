import test from 'node:test';
import assert from 'node:assert/strict';
import {createKitchenMediaHandler,handle} from '../../supabase/functions/recipe-kitchen-media/handler.ts';
import {HttpError,endpoint} from '../../supabase/functions/_shared/server.ts';
const id='11111111-1111-4111-8111-111111111111';
const payload={recipe_id:id,version_id:id,file_id:id};
const request=(body=payload)=>new Request('https://example.test/functions/v1/recipe-kitchen-media',{method:'POST',body:JSON.stringify(body)});
const media={path:'internal/image.png',mime_type:'image/png',size_bytes:4,access:{allowed:true,role:'kitchen'}};
test('Kitchen media authorizes before and after loading and serves no-store image bytes without a signed URL',async()=>{
 const calls=[];const handler=createKitchenMediaHandler({authorize:async(_req,input)=>{calls.push('authorize');assert.equal(input.file_id,id);assert.equal(input.rd,false);return media;},imageBytes:async()=>{calls.push('read');return new Uint8Array([1,2,3,4]);}});
 const response=await handler(request(),new Headers());assert.deepEqual(calls,['authorize','read','authorize']);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('vary'),/Authorization/);assert.equal(response.headers.get('content-disposition'),'inline');assert.equal(response.headers.get('location'),null);assert.equal((await response.arrayBuffer()).byteLength,4);
});
test('unauthorized photo requests never reach private storage',async()=>{
 let reads=0;const handler=endpoint(createKitchenMediaHandler({authorize:async()=>{throw new HttpError(403,'Denied');},imageBytes:async()=>{reads++;return new Uint8Array();}}));
 const response=await handler(request());assert.equal(response.status,403);assert.equal(reads,0);assert.equal((await response.json()).error,'Denied');
});
test('access revoked during image retrieval prevents any image from reaching staff',async()=>{
 let checks=0;const handler=endpoint(createKitchenMediaHandler({authorize:async()=>{if(++checks===2)throw new HttpError(403,'Denied');return media;},imageBytes:async()=>new Uint8Array([1,2,3,4])}));
 const response=await handler(request());assert.equal(response.status,403);assert.match(response.headers.get('content-type'),/json/);assert.equal(checks,2);
});
test('PDFs, wrong sizes, invalid identifiers and GET requests are rejected',async()=>{
 let reads=0;const pdf=endpoint(createKitchenMediaHandler({authorize:async()=>({...media,mime_type:'application/pdf'}),imageBytes:async()=>{reads++;return new Uint8Array(4);}}));assert.equal((await pdf(request())).status,403);assert.equal(reads,0);
 const wrong=endpoint(createKitchenMediaHandler({authorize:async()=>media,imageBytes:async()=>new Uint8Array(3)}));assert.equal((await wrong(request())).status,503);
 assert.equal((await wrong(request({...payload,file_id:'../private.pdf'}))).status,400);assert.equal((await wrong(new Request('https://example.test/media'))).status,405);
});
test('the real handler verifies the user token, forwards user identity to both RPC checks, and confines the service key to storage',async()=>{
 const oldFetch=globalThis.fetch,oldDeno=globalThis.Deno,calls=[];let deny=false;
 globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://media-fixture.test',SUPABASE_SERVICE_ROLE_KEY:'private-fixture-service',SUPABASE_ANON_KEY:'public-fixture-key'})[key]}};
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;calls.push(path);
  if(path==='/auth/v1/user'){assert.equal(options.headers.Authorization,'Bearer user-fixture-token');return Response.json({id});}
  if(path==='/rest/v1/rpc/recipe_api'){assert.equal(options.headers.Authorization,'Bearer user-fixture-token');assert.equal(JSON.parse(options.body).p_action,'media_authorize');return Response.json(deny?{error:true}:media,{status:deny?403:200});}
  assert.equal(path,'/storage/v1/object/recipe-files/internal/image.png');assert.equal(options.headers.Authorization,'Bearer private-fixture-service');return new Response(new Uint8Array(4));
 };
 try{
  assert.equal((await handle(request())).status,401);assert.equal(calls.length,0);
  const authenticated=()=>new Request('https://example.test/media',{method:'POST',headers:{Authorization:'Bearer user-fixture-token'},body:JSON.stringify(payload)});
  const response=await handle(authenticated());assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,4);assert.deepEqual(calls,['/auth/v1/user','/rest/v1/rpc/recipe_api','/storage/v1/object/recipe-files/internal/image.png','/auth/v1/user','/rest/v1/rpc/recipe_api']);
  calls.length=0;deny=true;assert.equal((await handle(authenticated())).status,403);assert.deepEqual(calls,['/auth/v1/user','/rest/v1/rpc/recipe_api']);
 }finally{globalThis.fetch=oldFetch;globalThis.Deno=oldDeno;}
});
