import test from 'node:test';
import assert from 'node:assert/strict';
import { fulfillmentStatus, matchesFulfillmentStatus, isActiveFulfillment, needsPaymentReview } from '../assets/ordering/refund-status.js';
import { buildAnalytics } from '../assets/ordering/analytics.js';

const paidOrder = overrides => ({
  id: 'paid-order', created_at: '2026-09-18T02:00:00Z', fulfillment_date: '2026-09-19',
  payment_status: 'paid', fulfillment_status: 'confirmed', refund_label: false,
  method: 'pickup', paid_amount_cents: 20000, total_cents: 20000, subtotal_cents: 20000,
  discount_cents: 0, delivery_cents: 0,
  items: [{ product_id: 'nori', name: 'Nori chips', quantity: 2, unit_price_cents: 10000, line_total_cents: 20000 }],
  ...overrides,
});

test('only active, unrefunded payment reviews appear in the review queue', () => {
  const review = paidOrder({ payment_status: 'under_review', fulfillment_status: 'pending_confirmation' });
  assert.equal(needsPaymentReview(review), true);
  for (const status of ['cancelled', 'expired', 'completed', 'confirmed']) {
    assert.equal(needsPaymentReview({ ...review, fulfillment_status: status }), false);
  }
  assert.equal(needsPaymentReview({ ...review, refund_label: true }), false);
  for (const payment_status of ['awaiting_payment', 'paid', 'rejected', 'cancelled']) {
    assert.equal(needsPaymentReview({ ...review, payment_status }), false);
  }
});

test('completed deliveries retain deferred payment review until cancelled or refund-marked', () => {
  const completed = paidOrder({deferred_delivery:true, delivery_payment_status:'under_review', fulfillment_status:'completed'});
  assert.equal(isActiveFulfillment(completed), false);
  assert.equal(needsPaymentReview(completed), true);
  assert.equal(needsPaymentReview({...completed, refund_label:true}), false);
  for (const status of ['cancelled','expired']) assert.equal(needsPaymentReview({...completed,fulfillment_status:status}), false);
});

test('refund-marked orders always display cancelled, including cached pre-migration records', () => {
  for (const status of ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled', 'expired']) {
    const order = paidOrder({ fulfillment_status: status, refund_label: true });
    const snapshot = structuredClone(order);
    assert.equal(fulfillmentStatus(order), 'cancelled');
    assert.equal(isActiveFulfillment(order), false);
    assert.deepEqual(order, snapshot, 'presentation must not overwrite stored state or payment');
    assert.equal(order.payment_status, 'paid');
    assert.equal(order.paid_amount_cents, 20000);
  }
});

test('cancellation and refund filters overlap while pending and completed filters exclude refunds', () => {
  const orders = [
    paidOrder({ id: 'confirmed' }),
    paidOrder({ id: 'refunded-confirmed', refund_label: true }),
    paidOrder({ id: 'cancelled', fulfillment_status: 'cancelled' }),
    paidOrder({ id: 'refunded-cancelled', fulfillment_status: 'cancelled', refund_label: true }),
    paidOrder({ id: 'completed', fulfillment_status: 'completed' }),
    paidOrder({ id: 'pending', payment_status: 'awaiting_payment', fulfillment_status: 'pending_confirmation' }),
  ];
  const matching = status => orders.filter(order => matchesFulfillmentStatus(order, status)).map(order => order.id);
  assert.deepEqual(matching(''), orders.map(order => order.id));
  assert.deepEqual(matching('refunded'), ['refunded-confirmed', 'refunded-cancelled']);
  assert.deepEqual(matching('confirmed'), ['confirmed']);
  assert.deepEqual(matching('cancelled'), ['refunded-confirmed', 'cancelled', 'refunded-cancelled']);
  assert.deepEqual(orders.filter(isActiveFulfillment).map(order => order.id), ['confirmed', 'pending']);
  assert.deepEqual(matching('completed'), ['completed']);
});

test('displaying a refund keeps sales deductions and original payment totals consistent', () => {
  const order = paidOrder({ fulfillment_status: 'cancelled', refund_label: true });
  const report = () => buildAnalytics([order], { today: '2026-09-18' });
  const before = report();
  assert.equal(fulfillmentStatus(order), 'cancelled');
  assert.equal(matchesFulfillmentStatus(order, 'refunded'), true);
  assert.deepEqual(report(), before);
  assert.equal(before.currentOrderValueCents, 0);
  assert.equal(before.approvedPaymentsCents, 20000);
  assert.equal(before.pickupCount, 0);
  assert.equal(before.refundedPaidOrderCount, 1);
  order.refund_label = false;
  assert.equal(fulfillmentStatus(order), 'cancelled');
  assert.equal(matchesFulfillmentStatus(order, 'refunded'), false);
  assert.equal(isActiveFulfillment(order), false);
  assert.equal(report().currentOrderValueCents, 0);
  assert.equal(report().pickupCount, 0);
});
