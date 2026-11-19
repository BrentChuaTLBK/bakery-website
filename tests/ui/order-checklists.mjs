import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { completeClientFixture } from '../helpers/client-fixture.mjs';
import { selectDashboardSection } from '../helpers/dashboard-nav.mjs';

const require = createRequire(import.meta.url);
const {chromium, webkit, devices} = require(process.env.PLAYWRIGHT_PACKAGE_ROOT
  ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const origin = 'https://order-checklists.test';
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const day = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);

function order(reference, offset, changes = {}) {
  return {
    id: reference.toLowerCase(), reference, method: 'pickup', date: day(offset), status: 'confirmed',
    buyer: {name: 'Mira Sample', phone: '09170001111'}, instructions: 'Write “Mira <3” in icing.',
    items: [{name: 'Cocoa cake', quantity: 2, selection_labels: [{group: 'Filling', label: 'Salted caramel', quantity: 1}]}],
    window: '10 AM to 3 PM', total_cents: 129900, photo_share: 'PRIVATE-PHOTO-TOKEN',
    ...changes,
  };
}

const orders = [
  order('PICK-ONE', 0), order('PICK-NEXT', 1),
  order('DROP-NEXT', 1, {
    method: 'delivery', status: 'preparing', buyer: {name: 'Buyer Sample'},
    recipient: {name: 'Rae Recipient', phone: '09170002222'},
    address: {line1: '23 Sample Street', locality: 'Quezon City', postal_code: '1100'},
  }),
  order('PREPARED', 0, {status: 'ready_for_pickup'}),
  order('ON-THE-WAY', 0, {method: 'delivery', status: 'out_for_delivery'}),
  order('YESTERDAY', -1), order('OUTSIDE', 2), order('DONE', 0, {status: 'completed'}),
  order('LONG-RANGE-END', 63),
];

const client = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const mock = completeClientFixture(client, `
  export const configured=true, ready=Promise.resolve();
  export const auth={getSession:async()=>({data:{session:{user:{id:'staff'}}}}),onAuthStateChange:()=>{}};
  export const api=(action,payload={})=>window.fixtureApi(action,payload);
  export async function websiteVisitorStats(){return {};}
  ${client.slice(client.indexOf('export function money('))}
`);
const mime = {'.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'};
const iphone = process.env.BROWSER_ENGINE === 'webkit';
const browser = await (iphone ? webkit : chromium).launch({
  headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
});

try {
  const device = iphone ? devices['iPhone 15 Pro Max'] : {viewport: {width: 390, height: 844}};
  const context = await browser.newContext({...device, serviceWorkers: 'block'});
  const calls = [], errors = [];
  let failFrom;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/assets/ordering/client.js') return route.fulfill({contentType: 'text/javascript', body: mock});
    try {
      return await route.fulfill({contentType: mime[extname(url.pathname)] || 'application/octet-stream', body: await readFile(join(root, url.pathname))});
    } catch { return route.fulfill({status: 404, body: ''}); }
  });
  await context.exposeFunction('fixtureApi', (action, payload) => {
    calls.push({action, payload});
    if (action === 'admin_bootstrap') return {
      role: 'staff', categories: [], products: [], orders: [], inventory: [], zones: [], promos: [], staff: [],
      settings: {shop_name: 'The Little Baker Kitchen', paused: false},
    };
    if (action === 'calendar_list') {
      const {from, to} = payload;
      assert.ok(from <= to && Date.parse(to) - Date.parse(from) <= 62 * 86400000);
      if (from === failFrom) throw Error('Fixture could not load this date range.');
      return {orders: orders.filter(row => row.date >= from && row.date <= to), connection: {connected: false}};
    }
    throw new Error('Unexpected checklist API action: ' + action);
  });
  await context.addInitScript(() => {
    window.printedSheets = [];
    window.print = () => {
      const sheet = document.querySelector('#order-checklist-print .order-checklist-sheet');
      if (!sheet) throw Error('Checklist was missing when print was requested');
      const rows = [...sheet.querySelectorAll('.checklist-order')];
      window.printedSheets.push({
        title: sheet.querySelector('h1').textContent,
        references: rows.map(row => row.dataset.orderReference),
        checkboxes: rows.map(row => row.querySelectorAll('.checklist-tick').length),
        text: sheet.textContent, markup: sheet.innerHTML,
        visibleTicks: rows.every(row => {
          const box = row.querySelector('.checklist-tick').getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        }),
        dashboardHidden: !document.querySelector('#workspace').getClientRects().length,
      });
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(8000);
  await page.goto(origin + '/manage.html');
  await selectDashboardSection(page, 'orders');
  await page.locator('summary').filter({hasText: 'Print checklists'}).click();
  const submit = page.getByRole('button', {name: 'Print checklist', exact: true});
  const panel = page.locator('details').filter({has: submit}).first();
  const type = panel.locator('[name=checklist_type]');
  const readCalls = () => calls.filter(call => call.action === 'calendar_list').map(call => call.payload);

  async function selectDate(name, value) {
    const control = panel.locator('.accounting-date-picker').filter({has: page.locator(`[name="${name}"]`)});
    await control.locator('summary').click();
    await control.locator('[data-date-year]').fill(value.slice(0, 4));
    await control.locator('[data-date-year]').press('Tab');
    await control.locator('[data-date-month]').selectOption(value.slice(5, 7));
    await control.locator(`[data-date-value="${value}"]`).click();
    assert.equal(await control.locator(`[name="${name}"]`).inputValue(), value);
  }

  async function print(kind, references, verifyInk = false) {
    await type.selectOption(kind);
    await submit.click({trial: true});
    const count = await page.evaluate(() => window.printedSheets.length);
    if (verifyInk) await page.emulateMedia({media: 'print'});
    try {
      if (verifyInk) await page.locator('[data-checklist-print]').evaluate(button => button.click());
      else if (iphone) await submit.tap();
      else await submit.click();
      await page.waitForFunction(previous => window.printedSheets.length === previous + 1, count);
      const sheet = await page.evaluate(() => window.printedSheets.at(-1));
      assert.equal(sheet.title.toLowerCase(), kind + ' checklist');
      assert.deepEqual(sheet.references.toSorted(), references.toSorted());
      assert.ok(sheet.checkboxes.every(number => number === 1));
      assert.doesNotMatch(sheet.markup, /PRIVATE-|₱/);
      if (verifyInk) {
        assert.ok(sheet.visibleTicks, 'Each order has a visible box on paper');
        assert.ok(sheet.dashboardHidden, 'The staff navigation is hidden on paper');
      }
      return sheet;
    } finally {
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      if (verifyInk) await page.emulateMedia({media: 'screen'});
    }
  }

  await selectDate('checklist_from', today);
  assert.equal(await panel.locator('[name=checklist_to]').inputValue(), '');
  const single = await print('preparation', ['PICK-ONE']);
  assert.deepEqual(readCalls().at(-1), {from: today, to: today});
  for (const detail of ['Cocoa cake', 'Salted caramel', 'Mira Sample', 'Mira <3']) assert.ok(single.text.includes(detail), detail);
  await selectDate('checklist_to', day(1));
  await print('preparation', ['PICK-ONE', 'PICK-NEXT', 'DROP-NEXT'], true);
  const rangeReads = readCalls().length;
  await print('pickup', ['PICK-ONE', 'PICK-NEXT', 'PREPARED']);
  const delivery = await print('delivery', ['DROP-NEXT', 'ON-THE-WAY']);
  for (const detail of ['Rae Recipient', '09170002222', '23 Sample Street', 'Quezon City']) assert.ok(delivery.text.includes(detail), detail);
  assert.deepEqual(readCalls().at(-1), {from: today, to: day(1)});
  assert.equal(readCalls().length, rangeReads, 'Changing checklist type reuses the selected date range');

  const printed = await page.evaluate(() => window.printedSheets.length);
  failFrom = day(63);
  await selectDate('checklist_to', day(63));
  const retry = panel.getByRole('button', {name: 'Try again'});
  await retry.waitFor();
  assert.ok(await submit.isDisabled());
  assert.equal(await page.evaluate(() => window.printedSheets.length), printed, 'A failed second batch must not print a partial checklist');
  failFrom = undefined;
  const splitAt = readCalls().length;
  await retry.click();
  await print('preparation', ['PICK-ONE', 'PICK-NEXT', 'DROP-NEXT', 'OUTSIDE', 'LONG-RANGE-END']);
  assert.deepEqual(readCalls().slice(splitAt), [{from: today, to: day(62)}, {from: day(63), to: day(63)}]);
  await selectDate('checklist_from', day(62));
  await selectDate('checklist_to', day(62));
  await panel.getByText(/no .*orders|no .*match/i).last().waitFor();
  assert.ok(await submit.isDisabled(), 'An empty range cannot be printed');
  const reads = readCalls().length;
  await selectDate('checklist_to', today);
  assert.ok(await submit.isDisabled(), 'A reversed range cannot be printed');
  assert.equal(readCalls().length, reads, 'A reversed range must not fetch orders');
  assert.equal(await page.evaluate(() => window.printedSheets.length), printed + 1);
  assert.deepEqual(errors, []);
  console.log('PASS staff preparation, pickup and delivery checklists, inclusive dates, paper checkboxes, complete range reads, and empty/error handling');
} finally {
  await browser.close();
}
