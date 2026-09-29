import test from 'node:test';
import assert from 'node:assert/strict';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'local-service',EMAIL_WORKER_TOKEN:'local-worker-token-with-32-characters',RESEND_API_KEY:'orders-key',EMAIL_FROM:'Orders <orders@example.test>',NEWSLETTER_RESEND_API_KEY:'newsletter-key',NEWSLETTER_FROM:'TLB <hello@example.test>'};
let worker;
globalThis.Deno={env:{get:key=>env[key]},serve:handler=>{worker=handler;}};
await import('../../supabase/functions/email-worker/index.ts');
const {renderEmail}=await import('../../supabase/functions/_shared/emails.ts');
const payload={event_type:'newsletter_voucher',topic_id:'newsletter',unsubscribe_token:'a'.repeat(64),settings:{site_url:'https://thelittlebakerkitchen.com',shop_name:'The Little Baker Kitchen',pickup_address:'Test kitchen'},email_copy:{eyebrow:'Thank you',heading:'A little {{discount}} treat',message:'Thank you for ordering.'},offer:{code:'TLB-TEST123',kind:'fixed',value:5000,min_subtotal_cents:30000,expires_at:'2027-10-29T15:59:00Z'}};
const row={id:'voucher-row',event_key:'voucher:local-fixture',to_email:'owner@example.test',subject:'A thank-you from TLB',lease_token:'test-lease',payload};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status});
for(const scenario of ['send','local_skip','global_optout','topic_optout','contact_missing','provider_outage','rate_limit','ack_failure','retry']){
 test(`voucher worker: ${scenario}`,async()=>{
  const actions=[],sends=[];
  globalThis.fetch=async(url,options={})=>{
   const endpoint=String(url);
   if(endpoint.includes('/rpc/shop_service')){
    const body=JSON.parse(options.body);actions.push(body.p_action);
    if(body.p_action==='claim_emails')return reply([row]);
    if(body.p_action==='prepare_email')return reply(scenario==='local_skip'?{skip:true}:row);
    if(body.p_action==='email_sent'&&scenario==='ack_failure')return reply({error:'Unavailable'},503);
    return reply({});
   }
   if(endpoint.includes('/rpc/newsletter_broadcast_service'))return reply(null);
   assert.equal(new Headers(options.headers).get('Authorization'),'Bearer newsletter-key');
   if(endpoint.endsWith('/emails')){
    sends.push(JSON.parse(options.body));assert.equal(new Headers(options.headers).get('Idempotency-Key'),row.event_key);
    return scenario==='rate_limit'?reply({name:'rate_limited'},429):reply({id:'accepted-voucher'});
   }
   if(scenario==='provider_outage')return reply({error:'Unavailable'},503);
   if(endpoint.includes('/topics?'))return reply({data:[{id:'newsletter',subscription:scenario==='topic_optout'?'opt_out':'opt_in'}],has_more:false});
   return scenario==='contact_missing'?reply({},404):reply({id:'contact',unsubscribed:scenario==='global_optout'});
  };
  const invoke=async()=>{const r=await worker(new Request('https://local.test',{method:'POST',headers:{'x-worker-token':env.EMAIL_WORKER_TOKEN}}));assert.equal(r.status,200);return r.json();};
  const result=await invoke();
  if(['local_skip','global_optout','topic_optout','contact_missing'].includes(scenario)){assert.equal(result.skipped,1);assert.equal(sends.length,0);assert.ok(!actions.includes('email_sent'));}
  else if(['provider_outage','rate_limit','ack_failure'].includes(scenario)){assert.equal(result.failed,1);assert.ok(actions.includes('email_failed'));assert.equal(result.acknowledgement_pending,scenario==='ack_failure'?1:0);}
  else {
   assert.equal(result.accepted,1);assert.equal(sends[0].from,env.NEWSLETTER_FROM);assert.deepEqual(sends[0].to,[row.to_email]);
   assert.deepEqual({html:sends[0].html,text:sends[0].text},renderEmail(payload));
   if(scenario==='retry'){await invoke();assert.deepEqual(sends[1],sends[0],'Provider retry must use the exact original message');}
  }
 });
}
