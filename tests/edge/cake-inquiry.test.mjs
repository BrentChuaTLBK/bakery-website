import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'public-inquiry-test'}),SUPABASE_SERVICE_ROLE_KEY:'private-service',RESEND_API_KEY:'private-provider',EMAIL_FROM:'TLB <orders@example.test>',ALLOWED_ORIGINS:'https://website.test'};
globalThis.Deno={env:{get:name=>env[name]},serve:()=>{}};
const {handler}=await import('../../supabase/functions/cake-inquiry/index.ts');
const good=()=>({id:randomUUID(),name:'Test client',email:'client@example.test',social:'Instagram: @sample',date:new Date(Date.now()+86400000).toISOString().slice(0,10),occasion:'Birthday',size:'8-inch',theme:'Pink <script>alert(1)</script> & flowers',budget:'₱3,000',website:''});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK7sAAAAASUVORK5CYII=','base64');
function request(input=good(),photos=[],origin='https://website.test'){
 const form=new FormData();form.set('details',JSON.stringify(input));for(const photo of photos)form.append('photos',photo);
 return new Request('https://edge.test',{method:'POST',headers:{apikey:'public-inquiry-test',origin,'x-forwarded-for':'192.0.2.1'},body:form});
}
function transport({state='claimed',providerStatus=200,ackFailure=false,networkFailure=false}={}){
 const calls=[];globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url:String(url),body,headers:new Headers(options.headers)});
  if(String(url).includes('/rpc/cake_inquiry_service'))return body.p_action==='claim'?reply({state,lease_token:'lease'}):reply({state:ackFailure?'error':'accepted'},ackFailure?503:200);
  assert.equal(String(url),'https://api.resend.com/emails');if(networkFailure)throw Error('private upstream failure');return reply(providerStatus===200?{id:'provider-id'}:{error:'private provider response'},providerStatus);
 };return calls;
}
test('inquiry sends fixed owner + client CC, safe reply thread and actual image attachments',async()=>{
 const calls=transport(),input=good();const response=await handler(request(input,[new File([png],'unsafe <photo>.png',{type:'image/png'})]));
 assert.equal(response.status,200);assert.equal((await response.json()).accepted,true);
 const sent=calls.find(c=>c.url.endsWith('/emails'));assert.deepEqual(sent.body.to,['Tlbk.kitchen@gmail.com']);assert.deepEqual(sent.body.cc,[input.email]);assert.deepEqual(sent.body.reply_to,['tlbk.kitchen@gmail.com',input.email]);
 assert.equal(sent.headers.get('Idempotency-Key'),'cake-inquiry:'+input.id);assert.equal(sent.body.from,env.EMAIL_FROM);
 assert.match(sent.body.html,/&lt;script&gt;/);assert.doesNotMatch(sent.body.html,/<script>/);assert.match(sent.body.text,/@sample/);assert.match(sent.body.text,/still to be confirmed/);
 assert.equal(sent.body.attachments[0].filename,'cake-reference-1.png');assert.deepEqual(Buffer.from(sent.body.attachments[0].content,'base64'),png);
 const receipt=calls[0].body.p_payload;assert.match(receipt.email_hash,/^[a-f0-9]{64}$/);assert.match(receipt.ip_hash,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(receipt),/client@|192\.0\.2\.1|Birthday/);
 assert.equal(calls.length,3,'No storage, newsletter subscription, or order writes');
});
test('invalid fields, origin and deceptive or oversized files fail before any delivery action',async()=>{
 for(const [patch,photos,status] of [
  [{email:'a@example.test\r\nBcc:other@example.test'},[],400], [{name:'A\r\nHeader'},[],400],
  [{date:'2026-02-30'},[],400],[{date:'2000-01-01'},[],400],[{theme:''},[],400],[{social:''},[],400],[{website:'spam'},[],400],
  [{},[new File(['<svg/>'],'a.png',{type:'image/png'})],415], [{},[new File([png],'a.jpg',{type:'image/jpeg'})],415],
  [{},[new File([new Uint8Array(1024*1024+1)],'a.png',{type:'image/png'})],413],
  [{},Array.from({length:5},()=>new File([png],'a.png',{type:'image/png'})),400]
 ]){const calls=transport();const response=await handler(request({...good(),...patch},photos));assert.equal(response.status,status,JSON.stringify(patch));assert.equal(calls.length,0);}
 const calls=transport();assert.equal((await handler(request(good(),[],'https://other.test'))).status,403);assert.equal(calls.length,0);
 const chunked=new Request('https://edge.test',{method:'POST',headers:{apikey:'public-inquiry-test',origin:'https://website.test','content-type':'multipart/form-data; boundary=test'},body:new ReadableStream({start(c){for(let i=0;i<6;i++)c.enqueue(new Uint8Array(1024*1024));c.close();}}),duplex:'half'});
 assert.equal((await handler(chunked)).status,413);assert.equal(calls.length,0);
});
test('durable reservation outcomes suppress duplicate sends and expired retries',async()=>{
 for(const [state,status] of [['accepted',200],['busy',409],['limited',429],['expired',409],['conflict',409]]){
  const calls=transport({state});const response=await handler(request());assert.equal(response.status,status);assert.equal(calls.length,1);
 }
});
test('network/provider/receipt failures remain retryable with identical provider key and body',async()=>{
 const input=good();let stable;
 for(const scenario of [{networkFailure:true},{providerStatus:429},{providerStatus:500},{ackFailure:true},{}]){
  const calls=transport(scenario);const response=await handler(request(input));assert.equal(response.status,Object.keys(scenario).length?503:200);
  const sent=calls.find(c=>c.url.endsWith('/emails'));if(stable)assert.deepEqual(sent.body,stable);stable=sent.body;
  assert.equal(sent.headers.get('Idempotency-Key'),'cake-inquiry:'+input.id);
  assert.doesNotMatch(await response.text(),/private|provider-id/);
 }
});
test('owner-address inquiry avoids duplicate recipients and optional fields stay optional',async()=>{
 const calls=transport();const response=await handler(request({...good(),email:'TLBK.KITCHEN@GMAIL.COM',budget:''}));assert.equal(response.status,200);
 const sent=calls.find(c=>c.url.endsWith('/emails')).body;assert.equal(sent.cc,undefined);assert.deepEqual(sent.reply_to,['tlbk.kitchen@gmail.com']);assert.equal(sent.attachments.length,0);assert.match(sent.text,/Not specified/);
});

test('inquiry rejects missing or foreign project keys before any delivery',async()=>{for(const key of ['', 'foreign-key']){const calls=transport();const r=request();if(key)r.headers.set('apikey',key);else r.headers.delete('apikey');assert.equal((await handler(r)).status,401);assert.equal(calls.length,0);}});
