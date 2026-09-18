import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, checkout, fixture, action, order, proof, remaining } = h;
  const platformError = /Choose Facebook, Instagram, or N\/A/;
  const usernameError = /Enter your social username or profile name, or N\/A/;
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const names = await readdir(directory);
  const readMigration = async suffix => {
    const name = names.find(name => name.endsWith(suffix));
    assert.ok(name, suffix);
    return readFile(new URL(name, directory), 'utf8');
  };
  const compatibilitySql = await readMigration('_require_social_contact.sql');
  const enforcementSql = await readMigration('_enforce_social_contact_checkout.sql');
  const counts = async () => (await db.query(`select
    (select count(*)::int from tlb.orders) as orders,
    (select count(*)::int from tlb.allocations) as allocations,
    (select count(*)::int from tlb.outbox) as emails,
    (select count(*)::int from tlb.history) as audit`)).rows[0];

  await check('new social contacts accept Facebook, Instagram and explicit N/A without rewriting their values', async () => {
    const contacts = [
      { social_platform: 'facebook', social_username: 'QA Customer' },
      { social_platform: 'instagram', social_username: '@qa_customer' },
      { social_platform: 'facebook', social_username: 'https://www.facebook.com/qa.customer' },
      { social_platform: 'na', social_username: 'N/A' },
      { social_platform: 'facebook', social_username: 'N/A' },
      { social_platform: 'instagram', social_username: 'n/a' },
      { social_platform: 'Facebook', social_username: 'QA legacy casing' },
      { social_platform: 'Instagram', social_username: 'a'.repeat(100) },
      { social_platform: ' na ', social_username: ' n/A ' },
    ];
    const { product, date } = await fixture(contacts.length);
    for (const contact of contacts) {
      const payload = checkout(product, date);
      Object.assign(payload.buyer, contact);
      const saved = await api('create_order', payload);
      assert.equal(saved.buyer.social_platform, contact.social_platform);
      assert.equal(saved.buyer.social_username, contact.social_username);
    }
    assert.equal(await remaining(product, date), 0);
  })();

  await check('direct checkout RPC rejects missing or invalid social contact without orders, stock holds or emails', async () => {
    const { product, date } = await fixture(3);
    const cases = [
      [{}, platformError],
      [{ social_platform: '', social_username: '' }, platformError],
      [{ social_platform: ' \t\r\n ', social_username: ' \t ' }, platformError],
      [{ social_platform: null, social_username: 'qa' }, platformError],
      [{ social_platform: 'tiktok', social_username: 'qa' }, platformError],
      [{ social_platform: 'N/A', social_username: 'N/A' }, platformError],
      [{ social_platform: ['facebook'], social_username: 'qa' }, platformError],
      [{ social_platform: 'facebook' }, usernameError],
      [{ social_platform: 'instagram', social_username: null }, usernameError],
      [{ social_platform: 'instagram', social_username: ' \t\n ' }, usernameError],
      [{ social_platform: 'facebook', social_username: 'a'.repeat(101) }, /100 characters or fewer/],
      [{ social_platform: 'facebook', social_username: 12345 }, usernameError],
      [{ social_platform: 'facebook', social_username: ['qa'] }, usernameError],
      [{ social_platform: 'na', social_username: '' }, usernameError],
      [{ social_platform: 'na', social_username: 'actually_some_username' }, /Use N\/A when no social platform/],
    ];
    const before = await counts();
    for (const [contact, error] of cases) {
      const payload = checkout(product, date);
      delete payload.buyer.social_platform;
      delete payload.buyer.social_username;
      Object.assign(payload.buyer, contact);
      for (const user of [null, ids.customer]) {
        await assert.rejects(api('create_order', { ...payload, idempotency_key: randomUUID() }, user), error);
      }
    }
    assert.deepEqual(await counts(), before);
    assert.equal(await remaining(product, date), 3);
  })();

  await check('quotes and catalog stay usable while customer social contact is incomplete', async () => {
    const { product, date } = await fixture(3);
    const payload = checkout(product, date, { buyer: {}, recipient: {} });
    const before = await counts();
    assert.equal((await api('quote', payload)).total_cents, product.price_cents);
    assert.ok((await api('catalog')).products.some(p => p.id === product.id));
    assert.deepEqual(await counts(), before);
    assert.equal(await remaining(product, date), 3);
  })();

  await check('legacy paid orders without social fields remain editable without adding a new contact', async () => {
    const { product, date } = await fixture(3);
    const submitted = await api('create_order', checkout(product, date));
    const paid = await action('approve_payment', await proof(submitted));
    await db.query(`update tlb.orders set data=jsonb_set(data,'{buyer}',(data->'buyer')-'social_platform'-'social_username') where id=$1`, [paid.id]);
    const legacy = await order(paid.id);
    const allocations = await h.allocations(paid.id);
    const corrected = await action('edit_order', legacy, {
      reason: 'Correct legacy contact', changes: { buyer: { name: 'QA Corrected Name' } },
    });
    assert.equal(corrected.buyer.name, 'QA Corrected Name');
    assert.equal(corrected.buyer.social_platform, undefined);
    assert.equal(corrected.buyer.social_username, undefined);
    assert.equal(corrected.payment_status, 'paid');
    assert.equal(corrected.paid_amount_cents, paid.paid_amount_cents);
    assert.equal(corrected.total_cents, paid.total_cents);
    assert.deepEqual(await h.allocations(paid.id), allocations);
  })();

  await check('admin contact edits retain explicit N/A and reject inconsistent social corrections atomically', async () => {
    const { product, date } = await fixture(3);
    const payload = checkout(product, date);
    Object.assign(payload.buyer, { social_platform: 'na', social_username: 'N/A' });
    const submitted = await api('create_order', payload);
    const edited = await action('edit_order', submitted, {
      reason: 'Correct phone only', changes: { buyer: { phone: '09179999999' } },
    });
    assert.equal(edited.buyer.social_platform, 'na');
    assert.equal(edited.buyer.social_username, 'N/A');
    const before = await counts();
    await assert.rejects(action('edit_order', edited, {
      reason: 'Invalid social correction', changes: { buyer: { social_username: 'qa_username' } },
    }), /Use N\/A when no social platform/);
    assert.deepEqual(await order(edited.id), edited);
    assert.deepEqual(await counts(), before);
  })();

  await check('submission retries preserve the original order and explicit social contact exactly once', async () => {
    const { product, date } = await fixture(3);
    const payload = checkout(product, date);
    Object.assign(payload.buyer, { social_platform: 'na', social_username: 'N/A' });
    const original = await api('create_order', payload);
    const before = await counts();
    const retry = await api('create_order', payload);
    assert.equal(retry.id, original.id);
    assert.equal(retry.access_token, original.access_token);
    assert.deepEqual(retry.buyer, original.buyer);
    assert.deepEqual(await counts(), before);
    assert.equal(await remaining(product, date), 2);
  })();

  await check('older successful submissions may replay without newly required social fields', async () => {
    const { product, date } = await fixture(3);
    const payload = checkout(product, date);
    const saved = await api('create_order', payload);
    delete payload.buyer.social_platform;
    delete payload.buyer.social_username;
    // Simulate a pre-migration submission and its exact original request hash.
    await db.query(`update tlb.orders set data=jsonb_set(data,'{buyer}',$2::jsonb->'buyer'),
      request_hash=encode(extensions.digest(($2::jsonb-'idempotency_key')::text||'guest','sha256'),'hex') where id=$1`, [saved.id, JSON.stringify(payload)]);
    const before = await counts();
    const retry = await api('create_order', payload);
    assert.equal(retry.id, saved.id);
    assert.equal(retry.buyer.social_platform, undefined);
    assert.equal(retry.buyer.social_username, undefined);
    assert.deepEqual(await counts(), before);
    assert.equal(await remaining(product, date), 2);
  })();

  await check('social migration is repeatable and preserves private invoker helpers and existing API grants', async () => {
    await db.exec(compatibilitySql);
    await db.exec(enforcementSql);
    const functions = (await db.query(`select p.proname, p.prosecdef,
      p.proconfig @> array['search_path=""'] as empty_search_path,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='tlb' and p.proname in ('validate_contact','validate_social_contact')`)).rows;
    assert.equal(functions.length, 2);
    for (const fn of functions) {
      assert.equal(fn.prosecdef, false, fn.proname);
      assert.equal(fn.empty_search_path, true, fn.proname);
      assert.equal(fn.anon_execute, false, fn.proname);
      assert.equal(fn.authenticated_execute, false, fn.proname);
    }
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await h.scalar("select has_function_privilege($1,'public.shop_api(text,jsonb,text)','execute')", [role]), true);
    }
    await assert.rejects(h.as(ids.customer, () => db.query("select tlb.validate_social_contact('{}'::jsonb,false)")), /permission denied/);
  })();

  await check('staged rollout supports old optional checkout before enforcing new social contact without changing existing records', async () => {
    const definition = await h.scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)");
    const newline = definition.includes('\r\n') ? '\r\n' : '\n';
    const hook = "  perform tlb.validate_social_contact(p_payload->'buyer',true);" + newline;
    assert.equal(definition.split(hook).length, 2);
    const { product, date } = await fixture(3);
    const payload = checkout(product, date);
    delete payload.buyer.social_platform;
    delete payload.buyer.social_username;
    try {
      await db.exec(definition.replace(hook, ''));
      const beforeCompatibility = await counts();
      await db.exec(compatibilitySql);
      assert.deepEqual(await counts(), beforeCompatibility);
      const accepted = await api('create_order', payload);
      assert.equal(accepted.buyer.social_platform, undefined);
      const beforeEnforcement = await counts();
      await db.exec(enforcementSql);
      assert.deepEqual(await counts(), beforeEnforcement);
      assert.equal((await api('create_order', payload)).id, accepted.id);
      await assert.rejects(api('create_order', { ...payload, idempotency_key: randomUUID() }), platformError);
      assert.deepEqual(await counts(), beforeEnforcement);
      assert.equal(await remaining(product, date), 2);
    } finally {
      await db.exec(definition);
    }
  })();
}

