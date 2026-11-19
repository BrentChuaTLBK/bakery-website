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
        }
      } finally { await db.query('delete from tlb.staff where user_id=$1', [ids.unverified]); }
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(await h.scalar("select has_table_privilege($1,'tlb.order_preparation_checks','SELECT,INSERT,UPDATE,DELETE')",[role]), false);
        assert.equal(await h.scalar("select has_table_privilege($1,'tlb.order_checklist_rows','SELECT')",[role]), false);
        assert.equal(await h.scalar("select has_function_privilege($1,'tlb.order_checklist(text,jsonb)','EXECUTE')",[role]), false);
      }
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
