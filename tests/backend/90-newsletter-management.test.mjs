import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export default async function({db,check,state}){
 const h=state.harness,{as,ids,scalar}=h;
 const migration=await readFile(new URL('../../supabase/migrations/20260927090000_newsletter_management.sql',import.meta.url),'utf8');
 await db.exec(migration);
 await db.exec("update tlb.newsletter_config set topic_id=coalesce(topic_id,'qa-topic');update tlb.settings set data=jsonb_set(data,'{pickup_address}','\"QA bakery address\"'::jsonb)");
 const admin=(action,payload={},user=ids.owner)=>as(user,async()=>(await db.query('select public.newsletter_admin($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const service=(action,payload)=>as(null,async()=>(await db.query('select public.newsletter_service($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result,'service_role');
 const offer=()=>as(null,()=>scalar('select public.newsletter_offer()'));
 const hash=t=>createHash('sha256').update(t).digest('hex');
 const signup=async()=>{const email=`campaign-${randomUUID()}@example.test`,token=randomBytes(32).toString('hex');await db.query("insert into tlb.newsletter_subscribers(email,status,source,consent_version,unsubscribe_token_hash,request_id) values($1,'subscribed','homepage','test',$2,gen_random_uuid())",[email,hash(token)]);await db.query('select tlb.queue_newsletter_welcome($1,$2)',[email,token]);return {email,token,promo:await scalar('select p.data from tlb.newsletter_subscribers n join tlb.promos p on p.id=n.welcome_promo_id where n.email=$1',[email])};};
 let first,next,campaign;
 const content={template:'showcase',subject:'Newsletter fixture',title:'A little treat',intro:'A short message',body:'Made with care',preheader:'Our latest treats',cta_url:'https://thelittlebakerkitchen.com/shop.html',cta_label:'Shop',hero_url:'',items:[]};
 await check('newsletter settings are public only as non-sensitive terms; all management is owner-only',async()=>{
  assert.equal((await offer()).value,5);
  for(const user of [null,ids.staff,ids.stranger])await assert.rejects(admin('load',{},user),/owner|authorized|permission/i);
  await assert.rejects(as(ids.owner,()=>db.query('select * from tlb.newsletter_campaign_tokens')),/permission/i);
  const report=await admin('load');assert.ok(Array.isArray(report.campaigns));assert.ok(!('topic_id' in await offer()));
 })();
 await check('changed welcome terms apply only to new codes and support fixed values and final expiry',async()=>{
  first=await signup();let o=await offer();
  await assert.rejects(admin('save_offer',{revision:o.revision,offer:{...o,value:101}}),/valid discount/);
  await admin('save_offer',{revision:o.revision,offer:{...o,value:10,min_subtotal_cents:50000,cap_cents:20000,valid_days:7}});
  await assert.rejects(admin('save_offer',{revision:o.revision,offer:o}),/changed/);
  next=await signup();assert.equal(next.promo.value,10);assert.equal(next.promo.valid_days,7);assert.equal(next.promo.min_subtotal_cents,50000);assert.equal(next.promo.cap_cents,20000);
  assert.deepEqual(await scalar('select data from tlb.promos where id=$1',[first.promo.id]),first.promo);
  o=await offer();const expiry=new Date(Date.now()+2*86400000).toISOString();await admin('save_offer',{revision:o.revision,offer:{...o,kind:'fixed',value:7500,expires_at:expiry}});const fixed=await signup();assert.equal(fixed.promo.kind,'fixed');assert.equal(fixed.promo.value,7500);assert.equal(Date.parse(fixed.promo.expires_at),Date.parse(expiry));
 })();
 await check('newsletter drafts reject unsafe content links and stale edits; test mail targets the owner only',async()=>{
  const id=randomUUID();await assert.rejects(admin('save',{id,revision:0,content:{...content,cta_url:'javascript:alert(1)'}}),/HTTPS/);
  campaign=await admin('save',{id,revision:0,content});await assert.rejects(admin('save',{id,revision:0,content}),/changed/);
  const request_id=randomUUID(),test=await admin('test',{id,revision:campaign.revision,request_id,email:'unrequested@example.test'});const again=await admin('test',{id,revision:campaign.revision,request_id});assert.equal(again.queued,1);
  const messages=(await db.query("select * from tlb.outbox where event_key=$1",['newsletter-test:'+request_id])).rows;assert.equal(messages.length,1);assert.equal(messages[0].to_email,await scalar('select email from auth.users where id=$1',[ids.owner]));assert.equal(test.email,messages[0].to_email);
 })();
 await check('campaign send snapshots content once, excludes opt-outs and keeps unsubscribe links private',async()=>{
  await db.query("update tlb.newsletter_subscribers set status='unsubscribed' where email=$1",[first.email]);
  await assert.rejects(admin('queue',{id:campaign.id,revision:campaign.revision}),/Confirm/);
  const queued=await admin('queue',{id:campaign.id,revision:campaign.revision,confirm:true});assert.ok(queued.queued>0);
  const before=await scalar("select count(*) from tlb.outbox where payload->>'campaign_id'=$1 and event_type='newsletter_campaign'",[campaign.id]);await admin('queue',{id:campaign.id,revision:campaign.revision,confirm:true});assert.equal(await scalar("select count(*) from tlb.outbox where payload->>'campaign_id'=$1 and event_type='newsletter_campaign'",[campaign.id]),before);
  assert.equal(await scalar("select count(*) from tlb.outbox where payload->>'campaign_id'=$1 and to_email=$2 and event_type='newsletter_campaign'",[campaign.id,first.email]),0);
  await assert.rejects(admin('save',{id:campaign.id,revision:campaign.revision,content}),/cannot be edited/);
  const mail=(await db.query("select * from tlb.outbox where payload->>'campaign_id'=$1 and to_email=$2 and event_type='newsletter_campaign'",[campaign.id,next.email])).rows[0];assert.deepEqual(mail.payload.content,content);assert.notEqual(mail.payload.unsubscribe_token,next.token);
  const stopped=await service('begin_unsubscribe',{token_hash:hash(mail.payload.unsubscribe_token)});assert.equal(stopped.email,next.email);assert.ok(stopped.operation_id);
  await service('finish_unsubscribe',{email:next.email,operation_id:stopped.operation_id});assert.equal(await scalar('select status from tlb.newsletter_subscribers where email=$1',[next.email]),'unsubscribed');
  const lease=randomUUID();await db.query("update tlb.outbox set status='sending',lease_token=$2,leased_until=now()+interval '5 minutes' where id=$1",[mail.id,lease]);
  const checked=await as(null,async()=>(await db.query("select public.shop_service('prepare_email',$1::jsonb) result",[JSON.stringify({id:mail.id,lease_token:lease})])).rows[0].result,'service_role');assert.equal(checked.skip,true,'An unsubscribe after queueing suppresses delivery');
 })();
 await check('newsletter management migration is repeatable and preserves saved settings and queued campaigns',async()=>{
  const before=await offer();await db.exec(migration);assert.match(await scalar("select pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure)"),/order by case when event_type in \('newsletter_campaign','newsletter_test'\)/);assert.deepEqual(await offer(),before);assert.equal((await admin('load')).campaigns.find(c=>c.id===campaign.id).status,'queued');
 })();
}
