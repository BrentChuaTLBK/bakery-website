import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { recipeBrowserHarness } from './recipe-audit-harness.mjs';
import { completeClientFixture } from '../helpers/client-fixture.mjs';
import { selectDashboardSection } from '../helpers/dashboard-nav.mjs';
import { inspectImage } from '../../assets/ordering/image-format.js';
import { eventBody } from '../../supabase/functions/calendar-sync/google.ts';

const t = await recipeBrowserHarness();
const { db, h, origin } = t;
const files = new Map(), newsletterCalls = [], albumRequests = [];
const client = await readFile('assets/ordering/client.js', 'utf8');
const helpers = client.slice(client.indexOf('export function money('));
const oldFetch = globalThis.fetch;
let handler, failNewsletter = true;
globalThis.Deno = {
  env: { get: name => ({ SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: 'service-fixture', ALLOWED_ORIGINS: origin }[name] || '') },
  serve: fn => { handler = fn; },
};
await import('../../supabase/functions/order-photos/index.ts');

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.pathname === '/auth/v1/user') {
    const authorized = new Headers(options.headers).get('Authorization') === 'Bearer owner-fixture';
    return authorized ? Response.json({ id: h.ids.owner }) : Response.json({}, { status: 401 });
  }
  if (url.pathname === '/rest/v1/rpc/shop_service') {
    const { p_action, p_payload } = JSON.parse(options.body);
    try { return Response.json(await t.run(() => h.service(p_action, p_payload))); }
    catch (error) { return Response.json({ message: error.message }, { status: 400 }); }
  }
  if (url.pathname.startsWith('/storage/v1/object/sign/order-photos/')) {
    const path = url.pathname.split('/order-photos/')[1];
    return files.has(path)
      ? Response.json({ signedURL: '/object/sign/order-photos/' + path + '?token=fixture' })
      : Response.json({}, { status: 404 });
  }
  if (url.pathname.startsWith('/storage/v1/object/order-photos/') && options.method === 'POST') {
    const path = url.pathname.split('/order-photos/')[1];
    const bytes = Buffer.from(options.body), image = inspectImage(bytes);
    assert.equal(image.mime, new Headers(options.headers).get('Content-Type'));
    assert.ok(path.endsWith('.' + image.extension));
    files.set(path, { bytes, mime: image.mime });
    await t.run(() => db.query("insert into storage.objects(bucket_id,name,metadata) values('order-photos',$1,'{}')", [path]));
    return Response.json({});
  }
  if (url.pathname === '/storage/v1/object/order-photos' && options.method === 'DELETE') {
    for (const path of JSON.parse(options.body).prefixes) {
      files.delete(path);
      await t.run(() => db.query("delete from storage.objects where bucket_id='order-photos' and name=$1", [path]));
    }
    return Response.json({});
  }
  throw new Error('Unexpected server request ' + url.pathname);
};

async function browserPage(user) {
  const { page, context } = await t.pageFor(user, 390, { isMobile: true, hasTouch: true });
  const session = user ? { user: { id: user }, access_token: 'owner-fixture' } : null;
  await context.exposeFunction('orderFixtureApi', (action, payload, token) =>
    t.run(() => h.api(action, payload, user, token)));
  await context.route('**/assets/ordering/client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: completeClientFixture(client, `
      export const configured=true, ready=Promise.resolve();
      export const auth={getSession:async()=>({data:{session:${JSON.stringify(session)}}}),onAuthStateChange:()=>{}};
      export function api(action,payload={},token=null){return window.orderFixtureApi(action,payload,token)}
      export async function websiteVisitorStats(){return {}}
      ${helpers}`),
  }));
  await context.route('**/assets/ordering/config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const config={supabaseUrl:${JSON.stringify(origin)},supabasePublishableKey:'sb_publishable_fixture'};`,
  }));
  await context.route('**/assets/ordering/newsletter.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route('**/functions/v1/order-photos', async route => {
    const request = route.request(), headers = { ...await request.allHeaders(), origin };
    if (headers['content-type']?.includes('application/json') && request.postDataJSON()?.action === 'shared') {
      albumRequests.push({ authorized: Boolean(headers.authorization) });
    }
    const result = await handler(new Request(request.url(), { method: 'POST', headers, body: request.postDataBuffer() }));
    return route.fulfill({ status: result.status, contentType: 'application/json', body: await result.text() });
  });
  await context.route('**/storage/v1/object/sign/order-photos/**', route => {
    const url = new URL(route.request().url()), photo = files.get(url.pathname.split('/order-photos/')[1]);
    return photo && url.searchParams.get('token') === 'fixture'
      ? route.fulfill({ contentType: photo.mime, body: photo.bytes })
      : route.fulfill({ status: 404 });
  });
  await context.route('**/functions/v1/newsletter', route => {
    newsletterCalls.push(route.request().postDataJSON());
    if (failNewsletter) {
      failNewsletter = false;
      return route.fulfill({ status: 503, json: { error: 'Try again in a moment.' } });
    }
    return route.fulfill({ json: { status: 'subscribed' } });
  });
  return page;
}

try {
  const date = await h.day(15);
  const create = async name => {
    const payload = { source:'direct_message', method:'pickup', fulfillment_date:date, override_dates:true,
      buyer:{ name }, instructions:'Add a blue ribbon.\nPlace the card inside.',
      items:[{ name:'Custom cake', quantity:1, unit_price_cents:10000 }], discount:{ kind:'none' }, email_notifications:false };
    const expected = await h.api('pos_quote', payload, h.ids.owner);
    return h.api('pos_create_order', { ...payload, expected_quote:expected, idempotency_key:randomUUID(),
      payment:{ method:'gcash', amount_cents:10000, received_cents:10000 } }, h.ids.owner);
  };
  const first = await create('Reference photo client'), second = await create('Newsletter client');
  const staff = await browserPage(h.ids.owner);
  await staff.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async link => { window.copiedDirectOrderLink = link; } },
    });
  });
  await staff.goto(origin + '/manage.html');
  await selectDashboardSection(staff, 'orders');
  await staff.locator(`[data-action="open-order"][data-id="${first.id}"]`).click();
  const linkSection = staff.locator('[data-direct-order-link]');
  const copyLink = linkSection.getByRole('button', { name:'Copy link' });
  const linkInput = linkSection.getByRole('textbox', { name:'Private order link' });
  await copyLink.waitFor();
  await staff.waitForFunction(() => document.activeElement?.id === 'order-dialog-summary');
  assert.ok(await linkSection.evaluate(section =>
    section.previousElementSibling?.matches('.order-total') &&
    section.nextElementSibling?.matches('[data-order-photos]')
  ));
  for (const width of [320,390,1440]) {
    await staff.setViewportSize({ width, height:844 });
    const [field, button] = await Promise.all([linkInput.boundingBox(), copyLink.boundingBox()]);
    assert.ok(field.x + field.width <= button.x && Math.abs(field.y - button.y) <= 1);
    assert.ok(await linkSection.evaluate(section => section.scrollWidth <= section.clientWidth + 1));
  }
  await staff.setViewportSize({ width:390, height:844 });
  await copyLink.click();
  const privateLink = await linkInput.inputValue();
  const customerUrl = new URL(privateLink);
  const customerParams = new URLSearchParams(customerUrl.hash.slice(1));
  assert.ok(customerUrl.pathname.endsWith('/shop.html'));
  assert.equal(customerParams.get('order'),first.id);
  assert.equal(customerParams.get('token'),first.access_token);
  await linkSection.getByText('Link copied.').waitFor();
  await linkSection.getByRole('button', { name:'Copied' }).waitFor();
  assert.equal(await staff.evaluate(() => window.copiedDirectOrderLink),privateLink);
  console.log('PASS The direct order details show and copy the matching customer link on mobile and desktop.');
  const picker = staff.locator('[data-attach-photos]');
  await staff.locator('[data-photo-status]').filter({hasText:'No photos attached yet.'}).waitFor();
  const photo = await staff.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 180; c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#cea991'; ctx.fillRect(0, 0, 180, 160);
    ctx.fillStyle = '#70451e'; ctx.fillRect(40, 60, 100, 48);
    return c.toDataURL('image/png').split(',')[1];
  });
  await picker.setInputFiles({ name:'reference.png', mimeType:'image/png', buffer:Buffer.from(photo,'base64') });
  await staff.locator('[data-photo-status]').filter({hasText:'Photo attached.'}).waitFor();
  await staff.locator('[data-photo-list] img').waitFor();
  assert.equal(files.size,1);
  const job = await t.run(() => h.scalar('select to_jsonb(e) from tlb.calendar_events e where order_id=$1', [first.id]));
  assert.equal(job.desired.photo_count,1);
  const event = eventBody(job.desired,job.event_id);
  const album = new URL(event.description.match(/href="([^"]+)">View order photos/)[1]);
  assert.match(event.description,/Order notes:\nAdd a blue ribbon/);
  const guest = await browserPage(null);
  const albumUrl = origin + album.pathname + album.hash;
  await guest.goto(albumUrl);
  await guest.waitForFunction(() => document.querySelector('#photo-album img')?.naturalWidth > 0);
  assert.deepEqual(albumRequests,[{authorized:false}]);
  assert.doesNotMatch(await guest.locator('main').innerText(),/Reference photo client|Custom cake|Email/);
  await staff.locator('[data-remove-order-photo]').click();
  await staff.getByRole('button', { name:'Remove photo', exact:true }).click();
  await staff.locator('[data-photo-status]').filter({hasText:'Photo removed.'}).waitFor();
  assert.equal(files.size,0);
  await guest.reload();
  await guest.getByText('This photo link is unavailable.').waitFor();
  console.log('PASS Staff can attach a photo, Google Calendar includes notes and the photo-only link, and removing the last photo revokes the link.');

  async function openPrivateOrder(order) {
    await guest.goto(origin + '/shop.html#' + new URLSearchParams({ order:order.id,token:order.access_token }));
    const form = guest.locator('#order-email-form');
    await form.waitFor();
    assert.equal(await form.locator('[name=newsletter]').isChecked(),false);
    return form;
  }
  let form = await openPrivateOrder(first);
  await guest.setViewportSize({ width:1440, height:844 });
  const [optIn, saveEmail] = await Promise.all([
    form.locator('.order-email-opt-in').boundingBox(),
    form.getByRole('button', { name:'Save email for order updates' }).boundingBox(),
  ]);
  assert.ok(optIn.x + optIn.width <= saveEmail.x && Math.abs(optIn.y - saveEmail.y) <= 1);
  await guest.setViewportSize({ width:390, height:844 });
  await form.locator('[name=email]').fill('order-only@example.test');
  await form.getByRole('button',{name:'Save email for order updates'}).click();
  await form.getByText('Order updates will go to order-only@example.test.').waitFor();
  assert.equal(newsletterCalls.length,0);
  const saved = await t.run(() => h.order(first.id));
  assert.equal(saved.buyer.email,'order-only@example.test');
  assert.equal(saved.email_notifications,true);
  await guest.reload();
  await guest.locator('#customer-order-reference').waitFor();
  assert.equal(await guest.locator('#order-email-form').count(),0);

  form = await openPrivateOrder(second);
  await form.locator('[name=email]').fill('newsletter@example.test');
  await form.getByText('Also join the TLB newsletter for new treats and offers', { exact:true }).click();
  assert.equal(await form.locator('[name=newsletter]').isChecked(),true);
  await form.getByRole('button',{name:'Save email for order updates'}).click();
  await form.getByText(/Order updates will go to newsletter@example.test.*Newsletter signup could not be completed/).waitFor();
  await form.getByRole('button',{name:'Retry newsletter signup'}).click();
  await form.getByText(/You’re subscribed to the TLB newsletter/).waitFor();
  assert.deepEqual(newsletterCalls.map(call => [call.action,call.email]),[
    ['subscribe','newsletter@example.test'], ['subscribe','newsletter@example.test'],
  ]);
  assert.equal((await t.run(() => h.order(second.id))).revision, second.revision + 1);
  assert.deepEqual(t.errors,[]);
  console.log('PASS The private order link saves an email for order updates, leaves newsletter opt-in unchecked, and can retry newsletter signup independently.');
} finally {
  globalThis.fetch = oldFetch;
  await t.close();
}
