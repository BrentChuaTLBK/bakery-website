import { auth, ready } from './client.js?v=approved-20261002-1';
import { config } from './config.js';

export async function homepageApi(action, payload = {}) {
  await ready;
  if (!auth) throw new Error('Sign in with your owner account to edit the home page.');
  const { data, error } = await auth.getSession();
  if (error || !data.session) throw new Error('Please sign in again before saving. Your edits are still here.');
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/homepage_api`, {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_action: action, p_payload: payload }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'The home page could not save. Please try again.');
  return result;
}
