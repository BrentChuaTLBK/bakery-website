import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, checkout, fixture, order, action, proof, remaining } = h;
  const migration = await readFile(new URL('../../supabase/migrations/20260914221623_payment_proof_window_15_minutes.sql', import.meta.url), 'utf8');
  const deadlineSeconds = (o) => (Date.parse(o.payment_deadline) - Date.parse(o.created_at)) / 1000;
  const expireFixture = async (id) => db.query("update tlb.orders set created_at=clock_timestamp()-interval '15 minutes', payment_deadline=clock_timestamp() where id=$1", [id]);

  await check('new orders get exactly 15 minutes; caller deadlines and retries cannot extend the window', async () => {
    const { product, date } = await fixture(2);
    const payload = checkout(product, date, { payment_deadline: '2099-01-01T00:00:00Z' });
    const first = await api('create_order', payload);
    assert.equal(deadlineSeconds(first), 900);
    const retried = await api('create_order', payload);
    assert.equal(retried.payment_deadline, first.payment_deadline);
    assert.equal(await remaining(product, date), 1);
    const expression = await h.scalar("select column_default from information_schema.columns where table_schema='tlb' and table_name='orders' and column_name='payment_deadline'");
    assert.equal(await h.scalar(`select extract(epoch from ((${expression}) - now()))::integer`), 900);
    assert.equal(await h.scalar("select has_function_privilege('anon','public.shop_api(text,jsonb,text)','execute')"), true);
    assert.equal(await h.scalar("select has_function_privilege('anon','tlb.expire_orders()','execute')"), false);
  })();

  await check('migration preserves original one-hour deadlines and all existing order, stock and email data', async () => {
    // Simulate upgrading the previous API in this isolated database only.
    const original = await readFile(new URL('../../supabase/migrations/202609130001_ordering.sql', import.meta.url), 'utf8');
    const legacyAPI = original.match(/create function public\.shop_api\([\s\S]*?\nend \$\$;/)?.[0];
    assert.ok(legacyAPI, 'Original API fixture must be present.');
    await db.exec(legacyAPI.replace('create function', 'create or replace function'));
    await db.exec("alter table tlb.orders alter column payment_deadline set default now()+interval '60 minutes'");
    const { product, date } = await fixture(3);
    const legacy = await api('create_order', checkout(product, date));
    assert.equal(deadlineSeconds(legacy), 3600);
    // More than 15 minutes old, but still within the deadline already promised.
    await db.query("update tlb.orders set created_at=clock_timestamp()-interval '20 minutes', payment_deadline=clock_timestamp()+interval '40 minutes' where id=$1", [legacy.id]);
    const snapshot = async () => (await db.query(`select
      (select jsonb_agg(to_jsonb(o) order by o.id) from tlb.orders o) as orders,
      (select jsonb_agg(to_jsonb(a) order by a.order_id,a.product_id,a.date) from tlb.allocations a) as allocations,
      (select jsonb_agg(to_jsonb(e) order by e.id) from tlb.outbox e) as emails`)).rows[0];
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
    const retained = await order(legacy.id);
    assert.equal(retained.fulfillment_status, 'pending_confirmation');
    assert.equal(await remaining(product, date), 2);
    assert.equal(deadlineSeconds(await api('create_order', checkout(product, date))), 900);
  })();

  await check('unpaid stock stays reserved before the exact deadline and catalog releases it after the deadline without cron', async () => {
    const { product, date } = await fixture(1);
    const submitted = await api('create_order', checkout(product, date));
    await db.query("update tlb.orders set created_at=clock_timestamp()-interval '14 minutes', payment_deadline=clock_timestamp()+interval '1 minute' where id=$1", [submitted.id]);
    const before = await api('catalog');
    assert.equal(before.inventory.find(i => i.product_id === product.id && i.date === date).remaining, 0);
    assert.equal((await order(submitted.id)).fulfillment_status, 'pending_confirmation');
    await expireFixture(submitted.id);
    const after = await api('catalog');
    assert.equal(after.inventory.find(i => i.product_id === product.id && i.date === date).remaining, 1);
    assert.equal((await order(submitted.id)).fulfillment_status, 'expired');
    assert.deepEqual(await h.allocations(submitted.id), []);
    await api('catalog');
    assert.equal(await h.scalar("select count(*)::integer from tlb.outbox where order_id=$1 and event_type='order_expired'", [submitted.id]), 1);
    assert.equal(await h.scalar("select count(*)::integer from tlb.history where order_id=$1 and action='expired'", [submitted.id]), 1);
  })();

  await check('a new checkout reclaims an overdue full-stock hold atomically before allocating its own stock', async () => {
    const { product, date } = await fixture(1);
    const overdue = await api('create_order', checkout(product, date));
    await expireFixture(overdue.id);
    const replacement = await api('create_order', checkout(product, date));
    assert.equal((await order(overdue.id)).fulfillment_status, 'expired');
    assert.deepEqual(await h.allocations(overdue.id), []);
    assert.equal((await h.allocations(replacement.id))[0].quantity, 1);
    assert.equal(await remaining(product, date), 0);
    await assert.rejects(api('create_order', checkout(product, date)), /stock|capacity|available|remain/i);
    assert.equal(await remaining(product, date), 0);
  })();

  await check('proof at or after the deadline is refused without creating proof or review state', async () => {
    const { product, date } = await fixture(1);
    const submitted = await api('create_order', checkout(product, date));
    await expireFixture(submitted.id);
    await assert.rejects(proof(submitted), /proof|deadline|expired|payment/i);
    const expired = await order(submitted.id);
    assert.equal(expired.fulfillment_status, 'expired');
    assert.equal(expired.proof_submitted, false);
    assert.equal(expired.payment_status, 'awaiting_payment');
    assert.equal(await remaining(product, date), 1);
  })();

  await check('timely proof and paid orders retain their stock beyond 15 minutes while waiting for manual review or fulfillment', async () => {
    const { product, date } = await fixture(2);
    const review = await proof(await api('create_order', checkout(product, date)));
    const paid = await action('approve_payment', await proof(await api('create_order', checkout(product, date))));
    await expireFixture(review.id);
    await expireFixture(paid.id);
    await h.service('maintenance');
    assert.equal((await order(review.id)).payment_status, 'under_review');
    assert.equal((await order(review.id)).fulfillment_status, 'pending_confirmation');
    assert.equal((await order(paid.id)).payment_status, 'paid');
    assert.equal((await order(paid.id)).fulfillment_status, 'confirmed');
    assert.equal((await h.allocations(review.id))[0].state, 'held');
    assert.equal((await h.allocations(paid.id))[0].state, 'committed');
    assert.equal(await remaining(product, date), 0);
  })();
}
