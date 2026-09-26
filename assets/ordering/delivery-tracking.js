const INVALID_URL_MESSAGE = 'Enter a complete HTTPS courier tracking link, or leave it blank.';

// Links are manually supplied by staff; never turn malformed returned data into a link.
export function safeDeliveryTrackingUrl(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > 2048 || !/^https:\/\//i.test(text) || /[\s\u0000-\u0020\u007f-\u009f<>"'\\]/.test(text)) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.href.length > 2048) return '';
    return url.href;
  } catch { return ''; }
}

export function deliveryTrackingUrlForSave(value) {
  if (typeof value !== 'string') throw new Error(INVALID_URL_MESSAGE);
  if (!value.trim()) return '';
  const url = safeDeliveryTrackingUrl(value);
  if (!url) throw new Error(INVALID_URL_MESSAGE);
  return url;
}

export function deliveryTrackingLink(order, escapeHtml) {
  const url = order?.method === 'delivery' ? safeDeliveryTrackingUrl(order.delivery_tracking_url) : '';
  return url ? `<a class="button button-secondary" data-delivery-tracking href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Track delivery <span aria-hidden="true">↗</span></a>` : '';
}
