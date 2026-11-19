import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, fixture, checkout, proof, action, scalar, order } = h;
  const migration = await readFile(new URL('../../supabase/migrations/20260918202752_close_cancelled_payment_reviews.sql', import.meta.url), 'utf8');
  const create = async () => {
    const { product, date } = await fixture(3);
    return { product, date, submitted: await api('create_order', checkout(product, date), ids.customer) };
  };

  await check('cancelling a review closes payment, retains proof, releases stock, and retries once', async () => {
    const { product, date, submitted } = await create();
    await proof(submitted);
    const review = await order(submitted.id);
    const payload = { order_id: review.id, revision: review.revision, reason: 'Customer requested cancellation', idempotency_key: randomUUID() };
    await assert.rejects(api('cancel_order', payload, ids.customer), /staff|owner|authorized|access/i);
    const cancelled = await api('cancel_order', payload, ids.staff);
    assert.equal(cancelled.payment_status, 'cancelled');
    assert.equal(cancelled.fulfillment_status, 'cancelled');
    assert.equal(cancelled.proof_path, review.proof_path);
    assert.equal(cancelled.payment_reference, review.payment_reference);
    assert.equal(cancelled.paid_amount_cents, null);
    assert.equal(cancelled.revision, review.revision + 1);
    assert.equal(await h.remaining(product, date), 3);
    assert.equal((await api('cancel_order', payload, ids.staff)).revision, cancelled.revision);
    assert.equal(await scalar("select count(*)::int from tlb.history where order_id=$1 and action='cancel_order'", [review.id]), 1);
    assert.equal(await scalar("select count(*)::int from tlb.outbox where order_id=$1 and event_type='order_cancelled'", [review.id]), 1);
    assert.equal(await scalar("select payload#>>'{order,payment_status}' from tlb.outbox where order_id=$1 and event_type='order_cancelled'", [review.id]), 'cancelled');
    assert.equal((await api('get_order', { order_id: review.id }, ids.customer)).payment_status, 'cancelled');
    assert.equal((await api('my_orders', {}, ids.customer)).find(o => o.id === review.id).payment_status, 'cancelled');
    await assert.rejects(action('approve_payment', cancelled), /active|review/i);
    await assert.rejects(action('reject_payment', cancelled, { reason: 'Cannot reject a closed review' }), /active|review/i);
    await assert.rejects(proof(submitted), /proof|payment|accepted/i);
  })();

  await check('cancellation closes awaiting payments and refund-label changes cannot reopen a review', async () => {
    for (const withProof of [false, true]) {
      const { submitted } = await create();
      const pending = withProof ? await proof(submitted) : submitted;
      const cancelled = await action('cancel_order', pending, { reason: 'Cancel pending payment' });
      assert.equal(cancelled.payment_status, 'cancelled');
      const labelled = await action('set_refund_label', cancelled, { enabled: true, reason: 'Manual refund record' });
      assert.equal(labelled.payment_status, 'cancelled');
      assert.equal(labelled.fulfillment_status, 'cancelled');
      const restored = await action('set_refund_label', labelled, { enabled: false, reason: 'Remove label' });
      assert.equal(restored.payment_status, 'cancelled');
      assert.equal(restored.paid_amount_cents, null);
    }
  })();

  const cancellations = id => scalar("select count(*)::int from tlb.outbox where order_id=$1 and event_type='order_cancelled'", [id]);
  const refundPayload = o => ({
    order_id: o.id, revision: o.revision, idempotency_key: randomUUID(), reason: 'Customer cancelled before pickup',
    enabled: true, cancel_fulfillment: true,
  });

  await check('recording a refund cancels unpaid fulfillment and review, and retries keep one audit, revision and cancellation notice', async () => {
    for (const withProof of [false, true]) {
      const { product, date, submitted } = await create();
      const pending = withProof ? await proof(submitted) : submitted;
      await db.query("select tlb.audit($1,$2,'edit_order','Earlier unrelated reason')", [pending.id, ids.staff]);
      const payload = refundPayload(pending);
      for (const user of [null, ids.customer]) await assert.rejects(api('set_refund_label', payload, user), /access/i);
      for (const ack of [undefined, false, 'true']) {
        await assert.rejects(api('set_refund_label', { ...payload, cancel_fulfillment: ack }, ids.staff), /refresh.*cancel/i);
      }
      await assert.rejects(api('set_refund_label', { ...payload, reason: '' }, ids.staff), /reason/i);
      await assert.rejects(api('set_refund_label', { ...payload, revision: 0 }, ids.staff), /changed/i);
      const result = await api('set_refund_label', payload, ids.staff);
      assert.equal(result.fulfillment_status, 'cancelled');
      assert.equal(result.payment_status, 'cancelled');
      assert.equal(result.proof_submitted, withProof);
      assert.equal(result.refund_label, true);
      assert.equal(result.revision, pending.revision + 1);
      assert.equal(await h.remaining(product, date), 3);
      assert.equal((await api('set_refund_label', payload, ids.staff)).revision, result.revision);
      await assert.rejects(api('set_refund_label', { ...payload, enabled: false }, ids.staff), /different request/i);
      assert.equal(result.history.filter(entry => entry.action === 'set_refund_label').length, 1);
      const history = await scalar("select payload#>'{order,history}' from tlb.outbox where order_id=$1 and event_type='order_cancelled'", [pending.id]);
      assert.equal(history.at(-1).reason, payload.reason);
      assert.equal(history.at(-1).action, 'set_refund_label');
      const cleared = await action('set_refund_label', result, { enabled: false });
      assert.equal(cleared.payment_status, 'cancelled');
      assert.equal(cleared.fulfillment_status, 'cancelled');
      assert.equal(cleared.refund_label, false);
      assert.equal(await cancellations(pending.id), 1);
      await assert.rejects(action('approve_payment', cleared), /active|review/i);
    }
  })();

  await check('paid and completed refunds preserve payment and honor the explicit inventory decision exactly once', async () => {
    for (const completed of [false, true]) {
      for (const restore of [false, true]) {
        const { product, date, submitted } = await create();
        const paid = await action('approve_payment', await proof(submitted));
        const current = completed ? await action('set_fulfillment', paid, { status: 'completed' }) : paid;
        const payload = refundPayload(current);
        for (const invalid of [undefined, 'false', null]) {
          await assert.rejects(api('set_refund_label', { ...payload, restore_stock: invalid }, ids.staff), /sellable stock/i);
        }
        const beforePayments = (await db.query('select * from tlb.payments where order_id=$1', [paid.id])).rows;
        const refunded = await api('set_refund_label', { ...payload, restore_stock: restore }, ids.staff);
        assert.equal(refunded.payment_status, 'paid');
        assert.equal(refunded.fulfillment_status, 'cancelled');
        assert.equal(refunded.paid_amount_cents, paid.paid_amount_cents);
        assert.deepEqual((await db.query('select * from tlb.payments where order_id=$1', [paid.id])).rows, beforePayments);
        assert.deepEqual((await h.allocations(paid.id)).map(row => row.state), restore ? [] : ['retained']);
        const cleared = await action('set_refund_label', refunded, { enabled: false });
        await assert.rejects(action('reopen_order', cleared, { reason: 'Attempt to reopen' }), /completed order/i);
        await h.refund(cleared, { restore_stock: !restore });
        assert.equal(await h.remaining(product, date), restore ? 3 : 2);
        assert.equal(await cancellations(paid.id), completed ? 0 : 1);
      }
    }
  })();

  await check('expired refunds close pending payment without sending a second closure notice; migration replay preserves historic labels', async () => {
    const { product, date, submitted } = await create();
    await db.query("update tlb.orders set payment_deadline=now()-interval '1 hour' where id=$1", [submitted.id]);
    await db.query('select tlb.expire_orders()');
    const expired = await order(submitted.id);
    assert.equal(expired.fulfillment_status, 'expired');
    const refunded = await h.refund(expired);
    assert.equal(refunded.fulfillment_status, 'cancelled');
    assert.equal(refunded.payment_status, 'cancelled');
    assert.equal(await h.remaining(product, date), 3);
    assert.equal(await cancellations(submitted.id), 0);
    const legacy = (await create()).submitted;
    await db.query('update tlb.orders set refund_label=true where id=$1', [legacy.id]);
    const before = await order(legacy.id);
    const refundMigration = await readFile(new URL('../../supabase/migrations/20261119210934_cancel_fulfillment_on_refund.sql', import.meta.url), 'utf8');
    await db.exec(refundMigration);
    assert.deepEqual(await order(legacy.id), before);
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal(await scalar("select has_function_privilege($1,'tlb.cancel_fulfillment_on_refund(tlb.orders,uuid,jsonb)','execute')", [role]), false);
    }
  })();

  await check('repair closes legacy cancellations once, preserving paid/rejected orders and all financial records', async () => {
    const legacy = [];
    for (const withProof of [false, true]) {
      const { submitted } = await create();
      const pending = withProof ? await proof(submitted) : submitted;
      const cancelled = await action('cancel_order', pending, { reason: 'Legacy fixture' });
      await db.query('update tlb.orders set payment_status=$2,refund_label=$3 where id=$1', [cancelled.id, pending.payment_status, withProof]);
      legacy.push(await order(cancelled.id));
    }
    const paid = await action('approve_payment', await proof((await create()).submitted));
    const paidCancelled = await action('cancel_order', paid, { reason: 'Paid fixture', restore_stock: false });
    const rejected = await action('reject_payment', await proof((await create()).submitted), { reason: 'Invalid proof fixture' });
    const activeResult = await proof((await create()).submitted);
    const active = await order(activeResult.id);
    const snapshots = async () => ({
      payments: (await db.query('select * from tlb.payments order by id')).rows,
      allocations: (await db.query('select * from tlb.allocations order by order_id,product_id,date')).rows,
      promos: (await db.query('select * from tlb.promo_usage order by order_id')).rows,
      outbox: (await db.query('select * from tlb.outbox order by id')).rows,
    });
    const unchanged = await snapshots();
    const definition = await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)");
    await db.exec(migration.replace(/\r\n/g, '\n'));
    for (const before of legacy) {
      const after = await order(before.id);
      assert.deepEqual({ ...after, payment_status: before.payment_status, revision: before.revision, history: before.history }, before);
      assert.equal(after.payment_status, 'cancelled');
      assert.equal(after.revision, before.revision + 1);
      const audit = after.history.at(-1);
      assert.equal(audit.action, 'payment_review_closed');
      assert.equal(audit.before.payment_status, before.payment_status);
      assert.equal(audit.after.payment_status, 'cancelled');
    }
    assert.deepEqual(await order(paidCancelled.id), paidCancelled);
    assert.deepEqual(await order(rejected.id), rejected);
    assert.deepEqual(await order(active.id), active);
    assert.deepEqual(await snapshots(), unchanged);
    const afterFirst = await Promise.all(legacy.map(o => order(o.id)));
    await db.exec(migration.replace(/\r?\n/g, '\r\n'));
    assert.deepEqual(await Promise.all(legacy.map(o => order(o.id))), afterFirst);
    assert.equal(await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)"), definition);
    assert.equal(await scalar("select count(*)::int from tlb.orders where fulfillment_status='cancelled' and payment_status in ('awaiting_payment','under_review')"), 0);
  })();
}
