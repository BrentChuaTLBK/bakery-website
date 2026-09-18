import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOrderSave } from '../assets/ordering/order-edit-save.js';

const order = () => ({ id: 'order-1', revision: 3, total_cents: 10000, payment_status: 'paid' });
const quote = (total = 10000) => ({ items: [{ product_id: 'product-1', name: 'Nori Chips', quantity: 1, unit_price_cents: total }], subtotal_cents: total, discount_cents: 0, delivery_cents: 0, total_cents: total, preview: true });
function setup(overrides = {}) {
  const calls = { preview: [], confirmations: [], displayed: [] };
  const args = {
    order: order(), changes: { buyer: { name: 'Corrected name' } }, reason: 'Customer correction', idempotencyKey: 'edit-1',
    preview: async payload => { calls.preview.push(payload); return quote(); },
    confirmTotalChange: async payload => { calls.confirmations.push(payload); return true; },
    onPreview: value => calls.displayed.push(value), ...overrides,
  };
  return { calls, args, run: () => prepareOrderSave(args) };
}

test('an unchanged total prepares one checked save without confirmation', async () => {
  const s = setup();
  const payload = await s.run();
  assert.deepEqual(s.calls.preview, [{ order_id: 'order-1', revision: 3, changes: s.args.changes }]);
  assert.equal(s.calls.confirmations.length, 0);
  assert.equal(s.calls.displayed.length, 1);
  assert.deepEqual(payload, { order_id: 'order-1', revision: 3, idempotency_key: 'edit-1', changes: s.args.changes, reason: s.args.reason,
    expected_quote: { items: quote().items, subtotal_cents: 10000, discount_cents: 0, delivery_cents: 0, total_cents: 10000 } });
  assert.equal(Object.hasOwn(payload, 'payment_status'), false);
});

for (const amount of [0, 5000, 15000]) {
  test(`a changed total of ${amount} requires confirmation with the saved amount and payment status`, async () => {
    const s = setup({ preview: async () => quote(amount) });
    const payload = await s.run();
    assert.deepEqual(s.calls.confirmations, [{ oldTotal: 10000, newTotal: amount, paymentStatus: 'paid' }]);
    assert.equal(payload.expected_quote.total_cents, amount);
  });
}

test('declining the total change returns no mutation payload', async () => {
  const s = setup({ preview: async () => quote(20000), confirmTotalChange: async () => false });
  assert.equal(await s.run(), null);
});

test('preview failure propagates without prompting or producing a payload', async () => {
  const error = new Error('Insufficient stock.');
  const s = setup({ preview: async () => { throw error; } });
  await assert.rejects(s.run(), error);
  assert.equal(s.calls.confirmations.length, 0);
  assert.equal(s.calls.displayed.length, 0);
});

test('a stale form never starts a preview', async () => {
  const s = setup({ isCurrent: () => false });
  await assert.rejects(s.run(), /order or form changed/);
  assert.equal(s.calls.preview.length, 0);
});

test('closing or replacing the form during preview prevents confirmation and saving', async () => {
  let current = true;
  const s = setup({ isCurrent: () => current, preview: async () => { current = false; return quote(20000); } });
  await assert.rejects(s.run(), /order or form changed/);
  assert.equal(s.calls.confirmations.length, 0);
  assert.equal(s.calls.displayed.length, 0);
});

test('a form change while confirming prevents saving despite approval', async () => {
  let current = true;
  const s = setup({ isCurrent: () => current, preview: async () => quote(20000), confirmTotalChange: async () => { current = false; return true; } });
  await assert.rejects(s.run(), /order or form changed/);
});

test('a form change caused by rendering the check prevents confirmation', async () => {
  let current = true;
  const s = setup({ isCurrent: () => current, preview: async () => quote(20000), onPreview: () => { current = false; } });
  await assert.rejects(s.run(), /order or form changed/);
  assert.equal(s.calls.confirmations.length, 0);
});

test('order and changes are snapshotted before awaiting and the resulting payload is deeply immutable', async () => {
  let finish;
  const s = setup({ preview: () => new Promise(resolve => { finish = resolve; }) });
  const pending = s.run();
  s.args.order.id = 'other-order'; s.args.order.revision = 9; s.args.order.total_cents = 50000; s.args.order.payment_status = 'unpaid';
  s.args.changes.buyer.name = 'Changed during request'; s.args.reason = 'Changed reason'; s.args.idempotencyKey = 'different-key';
  const response = quote(20000);
  finish(response);
  const payload = await pending;
  response.items[0].name = 'Changed response';
  assert.equal(payload.order_id, 'order-1'); assert.equal(payload.revision, 3);
  assert.equal(payload.changes.buyer.name, 'Corrected name'); assert.equal(payload.reason, 'Customer correction'); assert.equal(payload.idempotency_key, 'edit-1');
  assert.deepEqual(s.calls.confirmations[0], { oldTotal: 10000, newTotal: 20000, paymentStatus: 'paid' });
  assert.equal(payload.expected_quote.items[0].name, 'Nori Chips');
  assert.throws(() => { payload.changes.buyer.name = 'Mutated'; }, TypeError);
  assert.throws(() => { payload.expected_quote.items[0].quantity = 99; }, TypeError);
});

test('expected_quote carries present delivery snapshots and excludes unrelated server data', async () => {
  const s = setup({ preview: async () => ({ ...quote(), delivery_zone_name: 'Quezon City', delivery_zone_description: 'One motorcycle trip', reference: 'PRIVATE-REFERENCE', payment_status: 'paid' }) });
  const { expected_quote: expected } = await s.run();
  assert.deepEqual(Object.keys(expected), ['items', 'subtotal_cents', 'discount_cents', 'delivery_cents', 'total_cents', 'delivery_zone_name', 'delivery_zone_description']);
  assert.equal(expected.delivery_zone_name, 'Quezon City'); assert.equal(expected.delivery_zone_description, 'One motorcycle trip');
});

test('legacy checks with no zone fields omit them instead of adding undefined values', async () => {
  const { expected_quote: expected } = await setup().run();
  assert.equal(Object.hasOwn(expected, 'delivery_zone_name'), false);
  assert.equal(Object.hasOwn(expected, 'delivery_zone_description'), false);
});

for (const value of [-1, 1.5, '10000', null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects malformed saved or preview money: ${String(value)}`, async () => {
    await assert.rejects(setup({ order: { ...order(), total_cents: value } }).run(), /saved order is incomplete/);
    for (const key of ['subtotal_cents', 'discount_cents', 'delivery_cents', 'total_cents']) {
      const s = setup({ preview: async () => ({ ...quote(), [key]: value }) });
      await assert.rejects(s.run(), /invalid total or item list/);
      assert.equal(s.calls.confirmations.length, 0);
    }
  });
}

for (const value of [null, {}, { ...quote(), items: [] }, { ...quote(), items: [null] }, { ...quote(), items: ['item'] }, { ...quote(), discount_cents: 20000 }, { ...quote(), delivery_cents: 1 }]) {
  test(`rejects incomplete or inconsistent preview ${JSON.stringify(value)}`, async () => {
    await assert.rejects(setup({ preview: async () => value }).run(), /invalid total or item list/);
  });
}

test('requires changes and a reason before checking the order', async () => {
  for (const patch of [{ changes: {} }, { changes: null }, { reason: '' }, { reason: '  ' }]) {
    const s = setup(patch);
    await assert.rejects(s.run(), /changes and a reason/);
    assert.equal(s.calls.preview.length, 0);
  }
});
