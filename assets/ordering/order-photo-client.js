import { config } from './config.js';

export async function requestOrderPhotos(payload, { staff = false } = {}) {
  if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Order photos are unavailable.');
  const headers = { apikey: config.supabasePublishableKey };
  if (staff) {
    const client = await import('./client.js?v=approved-20261002-1');
    await client.ready;
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error('Sign in to manage order photos.');
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const upload = payload instanceof FormData;
  if (!upload) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/order-photos`, {
    method: 'POST', headers, body: upload ? payload : JSON.stringify(payload),
    credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(upload ? 85000 : 30000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Order photos could not be loaded. Try again.');
  return result;
}

export function orderPhotoUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === new URL(config.supabaseUrl).origin
        && url.pathname.startsWith('/storage/v1/object/sign/order-photos/')) return url.href;
  } catch { /* Reject invalid or unrelated image links. */ }
  return '';
}
