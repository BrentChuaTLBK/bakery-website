export function renderPickupReminder(order, { escapeHtml: esc, dateTime, connected }) {
  if (order.method !== 'pickup' || order.payment_status !== 'paid' || order.fulfillment_status !== 'ready_for_pickup' || order.refund_label) return '';
  const last = order.pickup_reminder;
  const pending = ['pending', 'sending'].includes(last?.status);
  const cooling = last?.next_allowed_at && new Date(last.next_allowed_at).getTime() > Date.now();
  let note = '';
  if (pending) note = 'A reminder is queued for delivery. Refresh the status to check its progress.';
  else if (last?.status === 'sent') note = `Last reminder sent ${dateTime(last.sent_at)}.`;
  else if (last?.status === 'skipped') note = 'The last reminder was skipped because the order changed before it could be sent.';
  else if (last?.status === 'failed') note = 'The last reminder needs review. Check Email delivery on the Overview page.';
  if (cooling && !pending) note += ` Another reminder is available after ${dateTime(last.next_allowed_at)}.`;
  return `<section class="detail-section pickup-reminder private-staff" aria-labelledby="pickup-reminder-title"><h3 id="pickup-reminder-title">Pickup reminder</h3><p>Email <strong>${esc(order.buyer?.email || 'the customer')}</strong> a friendly reminder that this order is ready to collect.</p><div class="row-actions"><button type="button" class="button button-secondary" data-action="send-pickup-reminder" ${!connected || pending || cooling || !order.buyer?.email ? 'disabled' : ''}>${pending ? 'Reminder queued' : 'Send pickup reminder'}</button>${last ? '<button type="button" class="button button-quiet" data-action="refresh-pickup-reminder">Refresh status</button>' : ''}</div>${note ? `<p class="help-text no-margin" role="status">${esc(note)}</p>` : ''}</section>`;
}
