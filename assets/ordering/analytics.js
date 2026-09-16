// Read-only reporting over the latest admin order snapshots. All amounts are cents.
const DAY = 86400000;
const CLOSED = new Set(['cancelled', 'expired']);
const manilaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
});

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function shiftDate(value, days) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** The order placement day, independent of the viewer's browser timezone. */
export function manilaOrderDate(timestamp) {
  if (timestamp == null || timestamp === '') return '';
  if (typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return validDate(timestamp) ? timestamp : '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(manilaFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Presets include today; an empty bound means no limit. Custom bounds are supplied separately. */
export function analyticsDateRange(preset, today = manilaOrderDate(new Date())) {
  const date = validDate(today) ? today : manilaOrderDate(new Date());
  switch (preset) {
    case 'today': return {start: date, end: date};
    case 'last7': return {start: shiftDate(date, -6), end: date};
    case 'last30': return {start: shiftDate(date, -29), end: date};
    case 'this_month': return {start: `${date.slice(0, 7)}-01`, end: date};
    default: return {start: '', end: ''};
  }
}

function nonnegativeInteger(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

const cents = value => nonnegativeInteger(value) ?? 0;
const monthNumber = date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthStart = number => `${String(Math.floor(number / 12)).padStart(4, '0')}-${String(number % 12 + 1).padStart(2, '0')}-01`;

function makeTrend(rows, start, end, today) {
  const dates = rows.map(row => row.date).sort();
  const first = start || dates[0] || end || today;
  const last = end || [dates.at(-1) || first, today, first].sort().at(-1);
  const days = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY) + 1;
  const unit = days <= 31 ? 'day' : days <= 217 ? 'week' : 'month';
  const interval = unit === 'month' ? Math.ceil((monthNumber(last) - monthNumber(first) + 1) / 31) : 1;
  const buckets = [];
  let cursor = first;
  while (cursor <= last) {
    const next = unit === 'month' ? monthStart(monthNumber(cursor) + interval) : shiftDate(cursor, unit === 'week' ? 7 : 1);
    const bucketEnd = next > last ? last : shiftDate(next, -1);
    buckets.push({start: cursor, end: bucketEnd, orderCount: 0, paidOrderCount: 0,
      approvedPaymentsCents: 0, activePaidOrderCount: 0, currentOrderValueCents: 0});
    cursor = next;
  }
  for (const {order, date} of rows) {
    const bucket = buckets.find(item => date >= item.start && date <= item.end);
    if (!bucket) continue;
    bucket.orderCount++;
    if (order.payment_status === 'paid') {
      bucket.paidOrderCount++;
      bucket.approvedPaymentsCents += cents(order.paid_amount_cents);
      if (!CLOSED.has(order.fulfillment_status)) {
        bucket.activePaidOrderCount++;
        bucket.currentOrderValueCents += cents(order.total_cents);
      }
    }
  }
  return {trend: buckets, trendUnit: unit, trendInterval: interval};
}

/**
 * Filter by Manila placement date and summarize CURRENT order/payment states.
 * Sales use current paid, non-cancelled/non-expired orders (including completed).
 * Approved payments preserve the original recorded approval, even after cancellation.
 * A refund label never subtracts money: this system has no refund transaction ledger.
 */
export function buildAnalytics(orders = [], {start = '', end = '', today = manilaOrderDate(new Date()), products = []} = {}) {
  const invalidRange = Boolean((start && !validDate(start)) || (end && !validDate(end)) || (start && end && start > end));
  const result = {
    range: {start, end}, invalidRange, invalidDateOrderCount: 0,
    totalOrders: 0, paidOrderCount: 0, approvedPaymentsCents: 0, approvedAmountOrderCount: 0,
    missingApprovedAmountCount: 0, averageApprovedPaymentCents: null,
    activePaidOrderCount: 0, currentOrderValueCents: 0, averageOrderValueCents: null,
    currentProductValueCents: 0, currentDiscountCents: 0, currentDeliveryCents: 0,
    additionalPaymentCents: 0, refundDifferenceCents: 0,
    awaitingPaymentCount: 0, underReviewCount: 0, expiredCount: 0, cancelledCount: 0,
    refundFlaggedCount: 0, paidAdjustmentCount: 0, pickupCount: 0, deliveryCount: 0,
    totalUnits: 0, topProducts: [], trend: [], trendUnit: 'day', trendInterval: 1
  };
  if (invalidRange) return result;
  const rows = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || typeof order !== 'object') continue;
    const date = manilaOrderDate(order.created_at);
    if (!date) { result.invalidDateOrderCount++; continue; }
    if ((!start || date >= start) && (!end || date <= end)) rows.push({order, date});
  }
  const names = new Map((Array.isArray(products) ? products : []).filter(Boolean).map(product => [String(product.id), product.name]));
  const productTotals = new Map();
  result.totalOrders = rows.length;
  rows.forEach(({order}, index) => {
    const closed = CLOSED.has(order.fulfillment_status);
    if (order.method === 'pickup') result.pickupCount++;
    if (order.method === 'delivery') result.deliveryCount++;
    if (order.fulfillment_status === 'expired') result.expiredCount++;
    if (order.fulfillment_status === 'cancelled') result.cancelledCount++;
    if (order.refund_label === true) result.refundFlaggedCount++;
    if (!closed && order.payment_status === 'awaiting_payment') result.awaitingPaymentCount++;
    if (!closed && order.payment_status === 'under_review') result.underReviewCount++;
    if (order.payment_status !== 'paid') return;
    result.paidOrderCount++;
    const approved = nonnegativeInteger(order.paid_amount_cents);
    const current = nonnegativeInteger(order.total_cents);
    if (approved === null) result.missingApprovedAmountCount++;
    else {
      result.approvedAmountOrderCount++;
      result.approvedPaymentsCents += approved;
      if (current !== null && current !== approved) result.paidAdjustmentCount++;
    }
    if (closed) return;
    result.activePaidOrderCount++;
    result.currentOrderValueCents += current ?? 0;
    result.currentProductValueCents += cents(order.subtotal_cents);
    result.currentDiscountCents += cents(order.discount_cents);
    result.currentDeliveryCents += cents(order.delivery_cents);
    if (approved !== null && current !== null) {
      result.additionalPaymentCents += Math.max(0, current - approved);
      result.refundDifferenceCents += Math.max(0, approved - current);
    }
    for (const item of Array.isArray(order.items) ? order.items : []) {
      if (!item || typeof item !== 'object') continue;
      const units = nonnegativeInteger(item.quantity) ?? 0;
      if (!units) continue;
      const productId = item.product_id == null ? '' : String(item.product_id);
      // Real IDs distinguish products with the same name; legacy snapshots can lack IDs.
      const key = productId ? `id:${productId}` : `name:${String(item.name || 'Unknown product')}`;
      if (!productTotals.has(key)) productTotals.set(key, {
        productId, name: names.get(productId) || item.name || 'Unknown product', units: 0, lineValueCents: 0, orderIndexes: new Set()
      });
      const row = productTotals.get(key);
      row.units += units;
      const fallback = cents(item.unit_price_cents) * units;
      row.lineValueCents += item.line_total_cents == null ? (Number.isSafeInteger(fallback) ? fallback : 0) : cents(item.line_total_cents);
      row.orderIndexes.add(index);
      result.totalUnits += units;
    }
  });
  result.averageApprovedPaymentCents = result.approvedAmountOrderCount ? Math.round(result.approvedPaymentsCents / result.approvedAmountOrderCount) : null;
  result.averageOrderValueCents = result.activePaidOrderCount ? Math.round(result.currentOrderValueCents / result.activePaidOrderCount) : null;
  result.topProducts = [...productTotals.values()].map(({orderIndexes, ...product}) => ({...product, orderCount: orderIndexes.size}))
    .sort((a, b) => b.units - a.units || b.lineValueCents - a.lineValueCents || String(a.name).localeCompare(String(b.name)) || a.productId.localeCompare(b.productId));
  Object.assign(result, makeTrend(rows, start, end, validDate(today) ? today : manilaOrderDate(new Date())));
  return result;
}
