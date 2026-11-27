// Older cached orders can carry the refund mark with their previous fulfillment status.
export function fulfillmentStatus(order) {
  return order.refund_label ? 'cancelled' : order.fulfillment_status;
}

export function displayPaymentStatus(order) {
  return order.fulfillment_status === 'expired' && order.payment_status === 'awaiting_payment' ? 'expired' : order.payment_status;
}

export function matchesFulfillmentStatus(order, selected) {
  if (selected === 'refunded') return Boolean(order.refund_label);
  return !selected || fulfillmentStatus(order) === selected;
}

const INACTIVE = new Set(['cancelled', 'expired', 'completed', 'refunded']);

export function isActiveFulfillment(order) {
  return !INACTIVE.has(fulfillmentStatus(order));
}

// A completed delivery can still have a courier charge awaiting payment or review.
export function isPaymentClosed(order) {
  return ['cancelled', 'expired'].includes(fulfillmentStatus(order));
}

export function needsPaymentReview(order) {
  if (isPaymentClosed(order)) return false;
  if (order.deferred_delivery && order.delivery_payment_status === 'under_review') return true;
  return order.payment_status === 'under_review'
    && order.fulfillment_status === 'pending_confirmation';
}
