// Real dashboard and customer order pages; all external traffic is blocked.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
import {selectDashboardSection} from '../helpers/dashboard-nav.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://maintenance-integration.test',out=join(root,'tests/artifacts/maintenance-integration');
await mkdir(out,{recursive:true});
const source=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=source.slice(source.indexOf('export function money('));
const mock=completeClientFixture(source,`
export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'fixture-owner'}}}}),onAuthStateChange:()=>{}};
export async function api(action,payload={}){
 window.calls.push({action,payload});const f=window.fixture;
 if(action==='admin_bootstrap')return {role:f.role,categories:[],inventory:[],promos:[],zones:[],staff:[],email_status:[],settings:f.settings,products:[],orders:[]};
 if(action==='catalog')return {categories:[],inventory:[],zones:[],settings:f.settings,products:[]};
 if(action==='site_status')return {...f.status,server_time:new Date().toISOString()};
 if(action==='get_order')return structuredClone(f.order);
 if(action==='maintenance_admin')return {revision:f.revision,settings:f.maintenance,status:{...f.status,server_time:new Date().toISOString()}};
 if(action==='save_maintenance'){
  if(payload.revision!==f.revision)throw Error('Maintenance settings changed. Refresh before saving.');
  f.revision++;f.maintenance=structuredClone(payload.settings);f.status={...f.status,active:payload.settings.mode==='manual',uploads_paused:payload.settings.mode==='manual'&&payload.settings.pause_uploads,message:payload.settings.message};
  return api('maintenance_admin');
 }
 if(action==='calendar_status')return {};
 throw Error('Unexpected fixture API '+action);
}
export async function websiteVisitorStats(){return {}};
export async function upload(){throw Error('Uploads disabled in this test')};
${helpers}`);
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const errors=[],mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
async function fixture(width,role='owner'){
 const ctx=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
 await ctx.addInitScript(({role})=>{
  window.calls=[];
  window.fixture={role,revision:1,settings:{paused:false,shop_name:'TLB Kitchen',pickup_address:'Kitchen',production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6]},
   maintenance:{mode:'off',announce:false,pause_uploads:true,message:'Planned improvements',starts_at:null,ends_at:null},
   status:{active:false,announce:false,uploads_paused:false,message:'Planned improvements',starts_at:null,ends_at:null},
   order:{id:'fixture-order',reference:'TLB-TEST',source:'website',revision:1,method:'pickup',fulfillment_date:'2026-10-30',buyer:{name:'Fixture Customer'},items:[],history:[],subtotal_cents:10000,discount_cents:0,delivery_cents:0,total_cents:10000,payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',payment_deadline:new Date(Date.now()+480000).toISOString(),uploads_paused:true,payment_seconds_remaining:480}};
 },{role});
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
  if(['/assets/ordering/traffic.js','/assets/ordering/newsletter.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
  const path=resolve(root,'.'+u.pathname);if(!path.startsWith(root+sep))return route.abort();
  try{return route.fulfill({contentType:mime[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return {page,ctx};
}
try{
 for(const width of [1440,390]){
  const {page,ctx}=await fixture(width);
  await page.goto(origin+'/manage.html');await page.locator('#workspace h1').waitFor();
  await selectDashboardSection(page,'maintenance');
  await page.locator('.maintenance-form').waitFor();
  assert.match(await page.locator('[data-maint-state]').textContent(),/maintenance is off/i);
  await page.locator('[name="mode"]').selectOption('manual');await page.locator('[name="message"]').fill('TLB planned improvements');
  await page.getByRole('button',{name:'Save maintenance settings',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-maint-state]')?.textContent.includes('Maintenance is active'));
  assert.equal(await page.evaluate(()=>window.fixture.maintenance.pause_uploads),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(out,`dashboard-${width}.png`),fullPage:true});
  await page.locator('[name="mode"]').selectOption('off');await page.getByRole('button',{name:'Save maintenance settings',exact:true}).click();
  await page.waitForFunction(()=>!window.fixture.status.active);
  await selectDashboardSection(page,'orders');assert.equal(await page.locator('#maintenance-manager').count(),0);
  await ctx.close();console.log(`PASS actual owner dashboard navigation, save, reopen and layout ${width}px`);
 }
 {
  const {page,ctx}=await fixture(1440,'staff');await page.goto(origin+'/manage.html');await page.locator('#workspace h1').waitFor();
  assert.equal(await page.locator('[data-view="maintenance"]').isVisible(),false);await ctx.close();console.log('PASS maintenance navigation is owner-only');
 }
 for(const delivery of [false,true]){
  const {page,ctx}=await fixture(390);
  await page.goto(origin+'/shop.html#order=fixture-order&token=fixture-token');
  await page.getByRole('heading',{name:'Payment uploads paused',exact:true}).waitFor();
  assert.equal(await page.locator('#proof-form').count(),0);assert.match(await page.locator('.order-layout').textContent(),/8 minutes remain/);
  await page.evaluate(delivery=>{
   window.fixture.status.active=true;window.fixture.status.uploads_paused=true;
   if(delivery)Object.assign(window.fixture.order,{source:'direct_message',method:'delivery',payment_status:'paid',paid_amount_cents:10000,deferred_delivery:true,delivery_payment_status:'awaiting_payment',delivery_cents:1200,payment_deadline:null,payment_seconds_remaining:null});
   window.dispatchEvent(new CustomEvent('tlb-maintenance-change'));
  },delivery);
  await page.getByRole('heading',{name:'Payment uploads paused',exact:true}).waitFor();
  assert.equal(await page.locator('#site-maintenance-screen').isVisible(),false,'Private order remains available');
  await page.evaluate(()=>{window.fixture.order.uploads_paused=false;window.fixture.status.active=false;window.fixture.status.uploads_paused=false;window.dispatchEvent(new CustomEvent('tlb-maintenance-change'));});
  await page.locator('#proof-form').waitFor();
  if(delivery)await page.getByRole('heading',{name:'Pay your delivery fee',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await ctx.close();console.log(`PASS ${delivery?'direct-order delivery':'website payment'} proof pause, protected time, private access and resume`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
