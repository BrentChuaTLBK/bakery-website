import { config } from './config.js';

export async function googleSignInEnabled(signal) {
  try {
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: config.supabasePublishableKey },
      signal: signal ?? AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (response.ok) {
      const enabled = (await response.json())?.external?.google;
      if (typeof enabled === 'boolean') return enabled;
    }
  } catch { /* A later check can confirm availability after a network failure. */ }
  return null;
}

export function watchGoogleSignIn(block) {
  const firstRetry = 2000;
  let retryDelay = firstRetry;
  let timer;
  let request;

  function pause() {
    clearTimeout(timer);
    request?.abort();
    request = null;
    retryDelay = firstRetry;
    block.hidden = true;
  }

  async function check() {
    if (document.hidden || navigator.onLine === false) {
      pause();
      return;
    }
    if (request) return;
    clearTimeout(timer);
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    const enabled = await googleSignInEnabled(controller.signal);
    clearTimeout(timeout);
    if (request !== controller) return;
    request = null;
    block.hidden = enabled !== true;
    timer = setTimeout(check, block.hidden ? retryDelay : 60000);
    retryDelay = block.hidden ? Math.min(retryDelay * 2, 30000) : firstRetry;
  }

  window.addEventListener('online', check);
  window.addEventListener('offline', pause);
  document.addEventListener('visibilitychange', check);
  check();
  return () => {
    window.removeEventListener('online', check);
    window.removeEventListener('offline', pause);
    document.removeEventListener('visibilitychange', check);
    pause();
  };
}
