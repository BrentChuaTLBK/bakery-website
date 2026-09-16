// Enable on shop.html only after the stream's Enhanced Measurement is off.
// See docs/TRAFFIC.md. No Google secret or customer/order data belongs here.
(() => {
  'use strict';
  if (document.currentScript?.dataset.gaPageviewsEnabled !== 'true') return;

  const measurementId = 'G-108BDB1XQ0';
  const disabledKey = `ga-disable-${measurementId}`;
  const productionOrigins = new Set([
    'https://thelittlebakerkitchen.com',
    'https://www.thelittlebakerkitchen.com'
  ]);
  const page = new URL(window.location.href);
  // Order receipts share shop.html. Never load Google on private links or demos.
  const queryIsPublic = [...page.searchParams.keys()].every(key => /^utm_(source|medium|campaign|id|term|content)$/.test(key));
  if (!productionOrigins.has(page.origin) || page.pathname !== '/shop.html' ||
      page.hash || !queryIsPublic || window[disabledKey] === true || window.tlbShopTrafficStarted) return;
  window.tlbShopTrafficStarted = true;

  let referrer = '';
  try {
    const previous = new URL(document.referrer);
    if (/^https?:$/.test(previous.protocol)) {
      if (!productionOrigins.has(previous.origin)) referrer = previous.origin + '/';
      else if (!previous.hash && ['/', '/index.html', '/shop.html', '/contactus.html', '/faq.html'].includes(previous.pathname)) {
        referrer = previous.origin + previous.pathname;
      }
    }
  } catch { /* Empty or invalid referrers carry no attribution. */ }

  // Register before Google's script loads. Stop for the rest of this document
  // before order submission/private navigation; never inspect field contents.
  const stop = () => { window[disabledKey] = true; };
  window.addEventListener('hashchange', stop, true);
  window.addEventListener('popstate', stop, true);
  window.addEventListener('pagehide', stop, true);
  document.addEventListener('submit', stop, true);
  document.addEventListener('click', event => {
    if (event.target?.closest?.('#place-order')) stop();
  }, true);
  document.addEventListener('focusin', event => {
    if (event.target?.closest?.('form')) stop();
  }, true);

  const fields = {
    page_location: page.origin + page.pathname,
    page_referrer: referrer,
    page_title: 'Order online · The Little Baker Kitchen',
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  };
  window.dataLayer = window.dataLayer || [];
  const gtag = function () { window.dataLayer.push(arguments); };
  gtag('set', fields);
  gtag('js', new Date());
  gtag('config', measurementId, {...fields, send_page_view: false});
  gtag('event', 'page_view', {...fields, send_to: measurementId});
  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
})();
