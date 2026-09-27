import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://backend.test',SUPABASE_SERVICE_ROLE_KEY:'service-test',NEWSLETTER_RESEND_API_KEY:'newsletter-test',NEWSLETTER_FROM:'TLB <hello@example.test>'})[name]}};
const {processNewsletterBroadcast}=await import('../../supabase/functions/_shared/newsletter-broadcast.ts');
function mock({existing=false,started=false,status='draft',topic='topic',failure='',deferred=false}={}){
 const id=randomUUID(),calls=[],job={campaign_id:randomUUID(),lease_token:randomUUID(),provider_id:existing?id:null,send_started_at:started?'2026-09-27T00:00:00Z':null,segment_id:'segment',topic_id:'topic',content:{subject:'Treats',title:'Treats',template:'showcase',items:[]},settings:{site_url:'https://thelittlebakerkitchen.com',pickup_address:'QA address'}};
 globalThis.fetch=async(url,options)=>{
  const body=options?.body?JSON.parse(options.body):null;calls.push({url,body,method:options?.method});
  if(url.includes('/rpc/')){
   if(body.p_action==='claim')return Response.json(job);
   if(body.p_action===failure)throw Error('Network lost');
   return Response.json(body.p_action==='begin_send'?{deferred}:{ok:true});
  }
  assert.ok(url.startsWith('https://api.resend.com/broadcasts'),'Campaign must never call /emails');
  if(url.endsWith('/send')){if(failure==='send')throw Error('Network lost');return Response.json({id});}
  if(options.method==='POST')return Response.json({id});
  return Response.json({id,status,segment_id:'segment',topic_id:topic});
 };
 return {calls,id,job};
}
test('campaign creates one topic-scoped draft, persists ID and intent, then sends through Broadcasts',async()=>{
 const {calls,id}=mock();assert.equal(await processNewsletterBroadcast(),'queued');
 const create=calls.find(c=>c.url.endsWith('/broadcasts'));assert.equal(create.body.send,false);assert.equal(create.body.topic_id,'topic');assert.equal(create.body.segment_id,'segment');assert.ok(create.body.html.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'));assert.ok(create.body.text.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'));
 const actions=calls.map(c=>c.body?.p_action||c.url);assert.ok(actions.indexOf('record_draft')<actions.indexOf(`https://api.resend.com/broadcasts/${id}/send`));assert.ok(actions.indexOf('begin_send')<actions.indexOf(`https://api.resend.com/broadcasts/${id}/send`));
});
test('lost acknowledgement reconciles the same Broadcast without creating or sending again',async()=>{
 const {calls}=mock({existing:true,started:true,status:'sent'});assert.equal(await processNewsletterBroadcast(),'sent');assert.equal(calls.filter(c=>c.url.includes('api.resend')&&c.method==='POST').length,0);
});
test('an uncertain draft cannot be sent again, and an audience mismatch fails closed',async()=>{
 for(const options of [{existing:true,started:true},{existing:true,topic:'unrelated'}]){
  const {calls}=mock(options);assert.equal(await processNewsletterBroadcast(),'needs_review');assert.equal(calls.filter(c=>c.url.endsWith('/send')).length,0);assert.equal(calls.at(-1).body.p_payload.terminal,true);
 }
});
test('failure to save draft or send intent never sends; pending unsubscribe waits',async()=>{
 for(const failure of ['record_draft','begin_send']){const {calls}=mock({failure});assert.equal(await processNewsletterBroadcast(),'pending');assert.equal(calls.filter(c=>c.url.endsWith('/send')).length,0);}
 const {calls}=mock({existing:true,deferred:true});assert.equal(await processNewsletterBroadcast(),'deferred');assert.equal(calls.filter(c=>c.url.endsWith('/send')).length,0);
});
test('network interruption during send records uncertainty for provider reconciliation',async()=>{
 const {calls}=mock({existing:true,failure:'send'});assert.equal(await processNewsletterBroadcast(),'pending');assert.equal(calls.filter(c=>c.url.endsWith('/send')).length,1);assert.equal(calls.at(-1).body.p_action,'failed');
});
test('every new template uses the shared renderer and one Resend Broadcast with unsubscribe',async()=>{
 for(const template of ['promo','launch','academy']){
  const {calls,job}=mock();Object.assign(job.content,{template,offer_code:'SWEET15',offer_heading:'15% OFF',offer_terms:'Ends October 31, 2026 PHT.'});
  assert.equal(await processNewsletterBroadcast(),'queued');
  const creates=calls.filter(c=>c.url==='https://api.resend.com/broadcasts'&&c.method==='POST');assert.equal(creates.length,1);
  assert.match(creates[0].body.html,/SWEET15/);assert.match(creates[0].body.text,/Ends October 31/);assert.match(creates[0].body.html,/{{{RESEND_UNSUBSCRIBE_URL}}}/);
  assert.equal(calls.filter(c=>c.url.endsWith('/send')).length,1);
 }
});
