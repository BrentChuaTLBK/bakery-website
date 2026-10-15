import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve, extname, sep} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
import {selectDashboardSection} from '../helpers/dashboard-nav.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.PRODUCT_MANAGEMENT_TEST_OUTPUT || join(root, 'tests/artifacts/product-management-mobile'));
const origin = 'https://product-management.test';
const photos = {
  cookies: 'assets/pastries/CookieBottle/IMG_8639.webp',
  cake: 'assets/pastries/ClassicCakes/Ube Halaya Cake (8).webp',
  choux: 'assets/pastries/AssortedPastries/Box of 6 Choux au Craquelin.webp',
  nori: 'assets/pastries/NoriChips/Small Pouch.webp'
};
const product = (id, name, category, photo, extra = {}) => ({id, name, description: 'Local fixture only', price_cents: 20000,
  min_quantity: 2, lead_days: 2, active: true, sort_order: 0, category_id: category, category_ids: [category], option_groups: [],
  photos: photo ? [origin + '/' + photo] : [], ...extra});
const initial = {
  categories: [{id: 'cookies', name: 'Cookie jars & gifts'}, {id: 'cakes', name: 'Celebration cakes'}, {id: 'pastries', name: 'Pastries & snacks'}],
  products: [product('cookies', 'Butter Cookies (440ml)', 'cookies', photos.cookies),
    product('cake', 'Ube Halaya Cake (8 inches)', 'cakes', photos.cake, {price_cents: 225000, pickup_only: true}),
    product('choux', 'Assorted Choux au Craquelin — Box of 6 with classic and seasonal flavors', 'pastries', photos.choux, {price_cents: 65000}),
    product('nori', 'Nori Chips · Small Pouch', 'pastries', photos.nori, {lead_days: 0, allow_same_day: true, price_cents: 13000}),
    product('hidden', 'Custom celebration cake', 'cakes', '', {active: false, price_cents: 180000})],
  orders: [], inventory: [], promos: [], zones: [], staff: [], email_status: [], settings: {paused: false}
};
const client = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const helpers = client.slice(client.indexOf('export function money('));
const mock = completeClientFixture(client, `export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'fixture-user'}}}}),onAuthStateChange(){}};
const initial=${JSON.stringify(initial)};window.productWriteCalls=[];
export async function api(action,payload={}){if(action==='admin_bootstrap'||action==='catalog')return {...structuredClone(initial),role:window.fixtureRole};window.productWriteCalls.push({action,payload});throw Error('Unexpected API '+action);}
export async function websiteVisitorStats(){return {}};export async function upload(){throw Error('Unexpected upload')};${helpers}`);
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2'};
const assetCache = new Map();
async function projectFile(path) {
  if (assetCache.has(path)) return assetCache.get(path);
  let content;
  try {content = await readFile(join(root, path));}
  catch (error) {
    // Sparse checkouts omit images. Read the same tracked image from Git rather
    // than reaching a live image host or expanding the working tree.
    if (!/\.(png|webp|woff2)$/.test(path)) throw error;
    content = execFileSync('git', ['show', `HEAD:${path}`], {cwd: root, maxBuffer: 16000000, stdio: ['ignore', 'pipe', 'ignore']});
  }
  assetCache.set(path, content);
  return content;
}
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined});
const results = [];
try {
  for (const [width, role] of [[320, 'owner'], [390, 'owner'], [760, 'owner'], [1440, 'owner'], [390, 'staff']]) {
    const context = await browser.newContext({viewport: {width, height: 1000}, isMobile: width <= 760, hasTouch: width <= 760, serviceWorkers: 'block'});
    await context.addInitScript(value => {window.fixtureRole = value;}, role);
    const external = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {external.push(url.hostname); return route.abort();}
      if (url.pathname === '/assets/ordering/client.js') return route.fulfill({contentType: 'text/javascript', body: mock});
      if (['/assets/ordering/traffic.js', '/assets/ordering/newsletter.js'].includes(url.pathname)) return route.fulfill({contentType: 'text/javascript', body: ''});
      const file = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + sep)) return route.abort();
      try {return route.fulfill({contentType: mime[extname(file)] || 'application/octet-stream', body: await projectFile(file.slice(root.length + 1).replaceAll('\\', '/'))});}
      catch {return route.fulfill({status: 404, body: ''});}
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => {errors.push('Unexpected native dialog'); return dialog.dismiss();});
    await page.goto(origin + '/manage.html', {waitUntil: 'networkidle'});
    await selectDashboardSection(page, 'products');
    await page.locator('[data-product-card]').first().waitFor();
    const geometry = await page.locator('[data-product-card]').evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect(), photo = card.querySelector('.product-photo').getBoundingClientRect();
      return {x: box.x, width: box.width, height: box.height, photoWidth: photo.width, photoHeight: photo.height,
        actions: [...card.querySelectorAll('.product-card-actions button')].map(button => {const rect = button.getBoundingClientRect(); return {x: rect.x, right: rect.right, y: rect.y, height: rect.height};})};
    }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: no horizontal overflow`);
    for (const card of geometry) {
      assert.ok(card.actions.every(action => action.height >= 44 && action.x >= card.x && action.right <= card.x + card.width + 1), `${width}: comfortable contained action targets`);
      assert.ok(card.actions.every(action => Math.abs(action.y - card.actions[0].y) < 1), `${width}: one aligned action row`);
      if (width <= 760) {assert.equal(card.x, geometry[0].x); assert.ok(card.height < 340, `${width}: compact card height`); assert.equal(card.photoWidth, card.photoHeight);}
    }
    if (width === 1440) assert.equal(new Set(geometry.slice(0, 3).map(card => card.x)).size, 3, 'Desktop retains three columns');
    const imagesLoaded = await page.locator('.product-photo img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0));
    assert.equal(imagesLoaded, true, 'Tracked product photos load from local files');
    await page.screenshot({path: join(output, `products-${width}-${role}.png`), fullPage: true});
    if (role === 'owner') {
      await page.locator('#product-search').fill('Butter');
      assert.equal(await page.locator('[data-product-card]').count(), 1);
      await page.locator('[data-action=clear-product-filters]').click();
      await page.locator('[data-product-filter=category]').selectOption('cakes');
      assert.equal(await page.locator('[data-product-card]').count(), 2);
      await page.locator('[data-product-filter=status]').selectOption('hidden');
      assert.equal(await page.locator('[data-product-card]').count(), 1);
      assert.match(await page.locator('[data-product-card] h3').innerText(), /Custom celebration cake/);
      await page.locator('[data-action=clear-product-filters]').click();
      await page.locator('[data-action=edit-product][data-id=cookies]').click();
      assert.equal(await page.locator('[data-form=product] [name=name]').inputValue(), 'Butter Cookies (440ml)');
      await page.locator('[data-form=product]').getByRole('button', {name: 'Cancel', exact: true}).click();
      await page.locator('[data-action=duplicate-product][data-id=cookies]').click();
      await page.getByRole('heading', {name: 'Duplicate product', exact: true}).waitFor();
      assert.equal(await page.locator('[data-form=product] [name=name]').inputValue(), 'Butter Cookies (440ml) (copy)');
      assert.equal(await page.locator('[data-form=product] [name=active]').isChecked(), false);
      await page.locator('[data-form=product]').getByRole('button', {name: 'Cancel', exact: true}).click();
      await page.locator('[data-action=delete-product][data-id=cookies]').click();
      const confirmation = page.getByRole('dialog', {name: 'Delete product?', exact: true});
      await confirmation.waitFor();
      assert.match(await confirmation.innerText(), /Butter Cookies \(440ml\)/);
      await confirmation.getByRole('button', {name: 'Keep product', exact: true}).click();
      assert.equal(await page.locator('[data-product-card]').count(), 5);
    } else {
      assert.equal(await page.locator('[data-action=duplicate-product]').count(), 0);
      assert.equal(await page.locator('[data-action=delete-product]').count(), 0);
      assert.equal(await page.getByRole('button', {name: 'View Butter Cookies (440ml)', exact: true}).count(), 1);
      await page.getByRole('button', {name: 'View Butter Cookies (440ml)', exact: true}).click();
      assert.equal(await page.locator('[data-form=product] button[type=submit]').isDisabled(), true);
    }
    assert.deepEqual(await page.evaluate(() => window.productWriteCalls), [], 'Inspection, duplicate cancellation and delete cancellation do not write');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    results.push({width, role, passed: true, cardHeights: geometry.map(card => Math.round(card.height))});
    console.log(`PASS ${width}px ${role}: layout, filters, actions, no writes or external requests`);
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
}
