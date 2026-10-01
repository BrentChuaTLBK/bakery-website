import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {handle,validateWebP} from '../../supabase/functions/academy-media/handler.ts';
import {handle as backup,runAcademyBackup} from '../../supabase/functions/academy-backup/handler.ts';
import {renderAcademyEmail} from '../../supabase/functions/_shared/academy-email.ts';
const id='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
// Minimal static lossless header fixture for the structure validator. Full
// browser-generated WebP bytes are exercised in the browser integration suite.
const photo=Buffer.from('5249464612000000574542505650384c050000002f0000000000','hex');
test('Academy media rejects malformed, animated, metadata-bearing and oversized-dimension headers',()=>{
 assert.deepEqual(validateWebP(photo),{width:1,height:1});
 for(const bytes of [Buffer.from('<svg>'),photo.subarray(0,15),Buffer.concat([photo,Buffer.from('x')])])assert.throws(()=>validateWebP(bytes));
 for(const kind of ['EXIF','XMP ','ANIM']){const bytes=Buffer.concat([photo,Buffer.from(kind),Buffer.alloc(4)]);bytes.writeUInt32LE(bytes.length-8,4);assert.throws(()=>validateWebP(bytes));}
 const huge=Buffer.from(photo);huge.writeUInt32LE(4096,21);assert.throws(()=>validateWebP(huge));
});
test('Academy upload validates user, authorization and bytes; retries never overwrite another photo',async()=>{
 const original=globalThis.fetch;globalThis.Deno={env:{get:n=>({SUPABASE_URL:'https://local.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',ALLOWED_ORIGINS:'https://academy.test'}[n]||'')}};let mode='normal',confirms=0;
 globalThis.fetch=async(url,options={})=>{if(url.endsWith('/auth/v1/user'))return Response.json({id:user});if(url.includes('upload_check'))return mode==='forbidden'?Response.json({},{status:403}):Response.json({path:id+'.webp',width:1,height:1,size_bytes:photo.length});if(url.includes('confirm_upload')){confirms++;return Response.json({uploaded:true});}if(options.method==='POST')return new Response('',{status:mode.startsWith('retry')?409:200});return new Response(mode==='retry-wrong'?Buffer.from('other photo'):photo);};
 const request=(body=photo,extra={})=>new Request(`https://local.test?id=${id}`,{method:'POST',headers:{authorization:'Bearer fixture-user','content-type':'image/webp',...extra},body});
 try{assert.equal((await handle(new Request('https://local.test',{method:'POST'}))).status,401);assert.equal((await handle(request())).status,200);mode='forbidden';assert.equal((await handle(request())).status,403);mode='normal';assert.equal((await handle(request(photo,{'content-length':'26214401'}))).status,413);assert.equal((await handle(request(Buffer.from('not an image')))).status,400);mode='retry-ok';assert.equal((await handle(request())).status,200);mode='retry-wrong';assert.equal((await handle(request())).status,409);assert.equal(confirms,2);assert.equal((await backup(new Request('https://local.test',{method:'POST',headers:{'x-worker-token':'invalid'}}))).status,401);}finally{globalThis.fetch=original;}
});
test('Academy emails escape student content, keep photos private and require marketing unsubscribe',()=>{
 const p={title:'<script>bad</script>',account_name:'Alice',preview:'<img src=x>',attachments:true,url:'https://thelittlebakerkitchen.com/academy/admin#inbox'};
 const rendered=renderAcademyEmail(p);assert.ok(!rendered.html.includes('<script>'));assert.ok(!rendered.html.includes('<img src=x>'));assert.ok(rendered.text.includes('private Academy conversation'));assert.throws(()=>renderAcademyEmail({...p,marketing:true}));const marketing=renderAcademyEmail({...p,marketing:true,unsubscribe_token:'a'.repeat(64),address:'Business address'});assert.equal(marketing.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.ok(marketing.text.includes('Unsubscribe from Academy marketing'));assert.throws(()=>renderAcademyEmail({...p,url:'https://evil.test'}));
});
test('Academy backup refuses an archive moved outside its dedicated folder before any write',async()=>{
 let uploaded=false,finished;const client={verify:async()=>({parents:['unrelated-folder']}),upload:async()=>{uploaded=true;}};
 const result=await runAcademyBackup({drive_file_id:'fixture',kind:'manual'},client,async(action,p)=>{if(action==='finish')finished=p;});
 assert.equal(result.ok,false);assert.equal(uploaded,false);assert.equal(finished.error,'access');
});
