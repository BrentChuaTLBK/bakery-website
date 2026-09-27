import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export default async function({db,check,state}){
 const h=state.harness;
 const migration=await readFile(new URL('../../supabase/migrations/20260927211035_email_alert_acknowledgements.sql',import.meta.url),'utf8');
 await db.exec(migration);
 const id=randomUUID(),error='Temporary provider failure';
 await db.query("insert into tlb.outbox(id,event_key,event_type,to_email,subject,payload,status,attempts,last_error) values($1,$2,'newsletter_test','owner@example.test','Test alert','{}','pending',2,$3)",[id,'ack-test:'+id,error]);
 const row=async()=>(await db.query('select * from tlb.outbox where id=$1',[id])).rows[0];
 const payload=()=>({id,attempts:2,status:'pending',last_error:error});
 const ack=(p=payload(),user=h.ids.owner)=>h.api('acknowledge_email_alert',p,user);
 const reported=async()=>(await h.api('admin_bootstrap',{},h.ids.owner)).email_status.find(e=>e.id===id);
 const delivery=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('alert_acknowledged')));
 await check('email alert acknowledgement is restricted to staff and cannot mutate delivery records',async()=>{
  for(const user of [null,h.ids.stranger])await assert.rejects(ack(payload(),user),/authorized|staff|permission/i);
  await assert.rejects(h.as(h.ids.owner,()=>db.query('select tlb.acknowledge_email_alert($1::jsonb)',[JSON.stringify(payload())])),/permission/i);
  await assert.rejects(ack({id:randomUUID(),attempts:2,status:'pending',last_error:error}),/not found/);
  for(const p of [{...payload(),attempts:1},{...payload(),last_error:'Changed error'},{...payload(),status:'failed'},{id}])await assert.rejects(ack(p),/changed/);
  const before=await row(),result=await ack();
  assert.equal(result.alert_acknowledged,true);assert.deepEqual(delivery(await row()),delivery(before));
  assert.equal((await row()).alert_acknowledged_by,h.ids.owner);
  assert.equal((await reported()).alert_acknowledged,true);
  assert.deepEqual(await ack(payload(),h.ids.staff),result,'Repeated acknowledgement keeps its original audit');
 })();
 await check('later email attempts, status changes and new errors surface again and stale views cannot dismiss them',async()=>{
  await db.query('update tlb.outbox set attempts=3 where id=$1',[id]);
  assert.equal((await reported()).alert_acknowledged,false);await assert.rejects(ack(),/changed/);
  await ack({...payload(),attempts:3},h.ids.staff);assert.equal((await row()).alert_acknowledged_by,h.ids.staff);
  await db.query("update tlb.outbox set last_error='New failure' where id=$1",[id]);
  assert.equal((await reported()).alert_acknowledged,false);
  await ack({...payload(),attempts:3,last_error:'New failure'});
  await db.query("update tlb.outbox set status='failed' where id=$1",[id]);
  assert.equal((await reported()).alert_acknowledged,false);
  await ack({...payload(),attempts:3,last_error:'New failure',status:'failed'});
  const before=await row();await db.exec(migration);assert.deepEqual(await row(),before);assert.equal((await reported()).alert_acknowledged,true);
  await db.query("update tlb.outbox set status='sent',last_error=null where id=$1",[id]);
  await assert.rejects(ack({...payload(),attempts:3,last_error:'New failure',status:'failed'}),/resolved/);
  assert.equal((await row()).status,'sent');
 })();
}
