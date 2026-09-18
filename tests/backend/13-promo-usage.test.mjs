import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, fixture, checkout, item, action, proof, scalar } = h;
  const makePromo = (overrides = {}) => api('save_promo', { promo: {
    code: `USE${randomUUID().slice(0, 8)}`, kind: 'percent', value: 10,
    min_subtotal_cents: 0, cap_cents: null, per_account_limit: 50, global_limit: 100,
    expires_at: new Date(Date.now() + 86400000).toISOString(), active: true, ...overrides,
  } }, ids.owner);
  const submit = (product, date, promo, changes = {}) => api('create_order',
    checkout(product, date, { promo_code: promo.code, ...changes }), ids.customer);
  const assertCounts = async (promo, redeemed, reserved) => {
    const dashboard = await api('admin_bootstrap', {}, ids.owner);
    const reported = dashboard.promos.find(p => p.id === promo.id);
    assert.ok(reported, `Promo ${promo.id} is returned to its owner`);
    assert.deepEqual({ usage: reported.usage_count, redeemed: reported.redeemed_count, reserved: reported.reserved_count },
      { usage: redeemed + reserved, redeemed, reserved });
    const actual = (await db.query(`select count(*)::int as usage,
      count(*) filter (where state='redeemed')::int as redeemed,
      count(*) filter (where state='reserved')::int as reserved
      from tlb.promo_usage where promo_id=$1`, [promo.id])).rows[0];
    assert.deepEqual(actual, { usage: redeemed + reserved, redeemed, reserved });
    return reported;
  };

  await check('owner promo counts start at zero, quote consumes nothing, and approval moves one reservation to redeemed', async () => {
    const promo = await makePromo();
    const { product, date } = await fixture();
    await assertCounts(promo, 0, 0);
    await api('quote', checkout(product, date, { promo_code: promo.code }), ids.customer);
    await assertCounts(promo, 0, 0);
    const submitted = await submit(product, date, promo);
    await assertCounts(promo, 0, 1);
    const review = await proof(submitted);
    await assertCounts(promo, 0, 1);
    await action('approve_payment', review);
    await assertCounts(promo, 1, 0);
    // Repeated dashboard reads neither consume nor duplicate a use.
    await assertCounts(promo, 1, 0);

    const zeroCap = await makePromo({ cap_cents: 0 });
    const zeroDiscount = await submit(product, date, zeroCap);
    assert.equal(zeroDiscount.discount_cents, 0);
    await assertCounts(zeroCap, 0, 1);
  })();

  await check('promo counts release cancelled, rejected and expired unpaid uses but retain timely proof under review', async () => {
    const promo = await makePromo();
    const { product, date } = await fixture();
    const cancelled = await submit(product, date, promo);
    const rejected = await submit(product, date, promo);
    const expired = await submit(product, date, promo);
    const retained = await submit(product, date, promo);
    await assertCounts(promo, 0, 4);
    await action('cancel_order', cancelled, { reason: 'Local unused reservation' });
    await assertCounts(promo, 0, 3);
    await action('reject_payment', await proof(rejected), { reason: 'Local rejected proof' });
    await assertCounts(promo, 0, 2);
    await proof(retained);
    await db.query("update tlb.orders set payment_deadline=clock_timestamp()-interval '1 second' where id=any($1::uuid[])", [[expired.id, retained.id]]);
    // admin_bootstrap runs expiry before returning the count, without needing cron.
    await assertCounts(promo, 0, 1);
    assert.equal((await h.order(expired.id)).fulfillment_status, 'expired');
    assert.equal((await h.order(retained.id)).payment_status, 'under_review');
  })();

  await check('paid cancellation and refund retain usage and code renaming keeps counts attached to the promo UUID', async () => {
    const promo = await makePromo();
    const { product, date } = await fixture();
    const first = await submit(product, date, promo);
    const second = await submit(product, date, promo);
    const paid = await action('approve_payment', await proof(first));
    const otherPaid = await action('approve_payment', await proof(second));
    await assertCounts(promo, 2, 0);
    const cancelled = await action('cancel_order', paid, { reason: 'Local paid cancellation', restore_stock: true });
    await action('set_refund_label', cancelled, { enabled: true });
    await action('set_refund_label', otherPaid, { enabled: true });
    await assertCounts(promo, 2, 0);

    const renamed = await api('save_promo', { promo: { ...promo, code: `REN${randomUUID().slice(0, 8)}` } }, ids.owner);
    assert.equal(renamed.id, promo.id);
    const reported = await assertCounts(renamed, 2, 0);
    assert.equal(reported.code, renamed.code);
    assert.equal((await h.order(first.id)).promo_snapshot.code, promo.code);
    const reusedCode = await makePromo({ code: promo.code });
    assert.notEqual(reusedCode.id, promo.id);
    await assertCounts(reusedCode, 0, 0);
    await assertCounts(renamed, 2, 0);
  })();

  await check('usage reports follow the ledger when order edits change minimum-spend eligibility before or after payment', async () => {
    const promo = await makePromo({ kind: 'fixed', value: 1000, min_subtotal_cents: 20000 });
    const { product, date } = await fixture(20);
    const withTwo = { items: [item(product, 2)] };
    const first = await submit(product, date, promo, withTwo);
    const second = await submit(product, date, promo, withTwo);
    await assertCounts(promo, 0, 2);

    const firstPaid = await action('approve_payment', await proof(first));
    const paidBelow = await action('edit_order', firstPaid, {
      reason: 'Below minimum after payment', changes: { items: [item(product)] },
    });
    assert.equal(paidBelow.discount_cents, 0);
    await assertCounts(promo, 1, 1);

    const unpaidBelow = await action('edit_order', second, {
      reason: 'Below minimum before payment', changes: { items: [item(product)] },
    });
    await assertCounts(promo, 1, 0);
    const paidWithoutUse = await action('approve_payment', await proof({ ...unpaidBelow, access_token: second.access_token }));
    assert.equal(paidWithoutUse.payment_status, 'paid');
    assert.equal(paidWithoutUse.promo_snapshot.id, promo.id);
    assert.equal(paidWithoutUse.discount_cents, 0);
    await assertCounts(promo, 1, 0);
    await action('edit_order', paidWithoutUse, {
      reason: 'Requalify after payment', changes: { items: [item(product, 2)] },
    });
    await assertCounts(promo, 2, 0);
  })();

  await check('promo usage counts remain owner-only and the migration replays without changing ledger or API privileges', async () => {
    const promo = await makePromo();
    const { product, date } = await fixture();
    await submit(product, date, promo);
    await assertCounts(promo, 0, 1);
    assert.deepEqual((await api('admin_bootstrap', {}, ids.staff)).promos, []);
    for (const user of [null, ids.customer, ids.unverified]) {
      await assert.rejects(api('admin_bootstrap', {}, user), /authorized|staff|access/i);
      await assert.rejects(h.as(user, () => db.query('select * from tlb.promo_usage')), /permission denied/i);
    }
    const publicCatalog = await api('catalog');
    assert.equal(Object.hasOwn(publicCatalog, 'promos'), false);
    assert.equal(Object.hasOwn(publicCatalog, 'promo_usage'), false);

    const directory = new URL('../../supabase/migrations/', import.meta.url);
    const name = (await readdir(directory)).find(file => file.endsWith('_admin_promo_usage.sql'));
    assert.ok(name, 'Admin promo usage migration exists');
    const migration = await readFile(new URL(name, directory), 'utf8');
    const ledger = () => db.query('select order_id::text,promo_id::text,user_id::text,state from tlb.promo_usage order by order_id').then(result => result.rows);
    const before = await ledger();
    const definition = await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)");
    const acl = await scalar("select proacl::text from pg_proc where oid='public.shop_api(text,jsonb,text)'::regprocedure");
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await ledger(), before);
    assert.equal(await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)"), definition);
    assert.equal(await scalar("select proacl::text from pg_proc where oid='public.shop_api(text,jsonb,text)'::regprocedure"), acl);
    await assertCounts(promo, 0, 1);
    assert.deepEqual((await api('admin_bootstrap', {}, ids.staff)).promos, []);
    await assert.rejects(api('admin_bootstrap', {}, ids.customer), /authorized|staff|access/i);
  })();
}
