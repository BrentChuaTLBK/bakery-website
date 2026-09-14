// Regression test for optional product labels. All authentication and API calls
// are mocked locally; external requests are blocked before browser navigation.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const fixtureKey = 'tlb-product-label-test-fixture';
const originalOptions = [{ id: 'flavor', label: 'Choose your flavor', required_count: 1, choices: [{ id: 'classic', label: 'Classic', surcharge_cents: 0, active: true }, { id: 'matcha', label: 'Matcha', surcharge_cents: 3000, active: true }] }];
const product = (id, name, extra = {}) => ({ id, name, description: 'Local browser test fixture.', category_id: null, price_cents: 13000, min_quantity: 1, lead_days: 1, active: true, photos: [], option_groups: [], sort_order: 0, ...extra });
const fixtures = {
  role: 'owner',
  products: [
    product('options', 'Cookie box', { option_groups: originalOptions }),
    product('plain', 'Plain product', { label: { enabled: true, text: 'Best seller', color: '#ffffff' } }),
    product('disabled', 'Disabled label', { label: { enabled: false, text: 'Should not show', color: '#000000' } }),
    product('blank', 'Blank label', { label: { enabled: true, text: '   ', color: '#000000' } }),
    product('wrong-type', 'Nonboolean flag', { label: { enabled: 'true', text: 'Should not show', color: '#000000' } }),
    product('untrusted', 'Untrusted label', { label: { enabled: true, text: '<img src=x onerror=alert(1)>', color: '#fff;position:fixed' } }),
    product('long', 'Long label', { label: { enabled: true, text: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM', color: '#ffff00' } }),
  ],
  categories: [], inventory: [], promos: [], zones: [], orders: [], email_status: [],
  settings: { paused: true, shop_name: 'Local fixture', production_weekdays: [0, 1, 2, 3, 4, 5, 6], fulfillment_weekdays: [0, 1, 2, 3, 4, 5, 6], nonproduction_dates: [], blocked_dates: [], delivery_window: '9:00 AM – 6:00 PM', reminders_enabled: false },
};
// Retain production formatting/escaping helpers without importing its network
// initialization. The mock rejects every action outside this test's allowlist.
const realClient = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const helpers = realClient.slice(realClient.indexOf('export function money('));
assert.ok(helpers.startsWith('export function money('));
const mockClient = `
export const configured = true;
export const ready = Promise.resolve();
export const auth = {
  getSession: async () => ({ data: { session: { user: { id: 'local-owner', email: 'owner@example.test' } } }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
};
const fixtureKey = ${JSON.stringify(fixtureKey)};
const initial = ${JSON.stringify(fixtures)};
function read() { return JSON.parse(localStorage.getItem(fixtureKey) || JSON.stringify(initial)); }
export async function api(action, payload = {}) {
  const data = read();
  if (action === 'admin_bootstrap' || action === 'catalog') return structuredClone(data);
  if (action === 'save_product') {
    const saved = structuredClone(payload.product);
    if (!saved.id) saved.id = 'local-new-product';
    const index = data.products.findIndex(p => p.id === saved.id);
    if (index < 0) data.products.push(saved); else data.products[index] = saved;
    localStorage.setItem(fixtureKey, JSON.stringify(data));
    return saved;
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
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push('Unexpected browser dialog: ' + dialog.message()); dialog.dismiss(); });
  const openEditor = async () => {
    await page.locator('[data-view="products"]').first().click();
    await page.locator('[data-action="edit-product"][data-id="options"]').click();
    await page.locator('[name="label_enabled"]').waitFor();
  };
  const setColor = async value => page.locator('[name="label_color"]').evaluate((node, color) => { node.value = color; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  const save = async () => {
    await page.locator('[data-form="product"] button[type="submit"]').click();
    await page.locator('#admin-dialog').waitFor({ state: 'hidden' });
  };
  const savedProduct = async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).products.find(p => p.id === 'options'), fixtureKey);
  const openShop = async () => { await page.goto(origin + '/shop.html', { waitUntil: 'networkidle' }); await page.locator('[data-product="options"]').waitFor(); };

  // Both existing products and new products start with labels off.
  await page.goto(origin + '/manage.html', { waitUntil: 'networkidle' });
  await openEditor();
  assert.equal(await page.locator('[name="label_enabled"]').isChecked(), false);
  assert.equal(await page.locator('[name="label_text"]').isDisabled(), true);
  assert.equal(await page.locator('[name="label_color"]').isDisabled(), true);
  assert.equal(await page.locator('[data-label-preview]').isVisible(), false);
  assert.equal(await page.locator('[name="label_text"]').getAttribute('maxlength'), '32');
  await page.locator('#dialog-close').click();
  await page.locator('[data-action="new-product"]').first().click();
  assert.equal(await page.locator('[name="label_enabled"]').isChecked(), false);
  await page.locator('#dialog-close').click();
  await openEditor();

  // Label editing remains independent of flavor configuration, including
  // capture/rerender when choices are added or removed before saving.
  await page.locator('[name="label_enabled"]').check();
  await page.locator('[name="label_text"]').fill('   ');
  assert.equal(await page.locator('[name="label_text"]').evaluate(node => node.checkValidity()), false, 'An enabled label requires nonblank text');
  await page.locator('[name="label_text"]').fill('  Chef\'s pick  ');
  assert.equal(await page.locator('[name="label_text"]').evaluate(node => node.checkValidity()), true);
  await setColor('#336699');
  assert.equal((await page.locator('[data-label-preview].product-label').textContent()).trim(), "Chef's pick");
  await page.locator('[data-action="add-choice"][data-index="0"]').click();
  assert.equal((await page.locator('[name="label_text"]').inputValue()).trim(), "Chef's pick");
  assert.equal(await page.locator('[name="label_color"]').inputValue(), '#336699');
  await page.locator('[data-action="remove-choice"][data-group="0"][data-index="2"]').click();
  await save();
  let saved = await savedProduct();
  assert.deepEqual(saved.label, { enabled: true, text: "Chef's pick", color: '#336699' });
  assert.deepEqual(saved.option_groups, originalOptions);
  await page.reload({ waitUntil: 'networkidle' });
  await openEditor();
  assert.equal(await page.locator('[name="label_enabled"]').isChecked(), true);
  assert.equal(await page.locator('[name="label_text"]').inputValue(), "Chef's pick");
  assert.equal(await page.locator('[name="label_color"]').inputValue(), '#336699');
  await page.locator('#dialog-close').click();

  // The storefront renders saved labels even without options, suppresses
  // disabled/blank/nonboolean labels, and treats label content as plain text.
  await openShop();
  assert.equal(await page.locator('[data-product="options"] .product-label').textContent(), "Chef's pick");
  assert.equal(await page.locator('[data-product="plain"] .product-label').textContent(), 'Best seller');
  for (const id of ['disabled', 'blank', 'wrong-type']) assert.equal(await page.locator(`[data-product="${id}"] .product-label`).count(), 0);
  const untrusted = page.locator('[data-product="untrusted"] .product-label');
  assert.equal(await untrusted.locator('img').count(), 0);
  assert.equal(await untrusted.textContent(), '<img src=x onerror=alert(1)>');
  assert.ok(!(await untrusted.getAttribute('style')).includes('position:fixed'));
  assert.equal(await page.getByText('Make it yours', { exact: true }).count(), 0);

  const colors = await page.locator('#product-grid .product-label').evaluateAll(labels => labels.map(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, foreground: s.color }; }));
  assert.equal(colors.length, 4, 'Contrast must be checked on the four expected labels');
  const luminance = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  for (const { background, foreground } of colors) {
    const a = luminance(background), b = luminance(foreground);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `Insufficient contrast: ${foreground} on ${background}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  const labelOverflows = await page.locator('#product-grid .product-label').evaluateAll(labels => labels.filter(el => { const a = el.getBoundingClientRect(), b = el.closest('.product-image').getBoundingClientRect(); return a.right > b.right + 1 || a.left < b.left - 1; }).length);
  assert.equal(labelOverflows, 0, 'Labels should fit inside narrow product images');
  if (process.env.UI_SCREENSHOT_DIR) {
    await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.UI_SCREENSHOT_DIR, 'product-labels-mobile.png'), fullPage: true });
  }

  // Disabling preserves the saved customization and does not disable choices.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/manage.html', { waitUntil: 'networkidle' });
  await openEditor();
  await page.locator('[name="label_enabled"]').uncheck();
  assert.equal(await page.locator('[name="label_text"]').isDisabled(), true);
  assert.equal(await page.locator('[name="label_color"]').isDisabled(), true);
  assert.equal(await page.locator('[data-label-preview]').isVisible(), false);
  await save();
  saved = await savedProduct();
  assert.deepEqual(saved.label, { enabled: false, text: "Chef's pick", color: '#336699' });
  assert.deepEqual(saved.option_groups, originalOptions);
  await openShop();
  assert.equal(await page.locator('[data-product="options"] .product-label').count(), 0);
  await page.locator('[data-product="options"]').click();
  assert.equal(await page.locator('#product-dialog [data-choice]').count(), 2);
  await page.locator('[data-choice="matcha"]').check();
  assert.match(await page.locator('#detail-price').textContent(), /160\.00/);
  await page.goto(origin + '/manage.html', { waitUntil: 'networkidle' });
  await openEditor();
  await page.locator('[name="label_enabled"]').check();
  assert.equal(await page.locator('[name="label_text"]').inputValue(), "Chef's pick");
  assert.equal(await page.locator('[name="label_color"]').inputValue(), '#336699');
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, [], 'Production service access must never be attempted');
  console.log('PASS: optional labels; manager save/reopen/toggle; options preserved through rerenders; storefront text/color safety, contrast and mobile fit; no live API, orders, or emails.');
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
