import { config } from './config.js';

// null means the public settings check was inconclusive. Supabase still decides whether OAuth can start.
export async function googleSignInEnabled() {
  try {
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: config.supabasePublishableKey }, signal: AbortSignal.timeout(5000), cache: 'no-store',
    });
    if (response.ok) {
      const enabled = (await response.json())?.external?.google;
      if (typeof enabled === 'boolean') return enabled;
    }
  } catch { /* The OAuth endpoint can still be reachable if this settings check fails. */ }
  return null;
}
