import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..'), origin = 'https://sales-chart.test';
const output = join(root, 'test-results/sales-chart');
const order = (id, day, total, extra = {}) => ({ id, reference: 'TLB-A2B3C4', created_at: `2026-09-${day}T01:00:00Z`, fulfillment_date: '2026-09-25', payment_status: 'paid', fulfillment_status: 'confirmed', method: 'pickup', total_cents: total, subtotal_cents: total, delivery_cents: 0, discount_cents: 0, buyer: {name:'Fixture'}, items: [], ...extra });
const data = { role:'owner', products:[], categories:[], orders:[order('one','01',100000),order('two','01',23456),order('last','24',987654),order('unpaid','01',999999,{payment_status:'under_review'}),order('refund','01',999999,{refund_label:true})], inventory:[], zones:[], staff:[], promos:[], settings:{paused:false} };
const client = await readFile(join(root, 'assets/ordering/client.js'), 'utf8');
const helpers = client.slice(client.indexOf('export function money('));
const mock = `export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
export async function api(action){if(action==='admin_bootstrap')return ${JSON.stringify(data)};throw Error('Unexpected '+action)}
export async function upload(){throw Error('Unexpected upload')} export async function websiteVisitorStats(){return {}};${helpers}`;
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
await mkdir(output, {recursive:true});
const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH || undefined,headless:true});
try {
  for (const width of [1440,390,320]) {
    const touch = width < 500;
    const context = await browser.newContext({viewport:{width,height:1000},hasTouch:touch,isMobile:touch,serviceWorkers:'block'});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/assets/ordering/client.js') return route.fulfill({contentType:'text/javascript',body:mock});
      const file = resolve(root,'.'+url.pathname);
      if (!file.startsWith(root+sep)) return route.abort();
      try { return await route.fulfill({body:await readFile(file),contentType:mime[extname(file)] || 'application/octet-stream'}); }
      catch { return route.fulfill({status:404,body:''}); }
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({time:Date.parse('2026-09-24T04:00:00Z')});
    await page.goto(origin+'/manage.html');
    await page.locator('[data-view="analytics"]').click();
    const bars = page.locator('.analytics-chart-point'), popup = page.locator('.analytics-chart-tooltip');
    const inspect = async (index, amount, date, orders) => {
      const bar = bars.nth(index);
      await bar.scrollIntoViewIfNeeded();
      if (touch) await bar.tap({position:{x:5,y:130}});
      else await bar.hover({position:{x:5,y:130}});
      await popup.waitFor({state:'visible'});
      assert.equal(await popup.locator('[data-chart-sales]').textContent(), amount);
      assert.match(await popup.locator('[data-chart-period]').textContent(), date);
      assert.equal(await popup.locator('[data-chart-orders]').textContent(), orders);
      const box = await popup.boundingBox();
      assert.ok(box.x >= 0 && box.x+box.width <= width+1, 'Popup stays inside the screen');
    };
    assert.equal(await bars.count(),24);
    assert.equal(await popup.isVisible(),false);
    await inspect(0,'₱1,234.56',/Sep 1, 2026/,'2 paid orders');
    if (!touch) {
      await page.locator('.analytics-trend h2').hover();
      assert.equal(await popup.isVisible(),false);
    } else {
      await page.waitForTimeout(150);
      assert.equal(await popup.isVisible(),true,'Tap keeps the amount visible');
      await bars.first().tap({position:{x:5,y:130}});
      assert.equal(await popup.isVisible(),false,'A second tap dismisses the amount');
    }
    await inspect(1,'₱0.00',/Sep 2, 2026/,'0 paid orders');
    await inspect(23,'₱9,876.54',/Sep 24, 2026/,'1 paid order');
    await page.locator('.analytics-trend').screenshot({path:join(output,`sales-${width}.png`)});
    if (touch) await page.locator('.analytics-trend h2').tap();
    else await page.locator('.analytics-trend h2').click();
    assert.equal(await popup.isVisible(),false,'Outside activation dismisses');
    await bars.nth(22).scrollIntoViewIfNeeded();
    await bars.nth(22).focus();
    await popup.waitFor({state:'visible'});
    assert.equal(await popup.locator('[data-chart-sales]').textContent(),'₱0.00');
    await page.keyboard.press('Tab');
    assert.equal(await popup.locator('[data-chart-sales]').textContent(),'₱9,876.54','Keyboard navigation updates the amount');
    await page.keyboard.press('Escape');
    assert.equal(await popup.isVisible(),false);
    await page.locator('#analytics-period').selectOption('last7');
    assert.equal(await bars.count(),7);
    await inspect(6,'₱9,876.54',/Sep 24, 2026/,'1 paid order');
    await page.locator('[data-view="overview"]').click();
    await page.locator('[data-view="analytics"]').click();
    await inspect(6,'₱9,876.54',/Sep 24, 2026/,'1 paid order');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'No page overflow');
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px: ${touch?'native touch':'hover'}, exact paid sales, zero sales, edge positioning, keyboard, filters and remount`);
    await context.close();
  }
} finally { await browser.close(); }
