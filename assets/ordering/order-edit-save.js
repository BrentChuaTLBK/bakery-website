const moneyFields = ['subtotal_cents', 'discount_cents', 'delivery_cents', 'total_cents'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validMoney = value => Number.isSafeInteger(value) && value >= 0;
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Prepare one amendment; the caller performs the mutation immediately afterward.
export async function prepareOrderSave({ order, changes, reason, idempotencyKey, preview, confirmTotalChange, isCurrent = () => true, onPreview = () => {} }) {
  const snapshot = freeze(structuredClone({
    order_id: order?.id, revision: order?.revision, oldTotal: order?.total_cents,
    paymentStatus: order?.payment_status, changes, reason, idempotency_key: idempotencyKey,
  }));
  const checkCurrent = () => {
    if (!isCurrent()) throw new Error('The order or form changed while checking. Review your changes and save again.');
  };
  if (!snapshot.order_id || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || !validMoney(snapshot.oldTotal)) {
    throw new Error('The saved order is incomplete. Reload the order before saving changes.');
  }
  if (!isObject(snapshot.changes) || !Object.keys(snapshot.changes).length || typeof snapshot.reason !== 'string' || !snapshot.reason.trim() || !snapshot.idempotency_key) {
    throw new Error('Enter your changes and a reason before saving.');
  }
  checkCurrent();
  const result = await preview(freeze({ order_id: snapshot.order_id, revision: snapshot.revision, changes: snapshot.changes }));
  checkCurrent();
  if (!isObject(result) || !Array.isArray(result.items) || !result.items.length || result.items.some(item => !isObject(item)) || moneyFields.some(key => !validMoney(result[key])) || result.discount_cents > result.subtotal_cents || result.subtotal_cents - result.discount_cents + result.delivery_cents !== result.total_cents) {
    throw new Error('The order check returned an invalid total or item list. Try saving again.');
  }
  const checked = freeze(structuredClone(result));
  const expectedQuote = freeze(Object.fromEntries([
    'items', ...moneyFields,
    ...['delivery_zone_name', 'delivery_zone_description'].filter(key => Object.hasOwn(checked, key)),
  ].map(key => [key, checked[key]])));
  onPreview(checked);
  checkCurrent();
  if (checked.total_cents !== snapshot.oldTotal) {
    const confirmed = await confirmTotalChange(freeze({ oldTotal: snapshot.oldTotal, newTotal: checked.total_cents, paymentStatus: snapshot.paymentStatus }));
    checkCurrent();
    if (confirmed !== true) return null;
  }
  checkCurrent();
  return freeze({
    order_id: snapshot.order_id, revision: snapshot.revision, idempotency_key: snapshot.idempotency_key,
    changes: snapshot.changes, reason: snapshot.reason, expected_quote: expectedQuote,
  });
}
