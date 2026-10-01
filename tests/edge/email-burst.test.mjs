import test from 'node:test';
import assert from 'node:assert/strict';
const env={SUPABASE_URL:'https://backend.test',SUPABASE_SERVICE_ROLE_KEY:'service-test',EMAIL_WORKER_TOKEN:'worker-token-with-more-than-32-characters',RESEND_API_KEY:'test-key',EMAIL_FROM:'Test <test@example.test>'};
let worker;globalThis.Deno={env:{get:key=>env[key]},serve:fn=>worker=fn};
await import('../../supabase/functions/email-worker/index.ts');
const invoke=()=>worker(new Request('https://worker.test',{method:'POST',headers:{'x-worker-token':env.EMAIL_WORKER_TOKEN}}));
test('Academy notifications, replies, news and invitations use the Academy sender with stable retries',async()=>{
 const academyFrom='TLB Academy <Academy@thelittlebakerkitchen.com>';
 const cases=[
  {event_type:'academy_notification',title:'New question'},
  {event_type:'academy_notification',title:'Your instructor replied',student_reply:true},
  {event_type:'academy_broadcast',title:'Academy news',marketing:true,unsubscribe_token:'a'.repeat(64),address:'Test postal address'},
  {event_type:'academy_broadcast',title:'Class update',marketing:false},
  {event_type:'academy_invitation',title:'Welcome to TLB Academy'},
  {event_type:'recipe_access_invitation',email:'test@example.test',permission:'kitchen'},
  {event_type:'newsletter_test',unsubscribe_token:'a'.repeat(64),settings:{site_url:'https://example.test',shop_name:'Test'}}
 ];
 for(const [index,payload] of cases.entries()){
  const row={id:'sender-'+index,lease_token:'lease-'+index,event_key:'sender-test:'+index,to_email:'test@example.test',payload:{url:'https://thelittlebakerkitchen.com/academy/dashboard',preview:'Synthetic test',...payload}},sends=[],actions=[];
  globalThis.fetch=async(url,options={})=>{
   const body=JSON.parse(options.body||'{}');
   if(String(url).endsWith('/newsletter_broadcast_service'))return Response.json(null);
   if(String(url).includes('/rpc/shop_service')){
    actions.push(body.p_action);
    if(body.p_action==='claim_emails')return Response.json([row]);
    if(body.p_action==='prepare_email')return Response.json(row);
    return Response.json({});
   }
   assert.equal(url,'https://api.resend.com/emails');
   assert.equal(options.headers['Idempotency-Key'],row.event_key);
   sends.push(body);return Response.json({id:'provider-'+index});
  };
  for(let attempt=0;attempt<2;attempt++){const response=await invoke();assert.equal(response.status,200);assert.equal((await response.json()).accepted,1);}
  assert.equal(sends[0].from,index<5?academyFrom:env.EMAIL_FROM);
  if(index<5)assert.equal(sends[0].subject,'TLB Academy update');
  if(payload.marketing)assert.ok(sends[0].headers['List-Unsubscribe']);
  assert.deepEqual(sends[1],sends[0]);assert.ok(!actions.includes('email_failed'));
 }
});
test('worker drains five small batches with unique stable keys and paced sends',async()=>{
 let claimed=0,sends=[];const rows=new Map();
 globalThis.fetch=async(url,options)=>{
  const p=JSON.parse(options.body||'{}');
  if(String(url).endsWith('/newsletter_broadcast_service'))return Response.json(null);
  if(String(url).includes('/rpc/shop_service')){
   if(p.p_action==='claim_emails'){
    assert.equal(p.p_payload.limit,3);claimed++;
    return Response.json(Array.from({length:3},()=>{const id=String(rows.size);const row={id,lease_token:'lease-'+id,event_key:'burst:'+id,to_email:'test@example.test',subject:'Test',payload:{event_type:'newsletter_test',unsubscribe_token:'a'.repeat(64),settings:{site_url:'https://example.test',shop_name:'Test'}}};rows.set(id,row);return row}));
   }
   if(p.p_action==='prepare_email')return Response.json(rows.get(p.p_payload.id));
   return Response.json({});
  }
  assert.equal(url,'https://api.resend.com/emails');sends.push({key:options.headers['Idempotency-Key'],at:Date.now()});return Response.json({id:'provider-'+sends.length});
 };
 const response=await invoke(),result=await response.json();assert.equal(response.status,200);assert.equal(claimed,5);assert.equal(result.accepted,15);assert.equal(new Set(sends.map(s=>s.key)).size,15);
 for(let i=1;i<sends.length;i++)assert.ok(sends[i].at-sends[i-1].at>=700,'Provider requests must be paced');
});
test('provider failure finishes only its leased batch and does not claim more work',async()=>{
 let claims=0,failed=0;
 globalThis.fetch=async(url,options)=>{const p=JSON.parse(options.body||'{}');if(String(url).endsWith('/newsletter_broadcast_service'))return Response.json(null);if(p.p_action==='claim_emails'){claims++;return Response.json([1,2,3].map(id=>({id,lease_token:'lease'})))}if(p.p_action==='prepare_email')return Response.json({to_email:'test@example.test',event_key:'test:'+p.p_payload.id,payload:{event_type:'newsletter_test',settings:{site_url:'https://example.test',shop_name:'Test'}}});if(p.p_action==='email_failed')failed++;if(String(url).includes('api.resend.com'))return Response.json({name:'rate_limit_exceeded'},{status:429});return Response.json({})};
 const result=await(await invoke()).json();assert.equal(claims,1);assert.equal(result.failed,3);assert.equal(failed,3);
});
