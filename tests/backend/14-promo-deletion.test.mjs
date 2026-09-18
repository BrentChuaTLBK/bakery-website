import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, fixture, checkout, action, proof, scalar } = h;
  const makePromo = (extra = {}) => api('save_promo', { promo: {
    code: `DEL${randomUUID().slice(0, 8)}`, kind: 'percent', value: 10,
    min_subtotal_cents: 0, cap_cents: null, per_account_limit: 10, global_limit: 100,
    expires_at: new Date(Date.now() + 86400000).toISOString(), active: true, ...extra,
  } }, ids.owner);
  const promoData = id => scalar('select data from tlb.promos where id=$1', [id]);
  const orderSnapshot = async id => (await db.query(`select
    (select to_jsonb(o) from tlb.orders o where id=$1) as order_data,
    (select to_jsonb(u) from tlb.promo_usage u where order_id=$1) as usage_data,
    (select jsonb_agg(to_jsonb(a)) from tlb.allocations a where order_id=$1) as allocations,
    (select jsonb_agg(to_jsonb(e) order by e.id) from tlb.outbox e where order_id=$1) as emails`, [id])).rows[0];
  const remove = id => api('delete_promo', { id }, ids.owner);

  await check('promo deletion is owner-only, idempotent, hidden from the list and blocked for new quotes', async () => {
    const promo = await makePromo();
    const { product, date } = await fixture();
    const before = await promoData(promo.id);
    for (const user of [null, ids.customer, ids.staff]) {
      await assert.rejects(api('delete_promo', { id: promo.id }, user), /owner|staff|access|authorized/i);
      assert.deepEqual(await promoData(promo.id), before);
    }
    await assert.rejects(remove(randomUUID()), /not found/i);
    await assert.rejects(api('delete_promo', {}, ids.owner), /not found/i);
    assert.deepEqual(await remove(promo.id), { id: promo.id, deleted: true });
    const deleted = await promoData(promo.id);
    assert.equal(deleted.active, false);
    assert.equal(deleted.deleted_by, ids.owner);
    assert.ok(deleted.deleted_at);
    await remove(promo.id);
    assert.deepEqual(await promoData(promo.id), deleted);
    const list = (await api('admin_bootstrap', {}, ids.owner)).promos;
    assert.equal(list.some(p => p.id === promo.id), false);
    const request = checkout(product, date, { promo_code: promo.code });
    await assert.rejects(api('quote', request, ids.customer), /inactive|deleted/i);
    await assert.rejects(api('create_order', request, ids.customer), /inactive|deleted/i);
    assert.equal(await h.remaining(product, date), 10);
    assert.equal(await scalar('select count(*)::int from tlb.promos where id=$1', [promo.id]), 1);
  })();

  await check('deleting a promo preserves paid and reserved orders, receipts, discounts and usage history', async () => {
    const promo = await makePromo();
    const { product, date } = await fixture();
    const submit = () => api('create_order', checkout(product, date, { promo_code: promo.code }), ids.customer);
    const pending = await submit();
    const paid = await action('approve_payment', await proof(await submit()));
    const beforePending = await orderSnapshot(pending.id);
    const beforePaid = await orderSnapshot(paid.id);
    const payment = await scalar('select to_jsonb(p) from tlb.payments p where order_id=$1', [paid.id]);
    await remove(promo.id);
    assert.deepEqual(await orderSnapshot(pending.id), beforePending);
    assert.deepEqual(await orderSnapshot(paid.id), beforePaid);
    assert.deepEqual(await scalar('select to_jsonb(p) from tlb.payments p where order_id=$1', [paid.id]), payment);
    const approvedLater = await action('approve_payment', await proof(pending));
    assert.equal(approvedLater.discount_cents, pending.discount_cents);
    assert.equal(approvedLater.promo_snapshot.id, promo.id);
    assert.equal(await scalar("select count(*)::int from tlb.promo_usage where promo_id=$1 and state='redeemed'", [promo.id]), 2);
    const edited = await action('edit_order', paid, { reason: 'Local history preservation check', changes: { instructions: 'Preserve historic promotion' } });
    assert.equal(edited.discount_cents, paid.discount_cents);
    assert.equal(edited.promo_snapshot.id, promo.id);
  })();

  await check('deleted code identity cannot be reused or reactivated, and deletion metadata cannot be forged through save', async () => {
    const promo = await makePromo();
    await remove(promo.id);
    const before = await promoData(promo.id);
    await assert.rejects(api('save_promo', { promo: { ...promo, active: true } }, ids.owner), /deleted.*reactivated/i);
    await assert.rejects(makePromo({ code: promo.code.toLowerCase() }), /deleted.*reused/i);
    const another = await makePromo();
    await assert.rejects(api('save_promo', { promo: { ...another, code: promo.code } }, ids.owner), /deleted.*reused/i);
    assert.deepEqual(await promoData(promo.id), before);
    const forged = await makePromo({ deleted_at: new Date().toISOString(), deleted_by: ids.customer });
    assert.equal(Object.hasOwn(forged, 'deleted_at'), false);
    assert.equal(Object.hasOwn(forged, 'deleted_by'), false);
    const list = (await api('admin_bootstrap', {}, ids.owner)).promos;
    assert.ok(list.some(p => p.id === another.id));
    assert.ok(list.some(p => p.id === forged.id));
    assert.equal(list.some(p => p.id === promo.id), false);
  })();

  await check('promo deletion migration replays without deleting records or changing API privileges', async () => {
    const directory = new URL('../../supabase/migrations/', import.meta.url);
    const name = (await readdir(directory)).find(file => file.endsWith('_soft_delete_promos.sql'));
    assert.ok(name);
    const migration = await readFile(new URL(name, directory), 'utf8');
    const snapshot = () => scalar("select jsonb_agg(to_jsonb(p) order by id) from tlb.promos p");
    const before = await snapshot();
    const definition = await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)");
    const acl = await scalar("select proacl::text from pg_proc where oid='public.shop_api(text,jsonb,text)'::regprocedure");
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)"), definition);
    assert.equal(await scalar("select proacl::text from pg_proc where oid='public.shop_api(text,jsonb,text)'::regprocedure"), acl);
    assert.deepEqual((await api('admin_bootstrap', {}, ids.staff)).promos, []);
  })();
}
