import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const require=createRequire(join(resolve(process.env.PGLITE_PACKAGE_ROOT||'../newsletter-test-deps'),'package.json'));
const {PGlite}=require('@electric-sql/pglite');
test('private inquiry receipts enforce reservations, replay safety, quotas and least privilege',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create schema tlb; create role anon; create role authenticated; create role service_role;');
  await db.exec(await readFile(new URL('../supabase/migrations/20261001174104_custom_cake_inquiries.sql',import.meta.url),'utf8'));
  const invoke=async(action,payload)=>(await db.query('select public.cake_inquiry_service($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
  const payload=()=>({id:randomUUID(),fingerprint:'a'.repeat(64),email_hash:'b'.repeat(64),ip_hash:'c'.repeat(64)});
  const p=payload(),claim=await invoke('claim',p);assert.equal(claim.state,'claimed');assert.equal((await invoke('claim',p)).state,'busy');
  assert.equal((await invoke('claim',{...p,fingerprint:'f'.repeat(64)})).state,'conflict');
  await assert.rejects(invoke('accepted',{id:p.id,lease_token:randomUUID(),provider_id:'wrong'}),/changed/);
  await db.query("update tlb.cake_inquiry_deliveries set lease_until=now()-interval '1 minute' where id=$1",[p.id]);
  const again=await invoke('claim',p);assert.equal(again.state,'claimed');assert.notEqual(again.lease_token,claim.lease_token);
  await invoke('accepted',{id:p.id,lease_token:again.lease_token,provider_id:'accepted'});
  await db.query("update tlb.cake_inquiry_deliveries set created_at=now()-interval '30 days' where id=$1",[p.id]);
  assert.equal((await invoke('claim',p)).state,'accepted','Accepted replay remains closed beyond provider expiry');
  const expired=payload();await invoke('claim',expired);await db.query("update tlb.cake_inquiry_deliveries set created_at=now()-interval '24 hours',lease_until=now()-interval '1 hour' where id=$1",[expired.id]);assert.equal((await invoke('claim',expired)).state,'expired');
  for(let i=0;i<3;i++)assert.equal((await invoke('claim',payload())).state,'claimed');
  assert.equal((await invoke('claim',payload())).state,'limited','Per-email daily limit');
  for(let i=0;i<2;i++)assert.equal((await invoke('claim',{...payload(),email_hash:String(i).repeat(64)})).state,'claimed');
  assert.equal((await invoke('claim',{...payload(),email_hash:'9'.repeat(64)})).state,'limited','Per-IP hourly limit');
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);await assert.rejects(invoke('claim',payload()),/permission denied/);await assert.rejects(db.query('select * from tlb.cake_inquiry_deliveries'),/permission denied/);await db.exec('reset role');
  }
  await db.exec('set role service_role');const fresh={...payload(),email_hash:'8'.repeat(64),ip_hash:'8'.repeat(64)};assert.equal((await invoke('claim',fresh)).state,'claimed');await assert.rejects(db.query('select * from tlb.cake_inquiry_deliveries'),/permission denied/);await db.exec('reset role');
  const columns=(await db.query("select column_name from information_schema.columns where table_schema='tlb' and table_name='cake_inquiry_deliveries'")).rows.map(r=>r.column_name);assert.ok(!columns.some(c=>['email','name','theme','photos','payload','ip'].includes(c)));
  const concurrent={...payload(),email_hash:'7'.repeat(64),ip_hash:'7'.repeat(64)};assert.deepEqual((await Promise.all([invoke('claim',concurrent),invoke('claim',concurrent)])).map(r=>r.state),['claimed','busy']);
  await db.query("insert into tlb.cake_inquiry_deliveries select gen_random_uuid(),repeat('a',64),repeat('d',64),repeat('e',64),now(),gen_random_uuid(),now(),null,null from generate_series(1,50)");
  assert.equal((await invoke('claim',{...payload(),email_hash:'6'.repeat(64),ip_hash:'6'.repeat(64)})).state,'limited','Global quota still protects against many addresses');
 }finally{await db.close();}
});
