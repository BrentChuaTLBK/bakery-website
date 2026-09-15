import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, checkout, fixture, order, action, proof, remaining, item } = h;
  const delivery = (product, date, changes = {}) => checkout(product, date, {
    method: 'delivery', address: { locality: 'QA City / QA Barangay', line1: '123 QA Street' }, ...changes,
  });
  const baseQuote = q => Object.fromEntries(['items', 'subtotal_cents', 'discount_cents', 'delivery_cents', 'total_cents'].map(k => [k, q[k]]));
  const fullQuote = q => ({ ...baseQuote(q), delivery_zone_name: q.delivery_zone_name, delivery_zone_description: q.delivery_zone_description });
  const counts = async () => (await db.query(`select
    (select count(*)::int from tlb.orders) as orders,
    (select count(*)::int from tlb.allocations) as allocations,
    (select count(*)::int from tlb.outbox) as emails`)).rows[0];
  const saveZone = zone => api('save_zone', { zone }, ids.owner);
  const zoneFixture = async (description = '') => saveZone({
    name: `QA zone ${randomUUID()}`, localities: [`QA locality ${randomUUID()}`], fee_cents: 2500, active: true, description,
  });

  await check('pickup-only product setting defaults off and accepts only owner-managed booleans', async () => {
    const { product } = await fixture();
    assert.equal(product.pickup_only, false);
    const enabled = await api('save_product', { product: { ...product, pickup_only: true } }, ids.owner);
    assert.equal(enabled.pickup_only, true);
    for (const invalid of ['true', 'false', 1, null, {}, []]) {
      await assert.rejects(api('save_product', { product: { ...enabled, pickup_only: invalid } }, ids.owner), /Pickup only must be enabled or disabled/);
    }
    await assert.rejects(api('save_product', { product: { ...enabled, pickup_only: false } }, ids.staff), /owner|permission|authorized/i);
    assert.equal((await api('catalog')).products.find(p => p.id === product.id).pickup_only, true);
    assert.equal((await api('save_product', { product: { ...enabled, pickup_only: false } }, ids.owner)).pickup_only, false);
  })();

  await check('mixed delivery carts cannot quote, create orders, reserve stock or queue emails when any product is pickup only', async () => {
    const { product: fragile, date } = await fixture(3, { pickup_only: true, name: 'QA fragile cake' });
    const { product: regular } = await fixture(3);
    const payload = delivery(regular, date, { items: [item(regular), item(fragile)], pickup_only: false });
    const before = await counts();
    await assert.rejects(api('quote', payload), /QA fragile cake is pickup only/);
    await assert.rejects(api('create_order', payload), /QA fragile cake is pickup only/);
    assert.deepEqual(await counts(), before);
    assert.equal(await remaining(fragile, date), 3);
    assert.equal(await remaining(regular, date), 3);
    const accepted = await api('create_order', { ...payload, method: 'pickup' });
    assert.equal(accepted.method, 'pickup');
    assert.equal(accepted.delivery_cents, 0);
    assert.equal(accepted.delivery_zone_description, '');
    assert.equal((Date.parse(accepted.payment_deadline) - Date.parse(accepted.created_at)) / 1000, 900);
    assert.equal(await remaining(fragile, date), 2);
    assert.equal(await remaining(regular, date), 2);
  })();

  await check('pickup-only rules protect order amendment previews and writes without altering existing paid bookings', async () => {
    const { product, date } = await fixture(5);
    const pickup = await action('approve_payment', await proof(await api('create_order', checkout(product, date))));
    const existingDelivery = await action('approve_payment', await proof(await api('create_order', delivery(product, date))));
    await api('save_product', { product: { ...product, pickup_only: true } }, ids.owner);
    const beforePickup = await order(pickup.id);
    const beforeDelivery = await order(existingDelivery.id);
    const beforeAllocations = await h.allocations(existingDelivery.id);
    const changes = { method: 'delivery', recipient: delivery(product, date).recipient, address: delivery(product, date).address };
    await assert.rejects(action('preview_edit_order', pickup, { changes }), /pickup only/);
    await assert.rejects(action('edit_order', pickup, { reason: 'Invalid method change', changes }), /pickup only/);
    await assert.rejects(action('edit_order', existingDelivery, { reason: 'Invalid increase', changes: { items: [item(product, 2)] } }), /pickup only/);
    assert.deepEqual(await order(pickup.id), beforePickup);
    assert.deepEqual(await order(existingDelivery.id), beforeDelivery);
    assert.deepEqual(await h.allocations(existingDelivery.id), beforeAllocations);
    const corrected = await action('edit_order', existingDelivery, { reason: 'Contact correction', changes: { buyer: { name: 'QA Corrected Name' } } });
    assert.equal(corrected.payment_status, 'paid');
    assert.equal(corrected.method, 'delivery');
    assert.equal(corrected.buyer.name, 'QA Corrected Name');
    assert.deepEqual(await h.allocations(existingDelivery.id), beforeAllocations);
  })();

  await check('delivery-date closures reject new delivery only, preserve existing orders, and can be reopened', async () => {
    const { product, date } = await fixture(6);
    const existing = await api('create_order', delivery(product, date));
    const saved = await api('save_settings', { settings: { delivery_blocked_dates: [date] } }, ids.owner);
    assert.deepEqual(saved.delivery_blocked_dates, [date]);
    const before = await counts();
    await assert.rejects(api('quote', delivery(product, date)), /closed to new delivery bookings/);
    await assert.rejects(api('create_order', delivery(product, date)), /closed to new delivery bookings/);
    assert.deepEqual(await counts(), before);
    assert.equal((await order(existing.id)).fulfillment_status, 'pending_confirmation');
    assert.equal(await remaining(product, date), 5);
    const pickup = await api('create_order', checkout(product, date));
    await assert.rejects(action('preview_edit_order', pickup, { changes: { method: 'delivery', address: delivery(product, date).address } }), /closed to new delivery bookings/);
    assert.equal(pickup.method, 'pickup');
    await api('save_settings', { settings: { delivery_blocked_dates: [], blocked_dates: [date] } }, ids.owner);
    for (const method of ['pickup', 'delivery']) {
      await assert.rejects(api('quote', delivery(product, date, { method })), /closed to new .* bookings/);
    }
    await api('save_settings', { settings: { blocked_dates: [] } }, ids.owner);
    assert.equal((await api('create_order', delivery(product, date))).method, 'delivery');
  })();

  await check('nonproduction dates affect preparation without becoming fulfillment closures', async () => {
    const day = await h.day(40);
    const settings = (await api('catalog')).settings;
    const allDays = { ...settings, production_weekdays: [0, 1, 2, 3, 4, 5, 6], fulfillment_weekdays: [0, 1, 2, 3, 4, 5, 6], nonproduction_dates: [day], blocked_dates: [], pickup_blocked_dates: [], delivery_blocked_dates: [] };
    assert.equal(await h.scalar('select tlb.is_production($1::date,$2::jsonb)', [day, JSON.stringify(allDays)]), false);
    for (const method of ['pickup', 'delivery']) {
      assert.equal(await h.scalar('select tlb.date_supported($1::date,$2,$3::jsonb)', [day, method, JSON.stringify(allDays)]), true);
    }
    await api('save_settings', { settings: { nonproduction_dates: [day], delivery_blocked_dates: [day] } }, ids.owner);
    const retained = await api('save_settings', { settings: { contact_email: settings.contact_email } }, ids.owner);
    assert.deepEqual(retained.nonproduction_dates, [day]);
    assert.deepEqual(retained.delivery_blocked_dates, [day]);
    await api('save_settings', { settings: { nonproduction_dates: settings.nonproduction_dates, delivery_blocked_dates: [] } }, ids.owner);
  })();

  await check('zone descriptions preserve plain text and newlines, allow empty values, and enforce owner/type/length checks', async () => {
    const description = 'One motorcycle may not be enough.\nWe will contact you. <b>Plain text & symbols</b>';
    const zone = await zoneFixture(description);
    assert.equal(zone.description, description);
    assert.equal((await api('catalog')).zones.find(z => z.id === zone.id).description, description);
    assert.equal((await saveZone({ ...zone, description: 'x'.repeat(2000) })).description.length, 2000);
    for (const invalid of ['x'.repeat(2001), null, 123, [], {}]) {
      await assert.rejects(saveZone({ ...zone, description: invalid }), /Delivery zone description must be text with at most 2000 characters/);
    }
    await assert.rejects(api('save_zone', { zone: { ...zone, description: 'Unauthorized' } }, ids.staff), /owner|permission|authorized/i);
    assert.equal((await saveZone({ ...zone, description: '' })).description, '');
    const legacy = { ...zone }; delete legacy.description;
    assert.equal((await saveZone(legacy)).description, '');
  })();

  await check('server zone snapshots ignore caller text and changed reviewed instructions require another review', async () => {
    const zone = await zoneFixture('Original transport notice.\nWe will contact you.');
    const { product, date } = await fixture(5);
    const payload = delivery(product, date, { address: { locality: zone.localities[0], line1: '123 QA Street' }, delivery_zone_description: 'Forged notice', delivery_zone_name: 'Forged zone' });
    const q = await api('quote', payload);
    assert.equal(q.delivery_zone_name, zone.name);
    assert.equal(q.delivery_zone_description, zone.description);
    const saved = await api('create_order', { ...payload, expected_quote: fullQuote(q) });
    assert.equal(saved.delivery_zone_name, zone.name);
    assert.equal(saved.delivery_zone_description, zone.description);
    const updated = await saveZone({ ...zone, name: 'Updated zone name', description: 'Updated transport notice' });
    assert.equal((await order(saved.id)).delivery_zone_description, zone.description);
    const before = await counts();
    await assert.rejects(api('create_order', { ...payload, idempotency_key: randomUUID(), expected_quote: fullQuote(q) }), /Prices or availability changed since review/);
    assert.deepEqual(await counts(), before);
    // Previously published clients compare five financial fields; keep them valid.
    const legacy = await api('create_order', { ...payload, idempotency_key: randomUUID(), expected_quote: baseQuote(q) });
    assert.equal(legacy.delivery_zone_description, updated.description);
    assert.equal(legacy.delivery_zone_name, updated.name);
    const fresh = await api('quote', payload);
    assert.equal((await api('create_order', { ...payload, idempotency_key: randomUUID(), expected_quote: fullQuote(fresh) })).delivery_zone_description, updated.description);
  })();

  await check('paid order edits preserve same-zone snapshots, use new-locality notices, and clear delivery details for pickup', async () => {
    const zone = await zoneFixture('Original order notice');
    const nextZone = await zoneFixture('Second zone notice');
    const { product, date } = await fixture(5);
    let saved = await action('approve_payment', await proof(await api('create_order', delivery(product, date, { address: { locality: zone.localities[0], line1: '123 QA Street' } }))));
    await saveZone({ ...zone, description: 'Revised notice for future orders', fee_cents: 9999 });
    saved = await action('edit_order', saved, { reason: 'Increase within same zone', changes: { items: [item(product, 2)] } });
    assert.equal(saved.delivery_zone_description, zone.description);
    assert.equal(saved.delivery_zone_name, zone.name);
    assert.equal(saved.delivery_cents, zone.fee_cents);
    assert.equal(saved.payment_status, 'paid');
    const changes = { address: { locality: nextZone.localities[0] } };
    const preview = await action('preview_edit_order', saved, { changes });
    assert.equal(preview.delivery_zone_description, nextZone.description);
    await saveZone({ ...nextZone, description: 'Changed after preview' });
    const before = await order(saved.id);
    await assert.rejects(action('edit_order', saved, { reason: 'Change delivery area', changes, expected_quote: fullQuote(preview) }), /Prices changed since the amendment preview/);
    assert.deepEqual(await order(saved.id), before);
    saved = await action('edit_order', saved, { reason: 'Change delivery area', changes });
    assert.equal(saved.delivery_zone_description, 'Changed after preview');
    assert.equal(saved.delivery_zone_name, nextZone.name);
    assert.equal(saved.payment_status, 'paid');
    saved = await action('edit_order', saved, { reason: 'Collect instead', changes: { method: 'pickup' } });
    assert.equal(saved.delivery_zone_description, '');
    assert.equal(saved.delivery_zone_name, '');
    assert.equal(saved.delivery_cents, 0);
    assert.equal(saved.payment_status, 'paid');
    assert.equal((await h.allocations(saved.id))[0].quantity, 2);
  })();

  await check('migration replay preserves live data, existing function grants and contact/payment protections', async () => {
    const migration = await readFile(new URL('../../supabase/migrations/20260915151235_delivery_options.sql', import.meta.url), 'utf8');
    const snapshot = async () => (await db.query(`select
      (select jsonb_agg(to_jsonb(o) order by o.id) from tlb.orders o) as orders,
      (select jsonb_agg(to_jsonb(a) order by a.order_id,a.product_id,a.date) from tlb.allocations a) as allocations,
      (select jsonb_agg(to_jsonb(e) order by e.id) from tlb.outbox e) as emails,
      (select data from tlb.settings where id) as settings`)).rows[0];
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await h.scalar("select has_function_privilege('anon','public.shop_api(text,jsonb,text)','execute')"), true);
    assert.equal(await h.scalar("select has_function_privilege('anon','tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)','execute')"), false);
    assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)','execute')"), false);
    assert.equal(await h.scalar("select position('submitted_at,submitted_at+interval ''15 minutes'',' in pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure))>0"), true);
    assert.equal(await h.scalar("select tlb.valid_contact_phone('Call Brent')"), false);
  })();
}
