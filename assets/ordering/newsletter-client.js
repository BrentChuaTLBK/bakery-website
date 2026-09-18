import { config } from './config.js';

// Keep auth initialization lazy: the newsletter landing page first removes its
// private token from the address bar, before loading any network-backed module.
let clientPromise;
async function client() {
  clientPromise ||= import('./client.js');
  const value = await clientPromise;
  await value.ready;
  return value;
}

export async function newsletterSession() {
  const { auth, configured, initializationError } = await client();
  if (!configured || initializationError || !auth) throw new Error('The email preference service could not be reached. Please try again.');
  const { data, error } = await auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

export async function newsletterRequest(action, payload = {}) {
  if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Newsletter signup is not available yet. Please try again later.');
  let session;
  try { session = await newsletterSession(); }
  catch (error) { if (['status', 'popup_claim', 'popup_seen'].includes(action) || (action === 'unsubscribe' && !payload.token)) throw error; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ['status', 'popup_claim', 'popup_seen'].includes(action) ? 30000 : 60000);
  try {
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/newsletter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey, ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('We could not save your email preference. Please try again.'); }
    if (!response.ok || result?.error) throw new Error(typeof result?.error === 'string' ? result.error : 'We could not save your email preference. Please try again.');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('We could not connect. Please check your connection and try again.');
    throw error;
  } finally { clearTimeout(timer); }
}

