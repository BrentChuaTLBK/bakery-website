import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
import {selectDashboardSection} from '../helpers/dashboard-nav.mjs';

const engine = process.env.BROWSER_ENGINE === 'webkit' ? 'webkit' : 'chromium';
const t = await recipeBrowserHarness({engine});
const {h, db, origin} = t;
const client = await readFile('assets/ordering/client.js', 'utf8');
const artifacts = join('test-results', 'website-order-editor');
await mkdir(artifacts, {recursive: true});

async function memberPage(user, width) {
  const {page, context} = await t.pageFor(user, width, {
    hasTouch: width < 760, isMobile: width < 760, serviceWorkers: 'block', viewport: {width, height: 820},
  });
  await context.exposeFunction('websiteFixtureApi', (action, payload, token) =>
    t.run(() => h.api(action, payload, user, token)));
  await context.route('**/assets/ordering/client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: completeClientFixture(client, `
      export const configured=true, ready=Promise.resolve();
      export const auth={getSession:async()=>({data:{session:${JSON.stringify(user ? {user:{id:user}} : null)}}}),onAuthStateChange:()=>{}};
      export const api=(action,payload={},token=null)=>window.websiteFixtureApi(action,payload,token);
      export async function websiteVisitorStats(){return {}}
      ${client.slice(client.indexOf('export function money('))}
    `),
  }));
  await context.route('**/assets/ordering/newsletter.js*', route => route.fulfill({contentType:'text/javascript',body:''}));
  return {page, context};
}

try {
  const staff = h.ids.staff;
  const originalSettings = (await h.api('admin_bootstrap', {}, h.ids.owner)).settings;
  await h.api('save_settings', {settings:{...originalSettings, paused:false, pickup_address:'QA pickup',
    payment_instructions:'QA payment', owner_email:'owner@example.test', contact_email:'owner@example.test',
    site_url:origin}}, h.ids.owner);
  const {product:tart, date} = await h.fixture(20, {name:'Sample tart', price_cents:10000});
  const box = await h.product({name:'Sample gift box', price_cents:12000, option_groups:[{
    id:'flavor', label:'Flavor', required_count:1, choices:[
      {id:'vanilla', label:'Vanilla', active:true, surcharge_cents:0},
      {id:'chocolate', label:'Chocolate', active:true, surcharge_cents:2000},
    ],
  }]});
  await h.inventory(box, date, 20);
  const expired = await h.api('create_order', h.checkout(tart, date));
  const pending = await h.api('create_order', h.checkout(tart, date));
  await db.query("update tlb.orders set payment_deadline=clock_timestamp()-interval '1 minute' where id=$1", [expired.id]);
  await db.query('select tlb.expire_orders()');

  for (const width of engine === 'webkit' ? [430] : [1440, 390, 320]) {
    const original = await h.api('create_order', h.checkout(tart, date));
    const order = await h.action('approve_payment', await h.proof(original));
    const {page, context} = await memberPage(staff, width);
    await page.goto(origin+'/manage.html');
    await selectDashboardSection(page, 'orders');
    const row = id => page.locator('[data-order-row="'+id+'"]');
    const opener = id => row(id).getByRole('button', {name:id===expired.id ? expired.reference : order.reference, exact:true});
    await row(order.id).waitFor();
    assert.equal(await row(expired.id).locator('td').nth(3).innerText(), 'Expired');
    const payment = page.locator('[data-filter="payment"]');
    await payment.selectOption('awaiting_payment');
    assert.equal(await row(expired.id).count(), 0);
    assert.equal(await row(pending.id).count(), 1);
    await payment.selectOption('expired');
    assert.equal(await row(expired.id).count(), 1);
    assert.equal(await row(pending.id).count(), 0);
    await opener(expired.id).click();
    const dialog = page.locator('#admin-dialog');
    await dialog.locator('.order-status-row').waitFor();
    assert.equal(await dialog.locator('.order-status-row .badge').first().innerText(), 'Expired');
    await dialog.locator('#dialog-close').click();
    await payment.selectOption('');

    await opener(order.id).click();
    const edit = dialog.getByRole('button', {name:'Edit order', exact:true});
    await edit.waitFor();
    const editBox = await edit.boundingBox();
    const buyerBox = await dialog.getByRole('heading', {name:'Buyer', exact:true}).boundingBox();
    assert.ok(editBox.y < buyerBox.y, 'Edit order is available at the top of the details');
    await edit.click();
    const form = dialog.locator('[data-form="order-edit"]');
    const products = form.getByRole('region', {name:'Products', exact:true});
    const basket = form.getByRole('region', {name:'Order', exact:true});
    const save = form.getByRole('button', {name:'Save changes', exact:true});
    const openProducts = form.getByRole('button', {name:'Products', exact:true});
    const quantity = basket.getByRole('spinbutton', {name:'Sample tart quantity'});
    await basket.waitFor();
    assert.ok(await save.isVisible());
    if (width >= 760) {
      const [left,right] = await Promise.all([products.boundingBox(),basket.boundingBox()]);
      assert.ok(left.x+left.width<right.x, 'Catalog is to the left of the order');
      assert.ok(Math.abs(left.y-right.y)<2, 'Both panes start at the same height');
    } else {
      assert.equal(await products.isVisible(),false);
    }
    await basket.getByRole('button', {name:'Increase Sample tart quantity'}).click();
    assert.equal(await quantity.inputValue(),'2');
    const details = basket.locator('details').filter({hasText:'Instructions and edit reason'});
    await details.locator('summary').click();
    await details.getByLabel('Fulfillment instructions').fill('Pack this separately');
    await details.getByLabel(/Reason for these changes/).fill('Added a gift box');

    if (width < 760) {
      await openProducts.click();
      assert.equal(await basket.isVisible(),false);
      assert.ok(await save.isVisible());
    }
    await products.getByRole('searchbox', {name:'Find a product'}).fill('GIFT');
    assert.equal(await products.getByRole('button', {name:'Add Sample tart'}).count(),0);
    await products.getByRole('button', {name:'Add Sample gift box'}).click();
    await basket.waitFor();
    assert.equal(await quantity.inputValue(),'2');
    assert.equal(await details.getByLabel('Fulfillment instructions').inputValue(),'Pack this separately');
    await basket.getByLabel('Selected choice').selectOption('chocolate');
    assert.match(await basket.locator('#edit-totals').innerText(), /340\.00/);
    assert.equal(await form.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
    const boxBeforeScroll = await save.boundingBox();
    assert.ok(boxBeforeScroll.y+boxBeforeScroll.height<=820,'Save stays visible on the viewport');
    await dialog.screenshot({path:join(artifacts,`${engine}-${width}.png`)});

    if (width < 760) {
      const buyer = basket.locator('details').filter({hasText:'Buyer details'});
      await buyer.locator('summary').click();
      await buyer.getByLabel('Name',{exact:true}).fill('');
      await openProducts.click();
      await save.click();
      await buyer.getByLabel('Name',{exact:true}).waitFor();
      assert.equal(await form.getAttribute('data-pane'),'order');
      await buyer.getByLabel('Name',{exact:true}).fill(order.buyer.name);
    }
    await save.click();
    const confirmation = page.getByRole('dialog',{name:'Confirm order changes'});
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(),/100\.00.*340\.00/s);
    assert.equal((await t.run(()=>h.order(order.id))).revision,order.revision);
    await confirmation.getByRole('button',{name:'Confirm and save'}).click();
    await dialog.getByRole('button',{name:'Edit order',exact:true}).waitFor();
    const saved = await t.run(()=>h.order(order.id));
    assert.equal(saved.payment_status,'paid');
    assert.equal(saved.paid_amount_cents,10000);
    assert.equal(saved.total_cents,34000);
    assert.equal(saved.instructions,'Pack this separately');
    assert.equal(saved.items.find(item=>item.product_id===tart.id).quantity,2);
    assert.deepEqual(saved.items.find(item=>item.product_id===box.id).selections,{flavor:{chocolate:1}});
    await context.close();
    console.log(`PASS ${engine} ${width}px: website editor panes, product search and options, preserved draft, verified save, and expired payment labels and filters`);
  }

  const customer = await memberPage(null,390);
  const expiredLink = new URL(origin+'/shop.html');
  expiredLink.hash = new URLSearchParams({order:expired.id,token:expired.access_token}).toString();
  await customer.page.goto(expiredLink.href);
  const orderTitle = customer.page.locator('.order-title');
  await orderTitle.waitFor();
  assert.doesNotMatch(await orderTitle.innerText(),/Awaiting payment/i);
  assert.match(await orderTitle.innerText(),/Expired/i);
  assert.equal(await customer.page.locator('#proof-form').count(),0);
  assert.deepEqual(t.errors,[]);
} finally {
  await t.close();
}
