import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeHarness } from './helpers.mjs';

export default async function ({ db, check, state }) {
  const h = state.harness || await makeHarness(db);
  const { api, ids } = h;
  const id = randomUUID();
  const item = { name: 'Custom cake', quantity: 2, description: 'Blue icing', selection_labels: ['Chocolate'],
    flavor_contents: [], selections: {}, unit_price_cents: 12000, private_note: 'PRIVATE' };
  const data = { buyer: { name: 'Checklist Customer', email: 'PRIVATE' }, items: [item], instructions: 'Box separately', notes: 'PRIVATE' };
  const row = async (user = ids.staff) => (await api('order_checklist', {}, user)).find(order => order.id === id);
  const mark = (content_key, prepared, user = ids.staff) => api('set_order_prepared', { order_id: id, content_key, prepared }, user);

  await db.query(`insert into tlb.orders(id,reference,access_digest,access_encrypted,fulfillment_date,method,payment_status,fulfillment_status,data,idempotency_key,request_hash)
    select $1::uuid,$2,extensions.digest(($1::uuid)::text,'sha256'),extensions.pgp_sym_encrypt('fixture',s.token_key),
    '2099-01-15','delivery','awaiting_payment','pending_confirmation',$3::jsonb,$4,'checklist-fixture' from tlb.secrets s where s.id`,
    [id, 'CHECK-'+id.slice(0,8), JSON.stringify(data), randomUUID()]);
  try {
    const first = await row();
    await check('Checklist: an active unpaid order appears immediately with only kitchen fields', async () => {
      assert.equal(first.prepared, false);
      assert.equal(first.fulfillment_date, '2099-01-15');
      assert.equal(first.method, 'delivery');
      assert.equal(first.payment_status, 'awaiting_payment');
      assert.deepEqual(first.buyer, {name: data.buyer.name});
      assert.deepEqual(first.items[0].selection_labels, ['Chocolate']);
      assert.equal(first.items[0].description, item.description);
      assert.equal(first.instructions, data.instructions);
      assert.doesNotMatch(JSON.stringify(first), /PRIVATE|price_cents|access_token|payment_reference|proof_path/);
    })();
    await check('Checklist: verified staff permission is required for reads and marks', async () => {
      await db.query("insert into tlb.staff(user_id,role) values($1,'staff')", [ids.unverified]);
      try {
        for (const user of [null, ids.customer, ids.unverified]) {
          await assert.rejects(api('order_checklist', {}, user), /staff access|verify/i);
          await assert.rejects(mark(first.content_key, true, user), /staff access|verify/i);
          await assert.rejects(api('order_checklist_period', {from:'2099-01-15',to:'2099-01-15'}, user), /staff access|verify/i);
        }
      } finally { await db.query('delete from tlb.staff where user_id=$1', [ids.unverified]); }
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(await h.scalar("select has_table_privilege($1,'tlb.order_preparation_checks','SELECT,INSERT,UPDATE,DELETE')",[role]), false);
        assert.equal(await h.scalar("select has_table_privilege($1,'tlb.order_checklist_rows','SELECT')",[role]), false);
        assert.equal(await h.scalar("select has_function_privilege($1,'tlb.order_checklist(text,jsonb)','EXECUTE')",[role]), false);
        assert.equal(await h.scalar("select has_function_privilege($1,'tlb.order_checklist_period(jsonb)','EXECUTE')",[role]), false);
      }
    })();
    await check('Printed orders: all channels and fulfillment dates omit cancelled and refunded orders', async () => {
      const read=(from,to)=>api('order_checklist_period',{from,to},ids.staff);
      await db.exec('begin');
      try {
        const eventId=randomUUID(), prefix='CHECK-PRINT-'+eventId.slice(0,8)+'-';
        await db.query("insert into tlb.pos_events(id,name,starts_on,ends_on,created_by) values($1,'Checklist test','2099-01-16','2099-01-16',$2)",[eventId,ids.owner]);
        await db.query(`insert into tlb.orders(id,reference,access_digest,access_encrypted,fulfillment_date,method,payment_status,fulfillment_status,
          refund_label,source,pos_event_id,payment_deadline,data,idempotency_key,request_hash)
          select gen_random_uuid(),$1||f.label,uuid_send(gen_random_uuid()),uuid_send(gen_random_uuid()),f.d::date,'pickup',f.payment,f.status,
            f.refund,f.source,case when f.source='popup' then $2::uuid end,
            case when f.source<>'direct_message' then clock_timestamp()+interval '1 hour' end,
            $3::jsonb||jsonb_build_object('source',f.source),gen_random_uuid(),'checklist-fixture'
          from (values
            ('old-completed','2020-01-15','website','paid','completed',false),
            ('old-cancelled','2020-01-15','website','paid','cancelled',false),
            ('old-refund','2020-01-15','direct_message','paid','completed',true),
            ('before','2099-01-14','website','paid','confirmed',false),
            ('cancelled','2099-01-15','website','cancelled','cancelled',false),
            ('cancelled-payment','2099-01-15','direct_message','cancelled','pending_confirmation',false),
            ('cancelled-paid','2099-01-15','website','paid','cancelled',false),
            ('expired','2099-01-15','website','awaiting_payment','expired',false),
            ('ready','2099-01-15','direct_message','paid','ready_for_pickup',false),
            ('completed','2099-01-16','popup','paid','completed',false),
            ('refunded','2099-01-16','website','paid','completed',true),
            ('after','2099-01-17','direct_message','under_review','pending_confirmation',false)
          ) as f(label,d,source,payment,status,refund)`,[prefix,eventId,JSON.stringify(data)]);
        const {orders}=await read('2099-01-15','2099-01-16');
        const fixtureReferences = rows => rows.filter(o=>o.reference.startsWith(prefix)).map(o=>o.reference.slice(prefix.length));
        assert.deepEqual(fixtureReferences(orders),['expired','ready','completed']);
        assert.deepEqual(fixtureReferences((await read('2020-01-15','2020-01-15')).orders),['old-completed']);
        const unpaid=orders.find(order=>order.id===id);
        assert.equal(unpaid.payment_status,'awaiting_payment');
        assert.equal(unpaid.date,'2099-01-15');
        assert.deepEqual(unpaid.buyer,{name:'Checklist Customer'});
        assert.deepEqual(unpaid.items[0].selection_labels,['Chocolate']);
        assert.equal(unpaid.items[0].description,'Blue icing');
        assert.equal(unpaid.instructions,'Box separately');
        assert.doesNotMatch(JSON.stringify(unpaid),/PRIVATE|price_cents|access_token|payment_reference|proof_path/);
        assert.ok((await read('2099-01-15','2099-01-15')).orders.every(o=>o.date==='2099-01-15'));
        assert.ok((await read('2099-01-01','2099-03-04')).orders.some(o=>o.id===id)); // 63 days

        const ready=orders.find(o=>o.reference===prefix+'ready');
        const appears = rows => rows.some(o=>o.id===ready.id);
        async function checklistMembership() {
          const range={from:'2099-01-15',to:'2099-01-16'};
          return {
            orders:appears((await api('order_checklist_period',range,ids.staff)).orders),
            handoffs:appears((await api('calendar_list',range,ids.staff)).orders),
            live:appears(await api('order_checklist',{},ids.staff)),
          };
        }
        assert.deepEqual(await checklistMembership(),{orders:true,handoffs:true,live:true});
        const refunded=await h.action('set_refund_label',{id:ready.id,revision:1},
          {enabled:true,cancel_fulfillment:true,restore_stock:false,reason:'Fixture refund'});
        assert.deepEqual(await checklistMembership(),{orders:false,handoffs:false,live:false});
        const unmarked=await h.action('set_refund_label',refunded,{enabled:false,reason:'Fixture correction'});
        assert.equal(unmarked.fulfillment_status,'cancelled');
        assert.deepEqual(await checklistMembership(),{orders:false,handoffs:false,live:false});
      } finally {await db.exec('rollback');}
      for(const [from,to] of [['2099-01-16','2099-01-15'],['2099-01-01','2099-03-05'],['invalid','2099-01-15']])
        await assert.rejects(read(from,to),/fulfillment dates/i);
    })();
    await check('Checklist: set/undo is shared, retryable, and separate from order changes and notifications', async () => {
      const snapshot = () => h.scalar("select jsonb_build_array(to_jsonb(o),(select count(*) from tlb.outbox e where e.order_id=o.id)) from tlb.orders o where id=$1",[id]);
      const before = await snapshot();
      for (const user of [ids.staff, ids.owner]) assert.deepEqual(await mark(first.content_key, true, user), {prepared: true});
      assert.equal((await row(ids.owner)).prepared, true);
      assert.deepEqual(await mark(first.content_key, false, ids.owner), {prepared: false});
      assert.equal((await row()).prepared, false);
      await assert.rejects(mark(first.content_key,'false'),/valid order/i);
      assert.deepEqual(await snapshot(), before);
    })();
    await check('Checklist: a rescheduled delivery moves to its new pickup date with its preparation mark intact', async () => {
      await mark(first.content_key, true);
      await db.query("update tlb.orders set method='pickup', fulfillment_date='2099-01-16' where id=$1", [id]);
      const rescheduled = await row();
      assert.equal(rescheduled.fulfillment_date, '2099-01-16');
      assert.equal(rescheduled.method, 'pickup');
      assert.equal(rescheduled.prepared, true);
      assert.equal(rescheduled.content_key, first.content_key);
    })();
    await check('Checklist: updated kitchen details invalidate a prior check and reject stale taps', async () => {
      await mark(first.content_key, true);
      await db.query("update tlb.orders set revision=revision+1, data=jsonb_set(data,'{buyer,email}','\"changed@example.test\"') where id=$1", [id]);
      assert.equal((await row()).prepared, true);
      await db.query("update tlb.orders set data=jsonb_set(data,'{items,0,quantity}','3') where id=$1", [id]);
      const changed = await row();
      assert.equal(changed.prepared, false);
      assert.notEqual(changed.content_key, first.content_key);
      await assert.rejects(mark(first.content_key, true), /details changed/i);
      await mark(changed.content_key, true);
      await db.query("update tlb.orders set data=jsonb_set(data,'{instructions}','\"New instructions\"') where id=$1",[id]);
      assert.equal((await row()).prepared, false);
    })();
    await check('Checklist: excludes expired website holds, keeps proof review and direct orders, retires terminal work', async () => {
      await db.query("update tlb.orders set payment_deadline=now()-interval '1 hour' where id=$1",[id]);
      assert.equal(await row(), undefined);
      await assert.rejects(mark(first.content_key,true), /no longer/i);
      assert.equal(await h.scalar("select fulfillment_status from tlb.orders where id=$1",[id]), 'pending_confirmation');
      await db.query("update tlb.orders set payment_status='under_review' where id=$1", [id]);
      assert.equal((await row()).payment_status, 'under_review');
      await db.query("update tlb.orders set source='direct_message', data=data||jsonb_build_object('source','direct_message'), payment_status='awaiting_payment', payment_deadline=null where id=$1",[id]);
      assert.equal((await row()).payment_status, 'awaiting_payment');
      await db.query("update tlb.orders set payment_status='paid', fulfillment_status='confirmed', refund_label=true where id=$1",[id]);
      assert.equal(await row(), undefined);
      await db.query("update tlb.orders set refund_label=false, fulfillment_status='completed' where id=$1",[id]);
      assert.equal(await row(), undefined);
    })();
  } finally {
    await db.query('delete from tlb.orders where id=$1', [id]);
  }
}
