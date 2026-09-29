import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {makeHarness} from './helpers.mjs';
export default async function({db,check,state}){
 const h=state.harness||await makeHarness(db),scan=()=>db.exec('select tlb.check_operation_alerts()'),num=sql=>h.scalar(sql);
 await db.exec("update tlb.outbox set status='sent';update tlb.newsletter_broadcast_jobs set status='sent';update tlb.calendar_connection set enabled=false;delete from tlb.operation_incidents;");
 const id=randomUUID();
 await check('sustained email failure opens one private incident and exactly one owner notification',async()=>{
  await db.query("insert into tlb.outbox(id,event_key,event_type,to_email,subject,payload,status,attempts,created_at,available_at) values($1::uuid,$1::text,'newsletter_test','fixture@example.test','fixture','{}','pending',1,now()-interval '5 minutes',now())",[id]);
  await scan();assert.equal(await num('select count(*)::int from tlb.operation_incidents'),0);
  await db.query("update tlb.outbox set attempts=3,created_at=now()-interval '40 minutes' where id=$1",[id]);
  await scan();await scan();
  assert.equal(await num('select count(*)::int from tlb.operation_incidents where resolved_at is null'),1);
  assert.equal(await num("select count(*)::int from tlb.outbox where event_type='operational_alert' and payload->>'phase'='opened'"),1);
  assert.equal(await num("select to_email from tlb.outbox where event_type='operational_alert' order by created_at desc limit 1"),'brentchua1223@gmail.com');
 })();
 await check('recovery sends once and monitor emails cannot create recursive incidents',async()=>{
  await db.query("update tlb.outbox set status='sent' where id=$1",[id]);
  await db.exec("update tlb.outbox set status='failed',attempts=8,created_at=now()-interval '1 day' where event_type='operational_alert'");
  await scan();await scan();assert.equal(await num('select count(*)::int from tlb.operation_incidents where resolved_at is null'),0);
  assert.equal(await num("select count(*)::int from tlb.outbox where event_type='operational_alert' and payload->>'phase'='recovered'"),1);
 })();
 await check('stopped calendar worker alerts without a pending order and recovers after a recent sync',async()=>{
  await db.exec("update tlb.calendar_events set synced_revision=revision;update tlb.calendar_connection set enabled=true,calendar_id='fixture@group.calendar.google.com',connected_at=now()-interval '1 hour',last_success_at=null");
  await scan();await scan();assert.equal(await num("select count(*)::int from tlb.operation_incidents where channel='calendar' and resolved_at is null"),1);
  await db.exec("update tlb.calendar_connection set last_success_at=now()");await scan();
  assert.equal(await num("select count(*)::int from tlb.operation_incidents where channel='calendar' and resolved_at is null"),0);
 })();
 await check('anonymous and customer roles cannot read incidents, run monitors or call worker gateways',async()=>{
  for(const user of [null,h.ids.customer,h.ids.staff,h.ids.owner]){
   await assert.rejects(h.as(user,()=>db.exec('select * from tlb.operation_incidents')),/permission denied/);
   await assert.rejects(h.as(user,()=>db.exec('select tlb.check_operation_alerts()')),/permission denied/);
   if(![h.ids.staff,h.ids.owner].includes(user))await assert.rejects(h.api('admin_bootstrap',{},user),/staff|permission|sign in|access/i);
   for(const rpc of ['shop_service','shop_calendar_service','newsletter_service','newsletter_broadcast_service'])await assert.rejects(h.as(user,()=>db.query(`select public.${rpc}('maintenance','{}')`)),/permission denied/);
  }
  for(const user of [h.ids.staff,h.ids.owner]){const data=await h.api('admin_bootstrap',{},user);assert.ok(Array.isArray(data.operation_incidents));}
 })();
 await check('newsletter broadcast review failures join email alerts and resolved broadcasts recover once',async()=>{
  const campaign=randomUUID();await db.query("insert into tlb.newsletter_campaigns(id,content,created_by) values($1,'{}',$2)",[campaign,h.ids.owner]);
  await db.query("insert into tlb.newsletter_broadcast_jobs(campaign_id,content,settings,segment_id,topic_id,recipient_estimate,status,attempts,created_at) values($1,'{}','{}','fixture','fixture',1,'needs_review',8,now()-interval '40 minutes')",[campaign]);
  await scan();await scan();assert.equal(await num("select count(*)::int from tlb.operation_incidents where channel='email' and resolved_at is null"),1);
  await db.query("update tlb.newsletter_broadcast_jobs set status='sent' where campaign_id=$1",[campaign]);await scan();
  assert.equal(await num("select count(*)::int from tlb.operation_incidents where channel='email' and resolved_at is null"),0);
 })();
}
