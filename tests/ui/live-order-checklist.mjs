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
  await page.clock.install();
  await page.goto(origin+'/manage.html'+(direct ? '#checklist' : ''));
  if(!direct) await selectDashboardSection(page,'checklist');
  return {context,page};
}

const firstId = '00000000-0000-4000-8000-000000000001';
const orders = [{
  id:firstId, reference:'TLB-100', fulfillment_date:'2027-01-10', buyer:{name:'Mira Baker'},
  payment_status:'paid', prepared:false, content_key:'first-version',
  instructions:'Pack upright. Write Mira <3 on the box.',
  items:[{name:'Cocoa cake', quantity:2, description:'Blue buttercream',
    selection_labels:[{group:'Filling', label:'Salted caramel', quantity:1}, 'Birthday topper']},
    {name:'Cookie box',product_id:'cookie-box',quantity:1,selections:{flavors:{mango:2}}}],
}];
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
  if(action==='set_order_prepared') {
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
    order.prepared=payload.prepared;
    return {prepared:order.prepared};
  }
  throw Error('Unexpected staff action '+action);
}

function rowFor(page,id) {
  return page.locator('[data-checklist-order="'+id+'"]');
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
    id:nextId, reference:'TLB-101', fulfillment_date:'2027-01-11', buyer:{name:'Ari Sample'},
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
  heldWrite.release.resolve();
  await expectSettled(page,firstId,true);
  heldWrite=undefined;
  assert.equal(orders[0].prepared,true);

  const second=await openDashboard(true);
  await expectSettled(second.page,firstId,true);
  const secondBox=rowFor(second.page,firstId).getByRole('checkbox');
  failNextSave=true;
  await secondBox.click();
  await second.page.getByRole('alert').filter({hasText:/./}).first().waitFor();
  await expectSettled(second.page,firstId,true);
  assert.equal(orders[0].prepared,true,'A failed save preserves the last stored value');
  await secondBox.click();
  await expectSettled(second.page,firstId,false);
  assert.equal(orders[0].prepared,false);
  await second.context.close();
  await page.clock.fastForward(16000);
  await expectSettled(page,firstId,false);

  orders.splice(1,1);
  await page.clock.fastForward(16000);
  await next.waitFor({state:'detached'});
  await selectDashboardSection(page,'orders');
  const readsAfterLeaving=reads;
  await page.clock.fastForward(45000);
  assert.equal(reads,readsAfterLeaving,'Leaving Checklist stops its background polling');
  assert.deepEqual(errors,[]);
  console.log('PASS staff checklist details, new orders without reload, shared checkmarks, save retry and polling cleanup');
} finally {
  await browser.close();
}
