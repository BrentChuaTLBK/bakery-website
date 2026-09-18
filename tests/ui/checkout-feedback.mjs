// Exercise the real shop UI against a local, allowlisted API fixture.
// External requests are blocked; this cannot create live orders or send email.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const fixtureNow = '2026-09-15T02:00:00Z';
const date = '2026-09-22';
const pickup = {
  pickup_address: 'TLB Kitchen\n123 Sample Street\n  Quezon City',
  pickup_hours: 'Monday–Saturday\n9 AM–6 PM\n\nPlease arrive on your selected date.',
  pickup_instructions: '1. Message before arrival.\n2. Wait at the gate.\n\n<b>Bring your order reference.</b>\n<img src=x onerror=alert(1)>',
};
const product = { id: 'nori', name: 'Local nori fixture', description: 'Isolated checkout regression fixture.', price_cents: 13000, min_quantity: 1, lead_days: 1, active: true, photos: [], option_groups: [], sort_order: 0 };
const catalog = {
  products: [product], categories: [],
  inventory: [{ product_id: product.id, date, capacity: 100, remaining: 100, available: true }],
  zones: [{ id: 'qc', name: 'Quezon City', localities: ['Quezon City / Sample Barangay'], fee_cents: 10000, active: true }],
  settings: { paused: false, shop_name: 'Local fixture', production_weekdays: [0, 1, 2, 3, 4, 5, 6], fulfillment_weekdays: [0, 1, 2, 3, 4, 5, 6], nonproduction_dates: [], blocked_dates: [], delivery_window: '9 AM–6 PM', payment_instructions: 'Local test only. Do not transfer payment.', ...pickup },
};
const fixtureKey = 'tlb-checkout-feedback-order';
const client = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const helpers = client.slice(client.indexOf('export function money('));
assert.ok(helpers.startsWith('export function money('));
const mockClient = `
export const configured = true;
export const ready = Promise.resolve();
export const auth = {
  getSession: async () => ({ data: { session: null }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
};
const catalog = ${JSON.stringify(catalog)};
const fixtureKey = ${JSON.stringify(fixtureKey)};
window.__checkoutCalls = [];
function quote(payload) {
  const items = payload.items.map(line => ({ ...line, name: catalog.products[0].name, unit_price_cents: 13000, line_total_cents: 13000 * line.quantity, selection_labels: [] }));
  const subtotal_cents = items.reduce((sum, line) => sum + line.line_total_cents, 0);
  const delivery_cents = payload.method === 'delivery' ? 10000 : 0;
  return { items, subtotal_cents, discount_cents: 0, delivery_cents, total_cents: subtotal_cents + delivery_cents };
}
export async function api(action, payload = {}) {
  window.__checkoutCalls.push({ action, payload: structuredClone(payload) });
  if (action === 'catalog') return structuredClone(catalog);
  if (action === 'quote') return quote(payload);
  if (action === 'create_order') {
    const now = new Date();
    const order = { ...structuredClone(payload), ...quote(payload),
      id: 'local-order', access_token: 'local-token', reference: 'LOCAL-CHECKOUT-TEST',
      created_at: now.toISOString(), payment_deadline: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      payment_status: 'awaiting_payment', fulfillment_status: 'pending', history: [],
      ...${JSON.stringify(pickup)} };
    localStorage.setItem(fixtureKey, JSON.stringify(order));
    return structuredClone(order);
  }
  if (action === 'get_order') {
    const order = JSON.parse(localStorage.getItem(fixtureKey) || 'null');
    if (!order || order.id !== payload.order_id) throw new Error('Unknown local fixture order');
    return order;
  }
  throw new Error('Unexpected API action in isolated test: ' + action);
}
export async function upload() { throw new Error('Uploads are disabled in this isolated test.'); }
${helpers}`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/assets/ordering/client.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(mockClient); return; }
    const path = resolve(root, '.' + (name === '/' ? '/shop.html' : name));
    if (!path.startsWith(root + '/')) throw new Error('Invalid path');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const forbidden = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (/supabase|resend|\/auth\/|\/rest\/|\/functions\//.test(url.href)) forbidden.push(url.href);
    return route.abort();
  });
  await context.addInitScript(instant => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [instant])); }
      static now() { return new NativeDate(instant).getTime(); }
    };
  }, fixtureNow);
  // Reproduce stale username data from a checkout saved before this fix.
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('checkout-fixture-seeded')) {
      localStorage.setItem('tlb-checkout-v1', JSON.stringify({ buyer: { social_platform: '', social_username: 'stale.username' }, saved_at: Date.now() }));
      sessionStorage.setItem('checkout-fixture-seeded', '1');
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push('Unexpected browser dialog: ' + dialog.message()); dialog.dismiss(); });
  const field = name => page.locator(`[name="${name}"]`);
  const calls = action => page.evaluate(action => window.__checkoutCalls.filter(call => call.action === action), action);
  const assertPickup = async (selector, expected) => {
    const nodes = page.locator(selector);
    assert.deepEqual(await nodes.allTextContents(), expected, 'Pickup text must retain exact newlines, blank lines, spaces, and literal markup');
    assert.deepEqual(await nodes.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).whiteSpace)), expected.map(() => 'pre-wrap'));
    assert.equal(await nodes.locator('img, b, script').count(), 0, 'Owner text must not become HTML');
  };
  const review = async () => { await page.locator('#review-order').click(); await page.locator('#place-order').waitFor(); };
  const edit = async () => { await page.locator('#edit-checkout').click(); await page.locator('#checkout-form').waitFor(); };
  const assertRejected = async (name, value) => {
    await field(name).fill(value);
    assert.equal(await field(name).evaluate(node => node.checkValidity()), false, `${name} must reject ${JSON.stringify(value)}`);
    const before = { quote: (await calls('quote')).length, create: (await calls('create_order')).length };
    await page.locator('#review-order').click();
    assert.equal(await page.locator('#checkout-form').isVisible(), true);
    assert.equal(await page.locator('#place-order').count(), 0);
    assert.equal((await calls('quote')).length, before.quote, 'Invalid input must not request a quote');
    assert.equal((await calls('create_order')).length, before.create, 'Invalid input must not create an order');
  };

  await page.goto(origin + '/shop.html', { waitUntil: 'networkidle' });
  await page.locator('#fulfillment-date').click();
  await page.locator(`[data-customer-date="${date}"]`).click();
  await page.locator('[data-product="nori"]').click();
  await page.locator('#add-to-cart').click();
  await page.locator('#checkout-button').click();
  await field('buyer_name').fill('Local Buyer');
  await field('buyer_email').fill('buyer@example.test');
  await assertPickup('#checkout-form .pickup-text', Object.values(pickup));

  assert.equal(await field('social_username').isDisabled(), true);
  assert.equal(await field('social_username').inputValue(), '', 'No selected platform clears a stale username restored from local storage');
  await field('buyer_phone').fill('+63 917 000 0000');
  assert.equal(await field('social_platform').evaluate(node => node.required), true);
  assert.equal(await field('social_platform').evaluate(node => node.checkValidity()), false);
  await page.locator('#review-order').click();
  assert.equal((await calls('quote')).length, 0, 'A platform answer is required before requesting a quote');
  for (const platform of ['facebook', 'instagram']) {
    await field('social_platform').selectOption(platform);
    assert.equal(await field('social_username').isEnabled(), true);
    assert.equal(await field('social_username').evaluate(node => node.required), true);
    await assertRejected('social_username', '');
    await assertRejected('social_username', '   ');
    await field('social_username').fill('  ' + platform + '.user  ');
    await review();
    const request = (await calls('quote')).at(-1).payload;
    assert.equal(request.buyer.social_platform, platform);
    assert.equal(request.buyer.social_username, platform + '.user');
    await edit();
    assert.equal(await field('social_platform').inputValue(), platform, 'Returning from review restores the selected platform');
    assert.equal(await field('social_username').inputValue(), platform + '.user', 'Only social fields are trimmed in the saved checkout');
    await field('social_platform').selectOption('');
    assert.equal(await field('social_username').isDisabled(), true);
    assert.equal(await field('social_username').inputValue(), '');
    assert.equal(await field('social_username').evaluate(node => node.required), false);
    assert.equal(await page.locator('#checkout-form').evaluate(form => new FormData(form).has('social_username')), false);
  }

  await field('social_platform').selectOption('facebook');
  await field('social_username').fill('N/A');
  await review();
  assert.equal((await calls('quote')).at(-1).payload.buyer.social_username, 'N/A');
  await edit();
  await field('social_platform').selectOption('instagram');
  assert.equal(await field('social_username').inputValue(), 'N/A', 'Typed N/A is preserved between Facebook and Instagram');
  await field('social_platform').selectOption('na');
  assert.equal(await field('social_username').isEnabled(), true);
  assert.equal(await field('social_username').evaluate(node => node.readOnly), true);
  assert.equal(await field('social_username').inputValue(), 'N/A');
  assert.deepEqual(await page.locator('#checkout-form').evaluate(form => {
    const data = new FormData(form);
    return [data.get('social_platform'), data.get('social_username')];
  }), ['na', 'N/A'], 'Readonly N/A remains part of form submission');
  await field('social_platform').selectOption('facebook');
  assert.equal(await field('social_username').inputValue(), '', 'Automatic N/A is cleared when a real platform is chosen');
  await assertRejected('social_username', '');
  await field('social_platform').selectOption('na');

  for (const invalid of ['call me tomorrow', '0917hello0000', '123456', '1234567890123456', '0917+0000000', '0917/000/0000']) await assertRejected('buyer_phone', invalid);
  for (const valid of ['09170000000', '+63 917 000 0000', '(02) 8123-4567', '0917-000-0000']) {
    await field('buyer_phone').fill(valid);
    await review();
    assert.equal((await calls('quote')).at(-1).payload.buyer.phone, valid);
    assert.equal((await calls('quote')).at(-1).payload.buyer.social_username, 'N/A');
    await assertPickup('#checkout-dialog .pickup-text', [pickup.pickup_address]);
    await edit();
  }

  await page.locator('#back-to-menu').click();
  await page.locator('[data-method="delivery"]').click();
  await page.locator('#checkout-button').click();
  await field('recipient_name').fill('Local Recipient');
  await field('locality').selectOption('Quezon City / Sample Barangay');
  await field('line1').fill('456 Example Street');
  for (const invalid of ['recipient number', '0917abc0000', '123456', '1234567890123456']) await assertRejected('recipient_phone', invalid);
  for (const valid of ['+63 917 000 0001', '(02) 8123-4567', '0917-000-0001']) {
    await field('recipient_phone').fill(valid);
    await review();
    const request = (await calls('quote')).at(-1).payload;
    assert.equal(request.recipient.phone, valid);
    assert.equal(request.method, 'delivery');
    assert.match(await page.locator('#place-order').textContent(), /230\.00/);
    await edit();
  }

  await page.locator('#back-to-menu').click();
  await page.locator('[data-method="pickup"]').click();
  await page.locator('#checkout-button').click();
  assert.equal(await field('social_platform').inputValue(), 'na');
  assert.equal(await field('social_username').isEnabled(), true);
  assert.equal(await field('social_username').evaluate(node => node.readOnly), true);
  assert.equal(await field('social_username').inputValue(), 'N/A');
  await page.setViewportSize({ width: 390, height: 844 });
  await assertPickup('#checkout-form .pickup-text', Object.values(pickup));
  const overflow = await page.locator('#checkout-form .pickup-text').evaluateAll(nodes => nodes.some(node => node.scrollWidth > node.clientWidth + 1));
  assert.equal(overflow, false, 'Pickup text must wrap within the mobile checkout');
  if (process.env.UI_SCREENSHOT_DIR) {
    await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.UI_SCREENSHOT_DIR, 'checkout-feedback-mobile.png'), fullPage: true });
  }
  await review();
  await page.locator('#place-order').click();
  await page.locator('.order-title h1').waitFor();
  assert.equal((await calls('create_order')).length, 1);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), fixtureKey);
  assert.equal(saved.buyer.social_platform, 'na');
  assert.equal(saved.buyer.social_username, 'N/A');
  assert.equal(saved.method, 'pickup');
  assert.equal(saved.recipient, null, 'Switching to pickup must not submit stale delivery contact data');
  assert.equal(saved.total_cents, 13000);
  await assertPickup('.info-grid .pickup-text', Object.values(pickup));
  await page.reload({ waitUntil: 'networkidle' });
  await assertPickup('.info-grid .pickup-text', Object.values(pickup));
  assert.equal(await page.locator('.order-title h1').textContent(), 'LOCAL-CHECKOUT-TEST');
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, [], 'Production services must never be contacted');
  console.log('PASS: real pickup/delivery checkout; buyer and recipient number validation; no invalid quote/order requests; required social contact, typed and selected N/A, switching, restoration, and payload; exact pickup newlines and literal HTML on checkout, review, and saved/reloaded order; local API only.');
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
