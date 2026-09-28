import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createGoogleCalendar,calendarId,eventBody,calendarDescription,CalendarError} from '../../supabase/functions/calendar-sync/google.ts';
import {syncCalendar,handle} from '../../supabase/functions/calendar-sync/handler.ts';
import {calendarCopy,calendarMonth,filteredCalendarOrders,calendarSummary} from '../../assets/ordering/order-calendar.js';
const order={id:'00000000-0000-4000-8000-000000000001',reference:'TLB-FIXTURE',date:'2026-09-30',method:'delivery',status:'confirmed',buyer:{name:'Buyer',email:'fixture@example.test',phone:'09170000000'},recipient:{name:'<Recipient>',phone:'09171111111'},address:{line1:'12 Test St',locality:'Makati'},items:[{name:'Box',quantity:2}],window:'9 AM – 6 PM'};
const job={order_id:order.id,event_id:'tlb00000000000040008000000000000001g0',desired:order};
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const secret=JSON.stringify({type:'service_account',client_email:'test@fixture.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'}),project_id:'fixture'});
function fixture(sequence){const calls=[];let tokens=0;const client=createGoogleCalendar({getEnv:name=>name==='GA_SERVICE_ACCOUNT_JSON'?secret:'',request:async(url,options)=>{
 if(url==='https://oauth2.googleapis.com/token'){tokens++;const claims=JSON.parse(Buffer.from(new URLSearchParams(options.body).get('assertion').split('.')[1],'base64url'));assert.equal(claims.scope,'https://www.googleapis.com/auth/calendar.events');return Response.json({access_token:'test-token',token_type:'Bearer',expires_in:3600});}
 calls.push({url:new URL(url),...options});const item=sequence.shift();assert.ok(item,'Unexpected request');assert.equal(options.method,item.method);return item.status===204?new Response(null,{status:204}):Response.json(item.data||{},{status:item.status||200});
 }});return {client,calls,tokens:()=>tokens};}
const owned={etag:'old',extendedProperties:{private:{tlb_source:'tlb-orders',tlb_order_id:order.id}}};
assert.equal(calendarId('https://calendar.google.com/calendar/embed?src=tlb.cheesecakes%40gmail.com'),'tlb.cheesecakes@gmail.com');
assert.throws(()=>calendarId('https://evil.test/'),CalendarError);
const body=eventBody(order,job.event_id);assert.equal(body.end.date,'2026-10-01');assert.equal(body.colorId,'9');assert.match(body.description,/&lt;Recipient&gt;/);assert.deepEqual(body.attendees,[]);assert.equal(body.visibility,'private');
assert.equal(eventBody({...order,method:'pickup'},job.event_id).colorId,'2');
for(const method of ['pickup','delivery']){
 const completed=eventBody({...order,method,status:'completed'},job.event_id);
 assert.equal(completed.colorId,'8');assert.match(completed.summary,/^✓ Completed · /);
 assert.match(completed.summary,method==='pickup'?/Pickup/:/Delivery · Makati/);
 assert.equal(completed.status,'confirmed');assert.equal(completed.start.date,order.date);assert.equal(completed.id,job.event_id);
}
assert.match(calendarCopy(order),/Delivery address: 12 Test St, Makati/);assert.equal(calendarMonth('2024-02').days,29);
assert.equal(filteredCalendarOrders([order],{search:'makati'}).length,1);
{
 const sample={...order,total_cents:93000,buyer:{...order.buyer,social_platform:'Instagram',social_username:'@mia.santos'},
  pickup_address:'Private kitchen address',window:'10am – 8pm',instructions:'Call at the gate',
  items:[{name:'Build your own box',quantity:1,selection_labels:[{label:'Vanilla',quantity:2},{label:'Matcha',quantity:1}],flavor_contents:[{name:'Do not repeat',quantity:3}]}]};
 for(const method of ['pickup','delivery']){
  const value={...sample,method},summary=calendarDescription(value),event=eventBody(value,job.event_id);
  assert.equal(calendarSummary(value),summary);assert.equal(calendarCopy(value),summary);
  assert.match(summary,/Social media: Instagram · @mia.santos/);assert.match(summary,/Amount: ₱930.00/);
  assert.match(summary,/2 × Vanilla, 1 × Matcha/);assert.doesNotMatch(summary,/Do not repeat|Email:|Window:|Pickup location:|Reschedule|Buyer phone:/);
  if(method==='pickup'){
   assert.equal(event.location,'');assert.doesNotMatch(summary,/Private kitchen|Call at the gate|Recipient:|Delivery address:/);
   assert.deepEqual(summary.split('\n').filter(s=>s.includes(':')).map(s=>s.split(':')[0]),['Customer name','Phone number','Social media','Order ID','Order details','Amount']);
  }else{assert.equal(event.location,'12 Test St, Makati');assert.match(summary,/Recipient: <Recipient>/);assert.match(summary,/Delivery instructions: Call at the gate/);}
 }
 const sameRecipient={...sample,recipient:{name:sample.buyer.name,phone:sample.buyer.phone}};
 assert.doesNotMatch(calendarDescription(sameRecipient),/Recipient:|Recipient phone:/);
 assert.match(calendarDescription({...sample,buyer:{...sample.buyer,social_platform:'na',social_username:'N/A'},total_cents:0}),/Social media: Not provided/);
 assert.match(calendarDescription({...sample,total_cents:0}),/Amount: ₱0.00/);
}
{
 const f=fixture([{method:'GET',data:owned},{method:'PUT',data:{etag:'completed'}}]);
 await f.client.sync('tlb@example.test',{...job,desired:{...order,status:'completed'}});
 const update=JSON.parse(f.calls.at(-1).body);
 assert.equal(update.id,job.event_id);assert.equal(update.colorId,'8');assert.match(update.summary,/^✓ Completed/);
 assert(!f.calls.some(c=>c.method==='DELETE'),'Completing an order keeps the same event');
}
{
 const f=fixture([{method:'GET',data:{nextSyncToken:'cursor'}},{method:'GET',status:410}]);
 assert.deepEqual((await f.client.changes('tlb@example.test',null,null)).changes,[]);
 assert.equal((await f.client.changes('tlb@example.test','expired',null)).reset,true);assert.equal(f.tokens(),1);
}
{
 const f=fixture([{method:'GET',status:404},{method:'POST',status:409},{method:'GET',data:owned},{method:'PUT',data:{etag:'updated'}}]);
 assert.equal((await f.client.sync('tlb@example.test',job)).etag,'updated');
 assert(f.calls.filter(c=>c.method!=='GET').every(c=>c.url.searchParams.get('sendUpdates')==='none'));
}
{
 const f=fixture([{method:'GET',data:{etag:'unrelated'}}]);await assert.rejects(f.client.sync('tlb@example.test',job),e=>e.code==='conflict');assert.equal(f.calls.length,1);
 const removed=fixture([{method:'GET',data:owned},{method:'DELETE',status:204}]);await removed.client.sync('tlb@example.test',{...job,desired:null});
 const deleted=fixture([{method:'GET',status:410}]);assert.equal((await deleted.client.sync('tlb@example.test',job)).recreate,true);
}
{
 const f=fixture([{method:'POST',status:201},{method:'PUT',status:403,data:{error:{message:'secret provider message'}}},{method:'DELETE',status:204}]);
 await assert.rejects(f.client.verify('tlb@example.test'),e=>e.code==='access'&&!e.message.includes('secret'));assert.equal(f.calls.at(-1).method,'DELETE');
 const disabled=fixture([{method:'GET',status:403,data:{error:{details:[{reason:'SERVICE_DISABLED'}]}}}]);await assert.rejects(disabled.client.changes('tlb@example.test',null,null),e=>e.code==='api_disabled');
}
{
 const actions=[];const dispatch=async(action,payload)=>{actions.push({action,payload});if(action==='calendar_begin')return {connected:true,calendar_id:'fixture@example.test',lease_token:'lease'};if(action==='calendar_jobs')return [job,{...job,event_id:'bad'}];return {};};
 await syncCalendar({info:()=>({configured:true,service_account_email:'test@fixture.iam.gserviceaccount.com'}),changes:async()=>({changes:[],next_sync:'cursor'}),sync:async(id,j)=>{if(j.event_id==='bad')throw new CalendarError('quota');return {etag:'success'};}},dispatch);
 assert(actions.some(a=>a.action==='calendar_ack'));assert.equal(actions.find(a=>a.action==='calendar_fail').payload.error,'quota');assert.equal(actions.at(-1).action,'calendar_finish');
}
{
 const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
 const values={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-test',SUPABASE_ANON_KEY:'public-test',ALLOWED_ORIGINS:'https://thelittlebakerkitchen.com'};
 globalThis.Deno={env:{get:name=>values[name]}};
 let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('Unexpected provider request');};
 try{
  for(const headers of [{},{authorization:'Bearer public-test'},{'x-worker-token':'invalid'}]){
   const response=await handle(new Request('https://fixture/calendar-sync',{method:'POST',headers,body:'{}'}));assert.equal(response.status,401);
  }
  assert.equal(requests,0,'Anonymous and malformed worker requests cannot inspect configuration');
  globalThis.fetch=async url=>String(url).endsWith('/auth/v1/user')?Response.json({id:order.id}):Response.json({code:'42501'},{status:403});
  const denied=await handle(new Request('https://fixture/calendar-sync',{method:'POST',headers:{authorization:'Bearer staff-token'},body:JSON.stringify({action:'connection_info'})}));assert.equal(denied.status,403);
  globalThis.fetch=async url=>String(url).endsWith('/auth/v1/user')?Response.json({id:order.id}):Response.json({allowed:true,connection:{connected:false}});
  const allowed=await handle(new Request('https://fixture/calendar-sync',{method:'POST',headers:{authorization:'Bearer owner-token'},body:JSON.stringify({action:'connection_info'})}));assert.equal(allowed.status,200);assert.equal((await allowed.json()).configured,false);
 }finally{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;}
}
console.log('PASS calendar: private event data, colors, copy helpers, OAuth scope, empty calendars, expired cursors, duplicate recovery, event ownership, deletion, connection cleanup, retries and owner/worker authorization.');
