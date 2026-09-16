import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAnalytics } from '../assets/ordering/analytics-view.js';

const helpers = {
  today: '2026-09-16',
  money: cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(cents || 0) / 100),
  escapeHtml: text => String(text ?? '').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value])),
  formatDate: date => date,
};
const order = overrides => ({
  id: 'fixture-order', created_at: '2026-09-16T01:00:00Z', fulfillment_date: '2026-09-20',
  payment_status: 'paid', fulfillment_status: 'confirmed', method: 'pickup',
  paid_amount_cents: 13000, subtotal_cents: 13000, discount_cents: 0, delivery_cents: 0, total_cents: 13000,
  items: [{ product_id: 'nori', name: 'Nori', quantity: 1, unit_price_cents: 13000, line_total_cents: 13000 }],
  ...overrides,
});
const view = (orders, filter = { period: 'this_month' }, products = []) => renderAnalytics({ orders, products, analyticsFilter: filter }, helpers);
const metric = (html, name) => html.match(new RegExp(`data-analytics-metric="${name}">([^<]*)`))?.[1];

test('rendered sales, average and rankings reflect saved edits while original approval stays separate', () => {
  const original = view([order()]);
  assert.equal(metric(original, 'sales'), '₱130.00');
  const changed = view([order({
    total_cents: 32000, subtotal_cents: 26000, discount_cents: 4000, delivery_cents: 10000, method: 'delivery',
    items: [{ product_id: 'nori', name: 'Nori', quantity: 2, unit_price_cents: 13000, line_total_cents: 26000 }],
  })]);
  assert.equal(metric(changed, 'sales'), '₱320.00');
  assert.equal(metric(changed, 'average'), '₱320.00');
  assert.equal(metric(changed, 'units'), '2');
  assert.match(changed, /Originally approved payments<\/dt><dd>₱130\.00/);
  assert.match(changed, /Order values above original approvals<\/dt><dd>₱190\.00/);
  assert.match(changed, /Nori<\/th><td>2<\/td><td>1<\/td><td>₱260\.00/);
});

test('unpaid and cancelled orders remain counted but do not inflate sales or top products', () => {
  const html = view([order({ payment_status: 'under_review', paid_amount_cents: null }), order({ id: 'cancelled', fulfillment_status: 'cancelled' })]);
  assert.equal(metric(html, 'orders'), '2');
  assert.equal(metric(html, 'sales'), '₱0.00');
  assert.equal(metric(html, 'average'), '—');
  assert.equal(metric(html, 'units'), '0');
  assert.match(html, /No paid products in this period/);
  assert.match(html, /Originally approved payments<\/dt><dd>₱130\.00/);
});

test('Manila placement dates filter rendered report independently of fulfillment date', () => {
  const html = view([order({ created_at: '2026-09-15T16:00:00Z' }), order({ created_at: '2026-09-15T15:59:59Z' })], { period: 'custom', start: '2026-09-16', end: '2026-09-16' });
  assert.equal(metric(html, 'orders'), '1');
  assert.equal(metric(html, 'sales'), '₱130.00');
  assert.match(html, /name="start" value="2026-09-16"/);
  assert.match(html, /Orders placed in Manila time/);
});

test('product names are escaped and buyer details never enter analytics markup', () => {
  const html = view([order({ buyer: { name: 'PRIVATE_BUYER', email: 'private@example.test', phone: '09170000000' } })], { period: 'all' }, [{ id: 'nori', name: '<img src=x onerror="alert(1)">' }]);
  assert.doesNotMatch(html, /<img|PRIVATE_BUYER|private@example\.test|09170000000/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test('empty report has zero sales, an unavailable average and a useful empty state', () => {
  const html = view([]);
  assert.equal(metric(html, 'orders'), '0');
  assert.equal(metric(html, 'sales'), '₱0.00');
  assert.equal(metric(html, 'average'), '—');
  assert.match(html, /No orders were placed in this date range/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('full-refund label removes sales and shows the refunded value separately', () => {
  const html = view([order({ refund_label: true })]);
  assert.equal(metric(html, 'sales'), '₱0.00');
  assert.equal(metric(html, 'average'), '—');
  assert.equal(metric(html, 'units'), '0');
  assert.match(html, /Paid orders with a Refund label<\/dt><dd>1/);
  assert.match(html, /Full-refund order value<\/dt><dd>₱130\.00/);
  assert.match(html, /A Refund label removes the full current order value/);
  assert.doesNotMatch(html, /Refund labels alone do not deduct money/);
});

test('pickup and delivery percentages use the eligible paid-order denominator', () => {
  const html = view([order(), order({method: 'delivery'}), order({method: 'delivery', payment_status: 'under_review'}), order({method: 'pickup', refund_label: true})]);
  const methodPanel = html.match(/<h2>Pickup versus delivery<\/h2>[\s\S]*?<\/section>/)?.[0];
  assert.equal(metric(html, 'orders'), '4');
  assert.match(methodPanel, /Paid orders/);
  assert.match(methodPanel, /Pickup<\/span><strong>1<\/strong><small>50\.0% of paid orders/);
  assert.match(methodPanel, /Delivery<\/span><strong>1<\/strong><small>50\.0% of paid orders/);
  assert.match(methodPanel, /Unpaid, cancelled, expired and Refund-labelled orders are excluded/);
});

test('sales trend table and chart tooltip count the same paid orders as sales', () => {
  const html = view([
    order(), order({fulfillment_status: 'completed'}),
    order({payment_status: 'awaiting_payment', paid_amount_cents: null}),
    order({payment_status: 'under_review', paid_amount_cents: null}),
    order({fulfillment_status: 'cancelled'}), order({fulfillment_status: 'expired'}),
    order({refund_label: true}),
  ], {period: 'today'});
  const trend = html.match(/<section class="panel analytics-trend">[\s\S]*?<\/section>/)?.[0];
  assert.equal(metric(html, 'orders'), '7', 'The overall order-count card still includes all orders');
  assert.match(trend, /<th scope="col">Paid orders<\/th>/);
  assert.match(trend, /2026-09-16<\/th><td>2<\/td><td>₱260\.00<\/td>/);
  assert.match(trend, /title="2026-09-16: ₱260\.00 sales, 2 paid orders"/);
  assert.match(trend, /aria-label="2026-09-16: ₱260\.00 sales, 2 paid orders"/);
  assert.doesNotMatch(trend, /Orders placed|7 paid orders|7 orders placed/);
});

test('a trend date with unpaid orders shows zero paid orders and zero sales', () => {
  const html = view([order({payment_status: 'under_review', paid_amount_cents: null})], {period: 'today'});
  const trend = html.match(/<section class="panel analytics-trend">[\s\S]*?<\/section>/)?.[0];
  assert.match(trend, /2026-09-16<\/th><td>0<\/td><td>₱0\.00<\/td>/);
  assert.match(trend, /₱0\.00 sales, 0 paid orders/);
});
