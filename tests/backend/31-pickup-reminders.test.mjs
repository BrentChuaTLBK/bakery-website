import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const { api, ids, checkout, fixture, action, proof, scalar, service, order } = state.harness;
  const ready = async () => {
    const { product, date } = await fixture();
    const submitted = await api('create_order', checkout(product,date),ids.customer);
    const paid = await action('approve_payment',await proof(submitted));
    return action('set_fulfillment',paid,{status:'ready_for_pickup'});
  };
  const request = o => ({order_id:o.id,revision:o.revision,idempotency_key:randomUUID()});
  const count = id => scalar("select count(*)::int from tlb.outbox where order_id=$1 and event_type='pickup_reminder'",[id]);
  const retireOtherMessages = async () => db.exec("update tlb.outbox set status='skipped',lease_token=null,leased_until=null where event_type<>'pickup_reminder' and status in ('pending','sending')");

  await check('staff can queue a pickup reminder without changing fulfillment, revision, stock or payment',async()=>{
    const o=await ready(), payload=request(o);
    const allocations=await state.harness.allocations(o.id);
    const result=await api('send_pickup_reminder',payload,ids.staff);
    assert.equal(result.pickup_reminder.status,'pending');
    assert.equal(result.fulfillment_status,'ready_for_pickup');
    assert.equal(result.payment_status,'paid');
    assert.equal(result.revision,o.revision);
    assert.deepEqual(await state.harness.allocations(o.id),allocations);
    const [queued]=(await db.query("select * from tlb.outbox where order_id=$1 and event_type='pickup_reminder'",[o.id])).rows;
    assert.equal(queued.to_email,'customer@example.test');
    assert.equal(queued.subject,'Reminder: your order is ready for pickup · '+o.reference);
    assert.equal(queued.payload.order.access_token.length,64);
    assert.equal(queued.payload.order.pickup_address,o.pickup_address);
    assert.equal(queued.payload.order.pickup_reminder,undefined,'Internal delivery data stays out of customer email');
    assert.equal((await api('get_order',{order_id:o.id},ids.customer)).pickup_reminder,undefined);
    assert.equal((await api('get_order',{order_id:o.id},ids.customer)).history.some(h=>h.action==='pickup_reminder_requested'),false);
    const replay=await api('send_pickup_reminder',payload,ids.staff);
    assert.equal(replay.pickup_reminder.id,result.pickup_reminder.id);
    const otherStaff=await api('send_pickup_reminder',request(o),ids.owner);
    assert.equal(otherStaff.pickup_reminder.id,result.pickup_reminder.id);
    assert.equal(await count(o.id),1);
    assert.equal(await scalar("select count(*)::int from tlb.history where order_id=$1 and action='pickup_reminder_requested'",[o.id]),1);
  })();

  await check('customers, guests and spoofed payload roles cannot request reminders or call private helpers',async()=>{
    const o=await ready();
    for(const user of [null,ids.customer,ids.stranger,ids.unverified])
      await assert.rejects(api('send_pickup_reminder',{...request(o),user_id:ids.owner,role:'owner'},user),/access|authorized/i);
    assert.equal(await count(o.id),0);
    for(const role of ['anon','authenticated','service_role'])
      assert.equal(await scalar("select has_function_privilege($1,'tlb.send_pickup_reminder(uuid,jsonb)','EXECUTE')",[role]),false);
    await assert.rejects(api('send_pickup_reminder',{...request(o),revision:o.revision-1},ids.owner),/changed|refresh/i);
  })();

  await check('only paid, unrefunded ready pickup orders can be reminded, and the saved buyer is the recipient',async()=>{
    const o=await ready();
    for(const [column,value] of [['method','delivery'],['payment_status','under_review'],['fulfillment_status','confirmed'],['fulfillment_status','completed'],['fulfillment_status','cancelled'],['fulfillment_status','expired'],['refund_label',true]]){
      try{
        await db.query(`update tlb.orders set ${column}=$1 where id=$2`,[value,o.id]);
        await assert.rejects(api('send_pickup_reminder',request(o),ids.owner),/only paid orders.*ready for pickup/i);
      }finally{await db.query(`update tlb.orders set ${column}=$1 where id=$2`,[o[column],o.id]);}
    }
    const result=await api('send_pickup_reminder',{...request(o),email:'different@example.test',to_email:'different@example.test'},ids.owner);
    assert.equal(await scalar('select to_email from tlb.outbox where id=$1',[result.pickup_reminder.id]),'customer@example.test');
  })();

  await check('provider acceptance is recorded, cooldown blocks fresh sends, and retries keep one event and payload',async()=>{
    // Retire every earlier fixture to claim just this reminder.
    await db.exec("update tlb.outbox set status='skipped',lease_token=null,leased_until=null where status in ('pending','sending')");
    const o=await ready(), payload=request(o);
    const requested=await api('send_pickup_reminder',payload,ids.owner);
    await retireOtherMessages();
    const [claim]=await service('claim_emails',{limit:10});
    assert.equal(claim.id,requested.pickup_reminder.id);
    const first=await service('prepare_email',{id:claim.id,lease_token:claim.lease_token});
    await service('email_failed',{id:claim.id,lease_token:claim.lease_token,error:'Temporary fixture failure'});
    await db.query("update tlb.outbox set available_at=now()-interval '1 minute' where id=$1",[claim.id]);
    const [retry]=await service('claim_emails',{limit:10});
    const second=await service('prepare_email',{id:retry.id,lease_token:retry.lease_token});
    assert.equal(second.event_key,first.event_key);
    assert.deepEqual(second.payload,first.payload);
    await service('email_sent',{id:retry.id,lease_token:retry.lease_token,provider_id:'fixture-provider-id'});
    assert.equal((await order(o.id)).pickup_reminder.status,'sent');
    await assert.rejects(api('send_pickup_reminder',request(o),ids.owner),/wait 15 minutes/i);
    assert.equal((await api('send_pickup_reminder',payload,ids.owner)).pickup_reminder.id,claim.id);
    await db.query("update tlb.outbox set created_at=now()-interval '16 minutes',sent_at=now()-interval '16 minutes' where id=$1",[claim.id]);
    const next=await api('send_pickup_reminder',request(o),ids.owner);
    assert.notEqual(next.pickup_reminder.id,claim.id);
    assert.equal(await count(o.id),2);
    await db.query("update tlb.outbox set status='skipped' where id=$1",[next.pickup_reminder.id]);
  })();

  await check('queued reminders are skipped before sending if the order or recipient changes',async()=>{
    for(const [column,value] of [['fulfillment_status','completed'],['fulfillment_status','cancelled'],['fulfillment_status','preparing'],['refund_label',true],['method','delivery'],['revision',999],['fulfillment_date','2035-01-01'],['email','updated@example.test']]){
      const o=await ready();
      const sent=await api('send_pickup_reminder',request(o),ids.owner);
      await retireOtherMessages();
      const claim=(await service('claim_emails',{limit:10})).find(e=>e.id===sent.pickup_reminder.id);
      assert.ok(claim);
      if(column==='email') await db.query("update tlb.orders set data=jsonb_set(data,'{buyer,email}',to_jsonb($1::text)) where id=$2",[value,o.id]);
      else await db.query(`update tlb.orders set ${column}=$1 where id=$2`,[value,o.id]);
      assert.equal((await service('prepare_email',{id:claim.id,lease_token:claim.lease_token})).skip,true,column);
      assert.equal(await scalar('select status from tlb.outbox where id=$1',[claim.id]),'skipped');
    }
  })();

  await check('manual reminder migration replays without changing existing reminder counts or API grants',async()=>{
    const before=await scalar("select count(*)::int from tlb.outbox where event_type='pickup_reminder'");
    await db.exec(await readFile(new URL('../../supabase/migrations/20260924164207_manual_pickup_reminders.sql',import.meta.url),'utf8'));
    assert.equal(await scalar("select count(*)::int from tlb.outbox where event_type='pickup_reminder'"),before);
    assert.equal(await scalar("select has_function_privilege('anon','public.shop_service(text,jsonb)','EXECUTE')"),false);
  })();
}
