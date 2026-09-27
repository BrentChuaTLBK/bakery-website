import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export default async function({db,check,state}){
 const {as,ids,scalar}=state.harness;
 const migration=await readFile(new URL('../../supabase/migrations/20260927094000_newsletter_broadcast_delivery.sql',import.meta.url),'utf8');
 await db.exec(migration);
 await db.exec("update tlb.newsletter_config set segment_id='qa-segment',topic_id='qa-topic';update tlb.newsletter_subscribers set operation_kind=null,operation_id=null,operation_expires_at=null,provider_import_id=null,provider_import_filename=null,provider_import_started_at=null where operation_kind='unsubscribe'");
 const admin=(action,payload={})=>as(ids.owner,async()=>(await db.query('select public.newsletter_admin($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const service=(action,payload={})=>as(null,async()=>(await db.query('select public.newsletter_broadcast_service($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result,'service_role');
 const content={template:'showcase',subject:'Broadcast test',title:'Treats',cta_url:'https://thelittlebakerkitchen.com/shop.html',items:[]};
 let campaign,job;
 await check('Broadcast queue is owner-confirmed, snapshots once and creates no transactional campaign emails',async()=>{
  campaign=await admin('save',{id:randomUUID(),revision:0,content});
  await assert.rejects(admin('queue',{id:campaign.id,revision:campaign.revision}),/Confirm/);
  const queued=await admin('queue',{id:campaign.id,revision:campaign.revision,confirm:true});assert.equal(queued.delivery_method,'broadcast');
  await admin('queue',{id:campaign.id,revision:campaign.revision,confirm:true});
  assert.equal(await scalar('select count(*) from tlb.newsletter_broadcast_jobs where campaign_id=$1',[campaign.id]),1);
  assert.equal(await scalar("select count(*) from tlb.outbox where event_type='newsletter_campaign' and payload->>'campaign_id'=$1",[campaign.id]),0);
  assert.deepEqual(await scalar('select content from tlb.newsletter_broadcast_jobs where campaign_id=$1',[campaign.id]),content);
  assert.equal((await admin('load')).campaigns.find(c=>c.id===campaign.id).broadcast_status,'pending');
 })();
 await check('Broadcast service and records cannot be accessed by browser users; leases are exclusive',async()=>{
  for(const user of [null,ids.owner,ids.staff]){
   await assert.rejects(as(user,()=>db.query("select public.newsletter_broadcast_service('claim')")),/permission/i);
   await assert.rejects(as(user,()=>db.query('select * from tlb.newsletter_broadcast_jobs')),/permission/i);
  }
  job=await service('claim');assert.equal(job.campaign_id,campaign.id);assert.equal(await service('claim'),null);
  await assert.rejects(service('record_draft',{id:campaign.id,lease_token:randomUUID(),provider_id:randomUUID()}),/lease expired/i);
 })();
 await check('Broadcast ID is durable before sending; pending unsubscribe defers and send intent can only be set once',async()=>{
  const lease={id:campaign.id,lease_token:job.lease_token},provider_id=randomUUID();
  await assert.rejects(service('begin_send',lease),/already started/i);
  await service('record_draft',{...lease,provider_id});
  await assert.rejects(service('record_draft',{...lease,provider_id:randomUUID()}),/cannot change/i);
  const email=await scalar("select email from tlb.newsletter_subscribers where status='subscribed' and operation_id is null limit 1");
  await db.query("update tlb.newsletter_subscribers set operation_kind='unsubscribe',operation_id=gen_random_uuid(),operation_expires_at=now()+interval '2 minutes' where email=$1",[email]);
  assert.equal((await service('begin_send',lease)).deferred,true);
  assert.equal(await scalar('select send_started_at from tlb.newsletter_broadcast_jobs where campaign_id=$1',[campaign.id]),null);
  await db.query('update tlb.newsletter_subscribers set operation_kind=null,operation_id=null,operation_expires_at=null,provider_import_id=null,provider_import_filename=null,provider_import_started_at=null where email=$1',[email]);
  await db.query('update tlb.newsletter_broadcast_jobs set next_attempt_at=now() where campaign_id=$1',[campaign.id]);
  job=await service('claim');lease.lease_token=job.lease_token;
  await service('begin_send',lease);await assert.rejects(service('begin_send',lease),/already started/i);
  await service('failed',{...lease,error:'Network interruption'});
  await db.query('update tlb.newsletter_broadcast_jobs set next_attempt_at=now() where campaign_id=$1',[campaign.id]);
  job=await service('claim');assert.equal(job.provider_id,provider_id);assert.ok(job.send_started_at);
  await service('accepted',{id:campaign.id,lease_token:job.lease_token,provider_status:'sent'});
  assert.equal((await admin('load')).campaigns.find(c=>c.id===campaign.id).broadcast_status,'sent');
  assert.equal(await service('claim'),null);
 })();
 await check('Broadcast migration preserves history when reapplied',async()=>{
  await db.exec(migration);
  assert.equal((await admin('load')).campaigns.find(c=>c.id===campaign.id).broadcast_status,'sent');
 })();
}
