import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { webkit, devices } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT
  ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.PRINT_TEST_OUTPUT || join(root, 'tests/artifacts/order-slips'));
await mkdir(output, { recursive: true });
const origin = 'https://ios-order-preview.test';
const item = (name, quantity, option) => ({ name, quantity, selection_labels: option ? [option] : [] });
const pickup = {
  method: 'pickup', fulfillment_date: '2026-11-20', payment_status: 'paid', fulfillment_status: 'confirmed',
  buyer: { name: 'Sample Customer with a Long Name' },
  pickup_address: '39 Sample Drive, Sample Subdivision, Barangay Example, Quezon City',
  pickup_hours: '10am – 8pm', instructions: 'Use a blue ribbon.\nPack the pouches separately.',
};
const orders = [
  { ...pickup, id:'one',reference:'SAMPLE-ONE',items:[item('Two tier cake',1,'Seven inch cake separation')] },
  { ...pickup, id:'two',reference:'SAMPLE-TWO',items:[item('Nori Langue Set',5)] },
  { ...pickup, id:'three',reference:'SAMPLE-THREE',items:[
    item('Butter Cookie Set',10),item('Nori Pouch',10,'Barbecue'),
    item('Nori Pouch',10,'Sour cream'),item('Nori Pouch',10,'Cheese'),
  ] },
];
const browser = await webkit.launch();
try {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/') {
      return route.fulfill({ contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><button id="show">Open print preview</button>
        <script type="module">import {printOrderSlips} from '/assets/ordering/order-slips.js';
        document.querySelector('#show').onclick=()=>printOrderSlips(${JSON.stringify(orders)});</script>` });
    }
    if (!url.pathname.startsWith('/assets/ordering/')) return route.fulfill({ status:404 });
    const contentType = { '.js':'text/javascript', '.html':'text/html', '.css':'text/css' }[extname(url.pathname)];
    try { return route.fulfill({ contentType, body:await readFile(join(root,url.pathname)) }); }
    catch { return route.fulfill({ status:404 }); }
  });
  const page = await context.newPage();
  await page.goto(origin);
  const pending = page.waitForEvent('popup');
  await page.getByRole('button',{name:'Open print preview'}).click();
  const preview = await pending;
  await preview.locator('.print-slips:enabled').waitFor();
  await preview.locator('#paper-size').selectOption('letter');
  await preview.locator('.print-slips:enabled').waitFor();
  assert.equal(await preview.locator('#paper-size option:checked').textContent(),'Letter portrait');
  assert.match(await preview.locator('[role=status]').textContent(),/portrait/);
  assert.equal(await preview.locator('.print-sheet-frame').count(),1);
  const screen = await preview.locator('.print-sheet-frame').boundingBox();
  assert.ok(screen.height > screen.width);
  assert.ok(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.ok(await preview.locator('.slip,.slip-left,.slip-details').evaluateAll(elements =>
    elements.every(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1)));
  await preview.screenshot({ path:join(output,'iphone-portrait-preview.png'), fullPage:true });
  await preview.emulateMedia({ media:'print' });
  assert.equal(await preview.locator('.slip').first().evaluate(element => element.offsetWidth),480);
  assert.equal(await preview.locator('.slip').first().evaluate(element => element.offsetHeight),384);
  assert.deepEqual(errors,[]);
  console.log('PASS iPhone WebKit preview uses portrait paper and fits the complete slips. Print dimensions remain 5 by 4 inches.');
} finally {
  await browser.close();
}
