// Keep the stream's Enhanced Measurement off: only sanitized page views are sent.
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
  // Fixed routes/titles prevent private paths and dynamic customer details from
  // becoming analytics fields. All public pages share the same GA property.
  const pages = new Map([
    ['/', 'Home'], ['/index.html', 'Home'], ['/index_test.html', 'Home'],
    ['/aboutus.html', 'About us'], ['/blogpost.html', 'Blog'], ['/blogs.html', 'Blogs'],
    ['/contactus.html', 'Contact us'], ['/customorders.html', 'Custom orders'],
    ['/dessertbar.html', 'Dessert bar'], ['/faq.html', 'FAQ'],
    ['/partycarts.html', 'Party carts'], ['/pastries.html', 'Pastries'],
    ['/testimonials.html', 'Testimonials'], ['/404.html', 'Page not found'],
    ['/shop.html', 'Order online'], ['/account.html', 'Your account'],
    ['/reset-password.html', 'Reset your password']
  ]);
  const page = new URL(window.location.href);
  const accountPages = new Set(['/shop.html', '/account.html', '/reset-password.html']);
  // Blog navigation and campaign links are public; their values are never sent.
  // Unknown query fields fail closed, including order/auth/demo/customer values.
  const queryIsPublic = [...page.searchParams].every(([key, value]) =>
    /^utm_(source|medium|campaign|id|term|content)$/.test(key) ||
    /^(fbclid|gclid|dclid|msclkid|gbraid|wbraid)$/.test(key) ||
    (page.pathname === '/blogpost.html' && key === 'blog' && /^[A-Za-z0-9_-]{1,100}$/.test(value)) ||
    (page.pathname === '/blogs.html' && key === 'page' && /^[1-9]\d{0,5}$/.test(value))
  );
  // Public section links may have a fragment. Only existing static element IDs
  // qualify; shop/account/reset fragments can contain credentials and never do.
  const publicAnchor = !accountPages.has(page.pathname) &&
    /^#[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(page.hash) &&
    Boolean(document.getElementById?.(page.hash.slice(1)));
  if (!productionOrigins.has(page.origin) || !pages.has(page.pathname) ||
      (page.hash && !publicAnchor) || !queryIsPublic || window[disabledKey] === true ||
      window.tlbSiteTrafficStarted || window.tlbShopTrafficStarted) return;
  window.tlbSiteTrafficStarted = true;

  let referrer = '';
  try {
    const previous = new URL(document.referrer);
    if (/^https?:$/.test(previous.protocol)) {
      if (!productionOrigins.has(previous.origin)) referrer = previous.origin + '/';
      else if (!previous.hash && pages.has(previous.pathname) &&
          previous.pathname !== '/account.html' && previous.pathname !== '/reset-password.html') {
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
    page_title: `${pages.get(page.pathname)} · The Little Baker Kitchen`,
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
