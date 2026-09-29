import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export default async function({db,check,state}){
 const h=state.harness;
 const api=(action,payload={},user=h.ids.owner)=>h.as(user,async()=>(await db.query('select public.order_backup_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const service=(action,payload={})=>h.as(null,async()=>(await db.query('select public.order_backup_service($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result,'service_role');
 const {product,date}=await h.fixture(20);let o=await h.api('create_order',h.checkout(product,date));
 await check('Backups: owner-only exports; no public or staff access to service or private tables',async()=>{
  for(const user of [null,h.ids.customer,h.ids.staff,h.ids.unverified])await assert.rejects(api('download',{},user));
  for(const role of ['anon','authenticated'])assert.equal(await h.scalar("select has_function_privilege($1,'public.order_backup_service(text,jsonb)','EXECUTE')",[role]),false);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_table_privilege($1,'tlb.order_backup_connection','SELECT')",[role]),false);
  for(const user_id of [null,h.ids.customer,h.ids.staff,h.ids.unverified]){await assert.rejects(service('owner_access',{user_id}));await assert.rejects(service('download',{user_id}));}
  await assert.rejects(api('download',{scope:'all'}),/Choose paid active/);
 })();
 await check('Backups: unpaid orders are optional; paid unserved orders include full item and reservation data',async()=>{
  assert.ok(!(await api('download')).orders.some(x=>x.id===o.id));
  assert.ok((await api('download',{scope:'unserved'})).orders.some(x=>x.id===o.id));
  o=await h.proof(o);
  const review=(await api('download')).orders.find(x=>x.id===o.id);
  assert.equal(review.payment_status,'under_review');assert.equal(review.fulfillment_status,'pending_confirmation');assert.ok(review.proof_path);
  assert.ok((await service('download',{user_id:h.ids.owner})).orders.some(x=>x.id===o.id));
  o=await h.action('approve_payment',o);
  const exportOrder=(await api('download')).orders.find(x=>x.id===o.id);
  assert.equal(exportOrder.data.total_cents,o.total_cents);assert.equal(exportOrder.data.items[0].quantity,1);
  assert.equal(exportOrder.payments.length,1);assert.equal(exportOrder.allocations.length,1);assert.ok(exportOrder.history.length>0);
  for(const field of ['access_digest','access_encrypted','access_token','request_hash','idempotency_key'])assert.equal(exportOrder[field],undefined);
  assert.ok(!JSON.stringify(exportOrder).includes('access_token'));
 })();
 await check('Backups: leases serialize writes, failed uploads stay pending, newer edits are not acknowledged early',async()=>{
  await service('connect',{user_id:h.ids.owner,spreadsheet_id:'test_sheet_1234567890123456789',archive_file_id:'test_archive_1234567890123456'});
  const start=await service('begin');assert.ok(start.snapshot.orders.some(x=>x.id===o.id));
  assert.equal((await service('begin')).skipped,'busy');
  await assert.rejects(service('finish',{lease_token:randomUUID(),revision:start.revision,order_count:1}),/lease/);
  await service('finish',{lease_token:start.lease_token,error:'network'});
  const failed=await api('status');assert.equal(failed.last_success_at,null);assert.equal(failed.pending,true);
  const retry=await service('begin');
  await db.query("update tlb.orders set fulfillment_status='preparing' where id=$1",[o.id]);
  await service('finish',{lease_token:retry.lease_token,revision:retry.revision,order_count:retry.snapshot.orders.length});
  assert.equal((await api('status')).pending,true);
  const latest=await service('begin');assert.equal(latest.snapshot.orders.find(x=>x.id===o.id).fulfillment_status,'preparing');
  await service('finish',{lease_token:latest.lease_token,revision:latest.revision,order_count:latest.snapshot.orders.length});
  assert.equal((await api('status')).pending,false);assert.equal((await service('begin')).skipped,'unchanged');
 })();
 await check('Backups: completed, refunded and cancelled orders leave the active copy; overdue orders remain',async()=>{
  await db.query("update tlb.orders set fulfillment_date=current_date-1 where id=$1",[o.id]);
  assert.ok((await api('download')).orders.some(x=>x.id===o.id));
  for(const status of ['completed','cancelled','expired']){
   await db.query('update tlb.orders set fulfillment_status=$2 where id=$1',[o.id,status]);
   assert.ok(!(await api('download')).orders.some(x=>x.id===o.id));
  }
  await db.query("update tlb.orders set fulfillment_status='confirmed',refund_label=true where id=$1",[o.id]);
  assert.ok(!(await api('download')).orders.some(x=>x.id===o.id));
  assert.equal((await api('status')).pending,true);
 })();
 await check('Backups: review inclusion and removal cover both online sources and all terminal states',async()=>{
  for(const source of ['website','direct_message','pos'])for(const payment_status of ['paid','under_review','awaiting_payment'])for(const fulfillment_status of ['pending_confirmation','confirmed','preparing','ready_for_pickup','out_for_delivery','completed','cancelled','expired']){
   const expected=source!=='pos' && ((payment_status==='paid'&&['confirmed','preparing','ready_for_pickup','out_for_delivery'].includes(fulfillment_status))||(payment_status==='under_review'&&!['completed','cancelled','expired'].includes(fulfillment_status)));
   assert.equal(await h.scalar('select tlb.backup_eligible(jsonb_populate_record(null::tlb.orders,$1::jsonb))',[JSON.stringify({source,payment_status,fulfillment_status,refund_label:false})]),expected,JSON.stringify({source,payment_status,fulfillment_status}));
  }
  await db.query("update tlb.orders set refund_label=false,payment_status='under_review',fulfillment_status='pending_confirmation' where id=$1",[o.id]);
  assert.ok((await api('download')).orders.some(x=>x.id===o.id));
  const before=await h.scalar('select revision from tlb.order_backup_connection');
  await db.query("update tlb.orders set payment_status='awaiting_payment' where id=$1",[o.id]);
  assert.ok(!(await api('download')).orders.some(x=>x.id===o.id));assert.ok(await h.scalar('select revision from tlb.order_backup_connection')>before);
 })();
}
