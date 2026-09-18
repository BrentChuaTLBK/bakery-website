import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, checkout, fixture, action, service, scalar } = h;
  const migrationDirectory = new URL('../../supabase/migrations/', import.meta.url);
  const migrationName = (await readdir(migrationDirectory)).find(name => name.endsWith('_optional_payment_reference.sql'));
  assert.ok(migrationName);
  const migration = await readFile(new URL(migrationName, migrationDirectory), 'utf8');
  const payload = (o, extra = {}) => ({
    order_id: o.id, token: o.access_token, user_id: null,
    path: `${o.id}/${randomUUID()}.png`, ...extra,
  });
  const snapshot = async id => (await db.query(`select
    (select to_jsonb(o) from tlb.orders o where id=$1) as order_data,
    (select jsonb_agg(to_jsonb(p) order by p.id) from tlb.payments p where order_id=$1) as payments,
    (select jsonb_agg(to_jsonb(a) order by a.product_id,a.date) from tlb.allocations a where order_id=$1) as allocations,
    (select jsonb_agg(to_jsonb(h) order by h.id) from tlb.history h where order_id=$1) as history,
    (select jsonb_agg(to_jsonb(e) order by e.id) from tlb.outbox e where order_id=$1) as emails`, [id])).rows[0];

  await check('omitted, null and whitespace payment references allow proof review and paid approval', async () => {
    const cases = [{}, { payment_reference: null }, { payment_reference: '' }, { payment_reference: ' \t\r\n ' }];
    const { product, date } = await fixture(cases.length);
    for (const extra of cases) {
      const submitted = await api('create_order', checkout(product, date));
      const request = payload(submitted, extra);
      const review = await service('commit_proof', request);
      assert.equal(review.payment_status, 'under_review');
      assert.equal(review.proof_submitted, true);
      assert.equal(review.payment_reference, null);
      assert.equal(await scalar('select proof_path from tlb.orders where id=$1', [submitted.id]), request.path);
      const paid = await action('approve_payment', review);
      assert.equal(paid.payment_status, 'paid');
      assert.equal(paid.fulfillment_status, 'confirmed');
      assert.equal(paid.payment_reference, null);
      const [payment] = (await db.query('select payment_reference,proof_path,amount_cents from tlb.payments where order_id=$1', [paid.id])).rows;
      assert.equal(payment.payment_reference, null);
      assert.equal(payment.proof_path, request.path);
      assert.equal(payment.amount_cents, paid.total_cents);
      assert.equal((await h.allocations(paid.id))[0].state, 'committed');
    }
    assert.equal(await h.remaining(product, date), 0);
  })();

  await check('provided references are trimmed and retained through approval including the 200-character boundary', async () => {
    const cases = [['  BANK-1234  ', 'BANK-1234'], ['\tGCASH-5678\r\n', 'GCASH-5678'], ['R'.repeat(200), 'R'.repeat(200)]];
    const { product, date } = await fixture(cases.length);
    for (const [supplied, expected] of cases) {
      const submitted = await api('create_order', checkout(product, date));
      const review = await service('commit_proof', payload(submitted, { payment_reference: supplied }));
      assert.equal(review.payment_reference, expected);
      const paid = await action('approve_payment', review);
      assert.equal(paid.payment_reference, expected);
      assert.equal(await scalar('select payment_reference from tlb.payments where order_id=$1', [paid.id]), expected);
    }
  })();

  await check('oversized and non-text payment references fail without saving proof, stock or audit changes', async () => {
    const { product, date } = await fixture();
    const submitted = await api('create_order', checkout(product, date));
    const before = await snapshot(submitted.id);
    for (const reference of ['R'.repeat(201), 1234, true, [], ['BANK-123'], {}]) {
      await assert.rejects(service('commit_proof', payload(submitted, { payment_reference: reference })), /Payment reference must be text/);
      assert.deepEqual(await snapshot(submitted.id), before);
    }
  })();

  await check('an optional reference never substitutes for the required valid private proof path', async () => {
    const { product, date } = await fixture();
    const submitted = await api('create_order', checkout(product, date));
    const before = await snapshot(submitted.id);
    for (const path of [undefined, null, '', ' ', `${randomUUID()}/${randomUUID()}.png`, `${submitted.id}/not-a-proof.pdf`]) {
      await assert.rejects(service('commit_proof', payload(submitted, { path, payment_reference: 'BANK-123' })), /Invalid private proof storage path/);
      assert.deepEqual(await snapshot(submitted.id), before);
    }
    await assert.rejects(action('approve_payment', submitted), /review|proof|payment/i);
    assert.deepEqual(await snapshot(submitted.id), before);
  })();

  await check('missing references do not bypass ownership, expiry or closed-order proof restrictions', async () => {
    const { product, date } = await fixture(3);
    const pending = await api('create_order', checkout(product, date));
    const before = await snapshot(pending.id);
    await assert.rejects(service('commit_proof', payload(pending, { token: null, user_id: ids.customer })), /not authorized/);
    assert.deepEqual(await snapshot(pending.id), before);
    const expired = await api('create_order', checkout(product, date));
    await db.query("update tlb.orders set payment_deadline=clock_timestamp()-interval '1 second' where id=$1", [expired.id]);
    const expiredBefore = await snapshot(expired.id);
    await assert.rejects(service('commit_proof', payload(expired)), /no longer accepted/);
    assert.deepEqual(await snapshot(expired.id), expiredBefore);
    const cancelled = await action('cancel_order', pending, { reason: 'Local fixture cancellation' });
    const cancelledBefore = await snapshot(cancelled.id);
    await assert.rejects(service('commit_proof', payload(pending)), /no longer accepted/);
    assert.deepEqual(await snapshot(cancelled.id), cancelledBefore);
  })();

  await check('proof duplicates are refused and optional-reference payment approval retries stay idempotent', async () => {
    const { product, date } = await fixture();
    const submitted = await api('create_order', checkout(product, date));
    const request = payload(submitted);
    const review = await service('commit_proof', request);
    const reviewBefore = await snapshot(review.id);
    await assert.rejects(service('commit_proof', request), /no longer accepted/);
    assert.deepEqual(await snapshot(review.id), reviewBefore);
    const approve = { order_id: review.id, revision: review.revision, idempotency_key: randomUUID() };
    const paid = await api('approve_payment', approve, ids.owner);
    const paidBefore = await snapshot(paid.id);
    const retry = await api('approve_payment', approve, ids.owner);
    assert.equal(retry.revision, paid.revision);
    assert.deepEqual(await snapshot(paid.id), paidBefore);
    assert.equal(await scalar('select count(*)::int from tlb.payments where order_id=$1', [paid.id]), 1);
  })();

  await check('optional-reference migration replay preserves existing payment data, required proof and private privileges', async () => {
    const { product, date } = await fixture();
    const submitted = await api('create_order', checkout(product, date));
    const paid = await action('approve_payment', await service('commit_proof', payload(submitted, { payment_reference: 'KEEP-THIS-REFERENCE' })));
    const before = await snapshot(paid.id);
    const definition = await scalar("select pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure)");
    const acl = await scalar("select proacl::text from pg_proc where oid='public.shop_service(text,jsonb)'::regprocedure");
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await snapshot(paid.id), before);
    assert.equal(await scalar("select pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure)"), definition);
    assert.equal(await scalar("select proacl::text from pg_proc where oid='public.shop_service(text,jsonb)'::regprocedure"), acl);
    assert.equal(await scalar("select is_nullable from information_schema.columns where table_schema='tlb' and table_name='payments' and column_name='payment_reference'"), 'YES');
    assert.equal(await scalar("select is_nullable from information_schema.columns where table_schema='tlb' and table_name='payments' and column_name='proof_path'"), 'NO');
    assert.equal(await scalar("select has_function_privilege('service_role','public.shop_service(text,jsonb)','execute')"), true);
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await scalar("select has_function_privilege($1,'public.shop_service(text,jsonb)','execute')", [role]), false);
      assert.equal(await scalar("select has_function_privilege($1,'tlb.normalize_payment_reference(jsonb)','execute')", [role]), false);
    }
  })();

  await check('optional-reference patch accepts CRLF source while preserving later service code and grants', async () => {
    const original = await readFile(new URL('../../supabase/migrations/202609130001_ordering.sql', import.meta.url), 'utf8');
    const legacyService = original.match(/create function public\.shop_service\([\s\S]*?\nend \$\$;/)?.[0];
    assert.ok(legacyService);
    const current = await scalar("select pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure)");
    const acl = await scalar("select proacl::text from pg_proc where oid='public.shop_service(text,jsonb)'::regprocedure");
    try {
      const sentinel = '-- Later unrelated service update retained.';
      await db.exec(legacyService.replace('create function', 'create or replace function').replace('begin\n', `begin\n ${sentinel}\n`).replaceAll('\n', '\r\n'));
      await db.exec(migration);
      const migrated = await scalar("select pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure)");
      assert.ok(migrated.includes(sentinel));
      assert.ok(migrated.includes("payment_reference=tlb.normalize_payment_reference(p_payload->'payment_reference')"));
      assert.equal(await scalar("select proacl::text from pg_proc where oid='public.shop_service(text,jsonb)'::regprocedure"), acl);
    } finally { await db.exec(current); }
  })();
}
