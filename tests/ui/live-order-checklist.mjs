import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname, join, resolve, sep} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
import {selectDashboardSection} from '../helpers/dashboard-nav.mjs';

const require = createRequire(import.meta.url);
const {chromium, webkit, devices} = require(process.env.PLAYWRIGHT_PACKAGE_ROOT
  ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const origin = 'https://live-checklist.test';
const iphone = process.env.BROWSER_ENGINE === 'webkit';
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.svg':'image/svg+xml'};
const staffDashboard = {
  role:'staff', categories:[], orders:[], inventory:[], zones:[], promos:[], staff:[],
  products:[{id:'cookie-box',name:'Cookie box',option_groups:[
    {id:'flavors',label:'Flavor',choices:[{id:'mango',label:'Mango cream'}]},
  ]}],
  settings:{shop_name:'The Little Baker Kitchen', paused:false},
};
const client = await readFile(join(root,'assets/ordering/client.js'),'utf8');
const mock = completeClientFixture(client, `
  export const configured=true, ready=Promise.resolve();
  export const auth={getSession:async()=>({data:{session:{user:{id:'staff'}}}}),onAuthStateChange:()=>{}};
  export const api=(action,payload={})=>window.fixtureApi(action,payload);
  export async function websiteVisitorStats(){return {};}
  ${client.slice(client.indexOf('export function money('))}
`);

function deferred() {
  let resolve;
  const promise = new Promise(done=>{resolve=done});
  return {promise,resolve};
}

const browser = await (iphone ? webkit : chromium).launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH || undefined});
const errors = [];

async function openDashboard(direct = false) {
  const device = iphone ? devices['iPhone 15 Pro Max'] : {viewport:{width:1280,height:900}};
  const context = await browser.newContext({...device, serviceWorkers:'block'});
  await context.exposeFunction('fixtureApi', fixtureApi);
  await context.route('**/*', async route=>{
    const url = new URL(route.request().url());
    if(url.origin !== origin) return route.abort();
    if(url.pathname === '/assets/ordering/client.js') return route.fulfill({contentType:'text/javascript',body:mock});
    const path = resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!path.startsWith(root+sep)) return route.abort();
    try { return await route.fulfill({contentType:mime[extname(path)] || 'application/octet-stream',body:await readFile(path)}); }
    catch { return route.fulfill({status:404, body:''}); }
  });
  const page=await context.newPage();
  page.on('pageerror', error=>errors.push(error.message));
  page.setDefaultTimeout(6000);
  // January 10 in Manila while the UTC date is still January 9.
  await page.clock.install({time:new Date('2027-01-09T18:00:00Z')});
  await page.goto(origin+'/manage.html'+(direct ? '#checklist' : ''));
  if(!direct) await selectDashboardSection(page,'checklist');
  return {context,page};
}

const firstId = '00000000-0000-4000-8000-000000000001';
const orders = [{
  id:firstId, reference:'TLB-100', fulfillment_date:'2027-01-10', method:'pickup', buyer:{name:'Mira Baker'},
  payment_status:'paid', prepared:false, content_key:'first-version',
  instructions:'Pack upright. Write Mira <3 on the box.',
  items:[{name:'Cocoa cake', quantity:2, description:'Blue buttercream',
    selection_labels:[{group:'Filling', label:'Salted caramel', quantity:1}, 'Birthday topper']},
    {name:'Cookie box',product_id:'cookie-box',quantity:1,selections:{flavors:{mango:2}}}],
}];
function delivery(reference, date) {
  return {id:reference, reference, fulfillment_date:date, method:'delivery', buyer:{name:'Delivery client'},
    payment_status:'paid', prepared:false, content_key:reference, items:[{name:'Tart', quantity:1}]};
}
orders.unshift(delivery('DEL-TODAY','2027-01-10'), delivery('DEL-YESTERDAY','2027-01-09'));
let reads=0, writes=0, failNextRead=false, failNextSave=false, heldWrite;

async function fixtureApi(action, payload) {
  if(action==='admin_bootstrap') return staffDashboard;
  if(action==='order_checklist') {
    reads++;
    if(failNextRead) {
      failNextRead=false;
      throw Error('Fixture connection interrupted.');
    }
    return structuredClone(orders);
  }
  if(action==='set_order_prep_note') {
    const order=orders.find(order=>order.id===payload.order_id);
    assert.ok(order);
    const currentVersion=order.prep_note_version ?? 0;
    if(payload.note_version!==currentVersion) {
      return {note:order.prep_note || '',note_version:currentVersion,conflict:true};
    }
    order.prep_note=payload.note;
    order.prep_note_version=currentVersion+1;
    return {note:order.prep_note,note_version:order.prep_note_version};
  }
  if(action==='set_order_prepared' || action==='set_order_item_prepared') {
    writes++;
    const order=orders.find(order=>order.id===payload.order_id);
    assert.ok(order, 'Writes identify an existing order');
    assert.equal(payload.content_key, order.content_key);
    assert.equal(typeof payload.prepared,'boolean');
    if(failNextSave) {
      failNextSave=false;
      throw Error('Fixture save failed. Try again.');
    }
    if(heldWrite) {
      heldWrite.started.resolve();
      await heldWrite.release.promise;
    }
    if(action==='set_order_prepared') {
      order.prepared=payload.prepared;
      order.prepared_items=payload.prepared ? order.items.map((_,i)=>i+1) : [];
      return {prepared:order.prepared};
    }
    const checks=new Set(order.prepared_items);
    if(payload.prepared) checks.add(payload.item_number);
    else checks.delete(payload.item_number);
    order.prepared_items=[...checks];
    order.prepared=checks.size===order.items.length;
    return {prepared:order.prepared,prepared_items:order.prepared_items};
  }
  throw Error('Unexpected staff action '+action);
}

function rowFor(page,id) {
  return page.locator('[data-checklist-order="'+id+'"]');
}
async function groupedOrders(page) {
  return page.locator('[data-checklist-date]').evaluateAll(days=>days.map(day=>({
    date:day.dataset.checklistDate,
    methods:[...day.querySelectorAll('[data-checklist-method]')].map(section=>({
      name:section.querySelector('h3').textContent.trim(),
      orders:[...section.querySelectorAll('[data-checklist-order]')].map(row=>row.dataset.checklistOrder),
    })),
  })));
}
async function expectSettled(page,id,checked) {
  await page.waitForFunction(({id,checked})=>{
    const input=document.querySelector('[data-checklist-order="'+id+'"] input[type=checkbox]');
    return input && !input.disabled && input.getAttribute('aria-disabled')!=='true' && input.checked===checked;
  },{id,checked});
}

try {
  const {page}=await openDashboard();
  const first=rowFor(page,firstId);
  await first.waitFor();
  const jan9={date:'2027-01-09',methods:[{name:'Delivery',orders:['DEL-YESTERDAY']}]};
  const jan10={date:'2027-01-10',methods:[{name:'Pickup',orders:[firstId]},{name:'Delivery',orders:['DEL-TODAY']}]};
  assert.deepEqual(await groupedOrders(page),[jan9,jan10],'All dates sort chronologically, with pickup before delivery inside each date');
  for (const day of [jan9,jan10]) {
    const section=page.locator('[data-checklist-date="'+day.date+'"]');
    assert.ok(await section.locator('h2').isVisible(),'Every group has a visible date heading');
    assert.match(await section.locator('h2').innerText(),new RegExp('\\b'+Number(day.date.slice(-2))+'\\b'));
  }
  for(const detail of ['TLB-100','Mira Baker','Cocoa cake','Salted caramel','Birthday topper','Blue buttercream','Pack upright. Write Mira <3 on the box.']) {
    assert.ok((await first.innerText()).includes(detail),'Order details include '+detail);
  }
  assert.match(await first.innerText(),/2\s*[×x]\s*Cocoa cake/i);
  assert.match(await first.innerText(),/2\s*[×x]\s*Mango cream/i,'Legacy raw choices resolve against the catalog');
  const checkedBox=first.getByRole('checkbox',{name:/TLB-100/});
  assert.equal(await checkedBox.isChecked(),false);
  await checkedBox.focus();

  const nextId='00000000-0000-4000-8000-000000000002';
  orders.push({
    id:nextId, reference:'TLB-101', fulfillment_date:'2027-01-11', method:'pickup', buyer:{name:'Ari Sample'},
    payment_status:'awaiting_payment', prepared:false, content_key:'second-version',
    instructions:'Leave the ribbon loose.', items:[{name:'Custom pastry', quantity:1,
      description:'Purple glaze. Cake inscription: '+ 'Congratulations'.repeat(8)}],
  });
  const documentId=await page.evaluate(()=>performance.timeOrigin);
  failNextRead=true;
  await page.clock.fastForward(16000);
  const next=rowFor(page,nextId);
  await page.getByRole('alert').filter({hasText:/./}).first().waitFor();
  assert.equal(await first.isVisible(),true,'A temporary read error leaves the last loaded list available');
  assert.equal(await next.count(),0);
  await page.clock.fastForward(31000);
  await next.waitFor();
  assert.equal(await page.evaluate(()=>performance.timeOrigin),documentId,'New orders appear on the original document');
  assert.match(await next.innerText(),/Purple glaze/);
  assert.match(await next.innerText(),/awaiting payment/i);
  assert.ok(await next.evaluate(row=>{
    const copy=row.querySelector('.live-checklist-items');
    return copy.scrollWidth<=copy.clientWidth+1 && document.documentElement.scrollWidth<=document.documentElement.clientWidth+1;
  }),'Long item details wrap inside the dashboard viewport');
  assert.equal(await checkedBox.evaluate(input=>input===document.activeElement),true,'Polling preserves staff keyboard focus');

  const jan11={date:'2027-01-11',methods:[{name:'Pickup',orders:[nextId]}]};
  assert.deepEqual(await groupedOrders(page),[jan9,jan10,jan11],'Polling creates a new date group');
  const previousDay=page.getByRole('button',{name:'Previous day',exact:true});
  const nextDay=page.getByRole('button',{name:'Next day',exact:true});
  await page.getByRole('button',{name:'Single day',exact:true}).click();
  assert.deepEqual(await groupedOrders(page),[jan10],'Single day starts on the Manila date');
  await previousDay.click();
  assert.deepEqual(await groupedOrders(page),[jan9]);
  await nextDay.click();
  await nextDay.click();
  assert.deepEqual(await groupedOrders(page),[jan11]);
  await nextDay.click();
  assert.equal(await page.locator('[data-checklist-order]').count(),0,'An empty day cannot show orders from another day');
  const picker=page.locator('.accounting-date-picker').filter({has:page.locator('[name=checklist_day]')});
  await picker.locator('summary').click();
  await picker.locator('[data-date-value="2027-01-10"]').click();
  assert.deepEqual(await groupedOrders(page),[jan10]);

  const arriving=orders.find(order=>order.id===nextId);
  arriving.fulfillment_date='2027-01-10';
  arriving.method='delivery';
  await page.clock.fastForward(16000);
  const dayDelivery=page.locator('[data-checklist-date="2027-01-10"] [data-checklist-method="delivery"]');
  await dayDelivery.locator('[data-checklist-order="'+nextId+'"]').waitFor();
  assert.equal(await next.count(),1,'Rescheduled orders move into the selected date and method exactly once');
  assert.equal(await page.locator('[data-checklist-order]').count(),3);

  heldWrite={started:deferred(),release:deferred()};
  await checkedBox.click();
  await Promise.race([heldWrite.started.promise, new Promise((_, reject)=>{
    setTimeout(()=>reject(new Error('No preparation save reached the fixture.')),6000).unref();
  })]);
  await page.clock.fastForward(16000);
  assert.equal(writes,1,'An automatic refresh cannot repeat a pending save');
  assert.equal(await checkedBox.isDisabled(),true);
  await checkedBox.evaluate(input=>input.click());
  assert.equal(await checkedBox.isChecked(),true,'A duplicate click cannot flip a pending checkmark');
  assert.equal(writes,1);
  await previousDay.click();
  assert.deepEqual(await groupedOrders(page),[jan9],'Day navigation remains usable during a pending checkmark save');
  heldWrite.release.resolve();
  await nextDay.click();
  await expectSettled(page,firstId,true);
  heldWrite=undefined;
  assert.equal(orders.find(order=>order.id===firstId).prepared,true);

  const second=await openDashboard(true);
  await expectSettled(second.page,firstId,true);
  const secondBox=rowFor(second.page,firstId).locator('[data-order-prepared]');
  failNextSave=true;
  await secondBox.click();
  await second.page.getByRole('alert').filter({hasText:/./}).first().waitFor();
  await expectSettled(second.page,firstId,true);
  assert.equal(orders.find(order=>order.id===firstId).prepared,true,'A failed save preserves the last stored value');
  await secondBox.click();
  await expectSettled(second.page,firstId,false);
  assert.equal(orders.find(order=>order.id===firstId).prepared,false);
  await second.context.close();
  await page.clock.fastForward(16000);
  await expectSettled(page,firstId,false);

  await page.getByRole('button',{name:'All dates',exact:true}).click();
  assert.equal(await page.locator('[data-checklist-date="2027-01-11"]').count(),0,'An empty date group is removed after a reschedule');
  await expectSettled(page,firstId,false);

  const cake=first.locator('[data-checklist-item="1"]');
  const cookies=first.locator('[data-checklist-item="2"]');
  await cake.click();
  await expectSettled(page,firstId,false);
  assert.ok(await cake.isChecked());
  assert.equal(await cookies.isChecked(),false);
  assert.equal(await checkedBox.evaluate(input=>input.indeterminate),true);
  assert.equal(await first.locator('[data-item-progress]').innerText(),'1 of 2 items');
  assert.match(await page.locator('.live-checklist-summary').innerText(),/^0 of /,'Partial items do not count as completed orders');

  const notes=first.locator('.live-checklist-notes');
  const editor=notes.getByRole('textbox',{name:'Private prep note'});
  assert.equal(await editor.isVisible(),false);
  await notes.locator('summary').click();
  await editor.fill('Cake chilled.\nCookies still in the oven.');
  await notes.getByRole('button',{name:'Save note'}).click();
  await notes.getByText('Note saved.',{exact:true}).waitFor();
  await expectSettled(page,firstId,false);
  const teammate=await openDashboard(true);
  const shared=rowFor(teammate.page,firstId);
  await shared.waitFor();
  assert.ok(await shared.locator('[data-checklist-item="1"]').isChecked());
  assert.equal(await shared.locator('[data-checklist-item="2"]').isChecked(),false);
  await shared.locator('.live-checklist-notes summary').click();
  const teammateNote=shared.getByRole('textbox',{name:'Private prep note'});
  assert.equal(await teammateNote.inputValue(),'Cake chilled.\nCookies still in the oven.');
  await editor.fill('Draft I am still typing');
  await teammateNote.fill('Team update.\nCookies are cooling.');
  await shared.getByRole('button',{name:'Save note'}).click();
  await shared.getByText('Note saved.',{exact:true}).waitFor();
  await shared.locator('[data-checklist-item="2"]').click();
  await expectSettled(teammate.page,firstId,true);
  await page.clock.fastForward(16000);
  await expectSettled(page,firstId,true);
  const loadSaved=notes.getByRole('button',{name:'Load saved note'});
  await loadSaved.waitFor();
  assert.equal(await editor.inputValue(),'Draft I am still typing');
  assert.ok(await notes.getByRole('button',{name:'Save note'}).isDisabled());
  await loadSaved.click();
  assert.equal(await editor.inputValue(),'Team update.\nCookies are cooling.');
  await checkedBox.click();
  await expectSettled(page,firstId,false);
  assert.equal(await cake.isChecked(),false);
  assert.equal(await cookies.isChecked(),false);
  assert.equal(await editor.inputValue(),'Team update.\nCookies are cooling.');
  await teammate.context.close();

  orders.splice(orders.indexOf(arriving),1);
  await page.clock.fastForward(16000);
  await next.waitFor({state:'detached'});
  await selectDashboardSection(page,'orders');
  const readsAfterLeaving=reads;
  await page.clock.fastForward(45000);
  assert.equal(reads,readsAfterLeaving,'Leaving Checklist stops its background polling');
  assert.deepEqual(errors,[]);
  console.log('PASS date groups, live arrivals, order and item checkmarks, shared prep notes, draft conflicts, and polling cleanup');
} finally {
  await browser.close();
}
