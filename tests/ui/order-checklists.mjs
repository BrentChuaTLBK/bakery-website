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
    id: reference.toLowerCase(), reference, source: 'website', method: 'pickup', date: day(offset), status: 'confirmed', payment_status:'paid',
    pickup_address: 'Fixture pickup counter',
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
  order('UNPAID', 0, {status:'pending_confirmation', payment_status:'awaiting_payment'}),
  order('CANCELLED', 0, {status:'cancelled', payment_status:'cancelled'}),
  order('EXPIRED', 0, {status:'expired', payment_status:'awaiting_payment'}),
  order('REFUND', 0, {status:'completed', refund_label:true}),
  order('POPUP', 0, {source:'popup', status:'completed'}),
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
    if (action === 'calendar_list' || action === 'order_checklist_period') {
      const {from, to} = payload;
      assert.ok(from <= to && Date.parse(to) - Date.parse(from) <= 62 * 86400000);
      if (from === failFrom) throw Error('Fixture could not load this date range.');
      const matching = orders.filter(row => row.date >= from && row.date <= to);
      if (action === 'order_checklist_period') return {orders:matching};
      return {orders:matching.filter(row=>row.payment_status==='paid' && !row.refund_label && row.source!=='popup'), connection:{connected:false}};
    }
    throw new Error('Unexpected checklist API action: ' + action);
  });
  await context.addInitScript(() => {
    window.printCalls = 0;
    window.print = () => { window.printCalls++; };
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
  const readCalls = action => calls.filter(call => action ? call.action===action : ['calendar_list','order_checklist_period'].includes(call.action)).map(call => call.payload);
  let previews = 0;
  context.on('page', p => { previews++; p.on('pageerror', error=>errors.push(error.message)); });

  async function selectDate(name, value) {
    const control = panel.locator('.accounting-date-picker').filter({has: page.locator(`[name="${name}"]`)});
    await control.locator('summary').click();
    await control.locator('[data-date-year]').fill(value.slice(0, 4));
    await control.locator('[data-date-year]').press('Tab');
    await control.locator('[data-date-month]').selectOption(value.slice(5, 7));
    await control.locator(`[data-date-value="${value}"]`).click();
    assert.equal(await control.locator(`[name="${name}"]`).inputValue(), value);
  }

  async function print(kind, references, verifyPaper = false) {
    await type.selectOption(kind);
    const [preview]=await Promise.all([context.waitForEvent('page'),iphone ? submit.tap() : submit.click()]);
    try {
      await preview.waitForURL(url=>url.pathname.endsWith('/order-checklist-preview.html'));
      const sheet=preview.locator('#order-checklist-print .order-checklist-sheet');
      const printButton=preview.getByRole('button',{name:'Print',exact:true});
      await sheet.locator('.checklist-order').first().waitFor();
      const title=(await sheet.getByRole('heading',{level:1}).innerText()).toLowerCase();
      assert.equal(title,kind+' checklist');
      const refs=()=>sheet.locator('[data-order-reference]').evaluateAll(rows=>rows.map(row=>row.dataset.orderReference).sort());
      assert.deepEqual(await refs(),references.toSorted());
      if (kind==='orders') {
        const included=orders.filter(order=>references.includes(order.reference));
        const expected=[...new Set(included.map(order=>order.date))].sort().map(date=>{
          const forDay=included.filter(order=>order.date===date);
          return [
            ['Pickup',forDay.filter(order=>order.source!=='popup' && order.method==='pickup')],
            ['Delivery',forDay.filter(order=>order.source!=='popup' && order.method==='delivery')],
            ['In-person sales',forDay.filter(order=>order.source==='popup')],
          ].filter(([,rows])=>rows.length).map(([label,rows])=>[label,rows.map(row=>row.reference).sort()]);
        });
        const groups=await sheet.locator('table.checklist-day').evaluateAll(tables=>tables.map(table=>
          [...table.tBodies].map(body=>[body.querySelector('th[scope=rowgroup]').textContent.trim(),
            [...body.querySelectorAll('[data-order-reference]')].map(row=>row.dataset.orderReference).sort()])));
        assert.deepEqual(groups,expected,'Each print date separates pickup, delivery and in-person sales under their own headings');
      }
      assert.ok(await sheet.locator('.checklist-tick').first().isVisible(),'Preview has visible content before printing');
      assert.equal(await sheet.locator('.checklist-tick').count(),references.length);
      const markup=await sheet.innerHTML();
      const text=await sheet.innerText();
      assert.doesNotMatch(markup,/PRIVATE-|₱/);
      if (iphone) await printButton.tap(); else await printButton.click();
      assert.equal(await preview.evaluate(()=>window.printCalls),1,'The preview button calls native print');
      if (verifyPaper) {
        await preview.emulateMedia({media:'print'});
        assert.ok(await printButton.isHidden(),'The toolbar is hidden on paper');
        assert.ok(await sheet.locator('.checklist-tick').evaluateAll(ticks=>ticks.every(t=>{
          const box=t.getBoundingClientRect();return box.width>0 && box.height>0;
        })),'Each order still has a visible check box in print media');
        await preview.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
        assert.deepEqual(await refs(),references.toSorted(),'Safari can still render the sheets after an early afterprint event');
        await preview.emulateMedia({media:'screen'});
        if (iphone) await printButton.tap(); else await printButton.click();
        assert.equal(await preview.evaluate(()=>window.printCalls),2,'Printing can be retried from the same preview');
        if (kind==='orders') {
          failFrom=new URL(preview.url()).searchParams.get('from');
          try {
            await preview.reload();
            await preview.getByRole('status').filter({hasText:/couldn’t load/i}).waitFor();
            assert.ok(await printButton.isDisabled(),'An unavailable preview cannot print a blank sheet');
          } finally { failFrom=undefined; }
          await preview.reload();
          await sheet.locator('.checklist-order').first().waitFor();
          assert.deepEqual(await refs(),references.toSorted(),'Reloading the preview reconstructs the same full checklist');
        }
      }
      return {markup,text};
    } finally {
      await preview.close();
      await page.bringToFront();
    }
  }

  await selectDate('checklist_from', today);
  assert.equal(await panel.locator('[name=checklist_to]').inputValue(), '');
  const allToday=['PICK-ONE','DONE','UNPAID','CANCELLED','EXPIRED','REFUND','POPUP','PREPARED','ON-THE-WAY'];
  const single = await print('orders', allToday, true);
  assert.deepEqual(readCalls('order_checklist_period').at(-1), {from: today, to: today});
  for (const detail of ['Cocoa cake', 'Salted caramel', 'Mira Sample', 'Mira <3']) assert.ok(single.text.includes(detail), detail);
  await selectDate('checklist_to', day(1));
  await print('orders', [...allToday,'PICK-NEXT','DROP-NEXT']);
  const pickup=await print('pickup', ['PICK-ONE', 'PICK-NEXT', 'PREPARED'], true);
  assert.doesNotMatch(pickup.text,/pickup point|fixture pickup counter/i);
  assert.match(pickup.text,/09170001111/);
  assert.match(pickup.text,/10 AM to 3 PM/);
  const delivery = await print('delivery', ['DROP-NEXT', 'ON-THE-WAY']);
  for (const detail of ['Rae Recipient', '09170002222', '23 Sample Street', 'Quezon City']) assert.ok(delivery.text.includes(detail), detail);
  assert.deepEqual(readCalls('calendar_list').at(-1), {from: today, to: day(1)});

  await type.selectOption('orders');
  const printed = previews;
  failFrom = day(63);
  await selectDate('checklist_to', day(63));
  const retry = panel.getByRole('button', {name: 'Try again'});
  await retry.waitFor();
  assert.ok(await submit.isDisabled());
  assert.equal(previews,printed,'A failed second batch must not open a partial preview');
  failFrom = undefined;
  const splitAt = readCalls().length;
  await retry.click();
  await print('orders', [...allToday,'PICK-NEXT','DROP-NEXT','OUTSIDE','LONG-RANGE-END']);
  const batches=[{from:today,to:day(62)},{from:day(63),to:day(63)}];
  assert.deepEqual(readCalls().slice(splitAt,splitAt+2),batches,'The dashboard retrieves the entire range');
  assert.deepEqual(readCalls('order_checklist_period').slice(-2),batches,'The independent preview retrieves both batches');
  await selectDate('checklist_from', day(62));
  await selectDate('checklist_to', day(62));
  await panel.getByText(/no .*orders|no .*match/i).last().waitFor();
  assert.ok(await submit.isDisabled(), 'An empty range cannot be printed');
  const reads = readCalls().length;
  await selectDate('checklist_to', today);
  assert.ok(await submit.isDisabled(), 'A reversed range cannot be printed');
  assert.equal(readCalls().length, reads, 'A reversed range must not fetch orders');
  assert.equal(previews, printed + 1);
  assert.deepEqual(errors, []);
  console.log('PASS all statuses on the order checklist, separate handoffs, mobile print preview and retries, inclusive dates and complete range reads');
} finally {
  await browser.close();
}
