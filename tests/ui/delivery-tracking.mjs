// Isolated tracking UI checks. All requests are intercepted; no live orders or email.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {safeDeliveryTrackingUrl,deliveryTrackingUrlForSave} from '../../assets/ordering/delivery-tracking.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://tracking.test',output=join(root,'test-results/delivery-tracking');await mkdir(output,{recursive:true});
const firstLink='https://track.lalamove.com/fixture-one?reference=TLB-A7K9P2&lang=en',replacementLink='https://track.lalamove.com/fixture-two';
const unsafe=['javascript:alert(1)','http://track.example.test/order','https:track.example.test/order','https://user:password@track.example.test/order','https://track.example.test/a\\b','https://track.example.test/a\nheader','https://track.example.test/\u0001','https://track.example.test/\" onclick=\"alert(1)','data:text/html,<script>alert(1)</script>',{},'https://track.example.test/'+ 'x'.repeat(2050)];
for(const value of unsafe){assert.equal(safeDeliveryTrackingUrl(value),'');assert.throws(()=>deliveryTrackingUrlForSave(value),/HTTPS/);}
assert.equal(deliveryTrackingUrlForSave('   '),'');assert.equal(deliveryTrackingUrlForSave('  '+firstLink+'  '),firstLink);
const product={id:'product',name:'Nori chips',photos:[],price_cents:50000,min_quantity:1,lead_days:1,active:true,option_groups:[]};
const baseOrder={id:'delivery',reference:'TLB-A7K9P2',revision:3,created_at:'2026-09-25T01:00:00Z',fulfillment_date:'2026-10-02',method:'delivery',payment_status:'paid',fulfillment_status:'out_for_delivery',buyer:{name:'Sample customer',email:'customer@example.test',phone:'09171234567',social_platform:'na',social_username:''},recipient:{name:'Sample recipient',phone:'09171234567'},address:{line1:'Sample delivery address',line2:'',locality:'Quezon City',postal_code:''},instructions:'',delivery_tracking_url:'',items:[{product_id:product.id,name:product.name,quantity:1,unit_price_cents:50000,line_total_cents:50000,selections:{},selection_labels:[]}],history:[],subtotal_cents:50000,discount_cents:0,delivery_cents:10000,total_cents:60000,paid_amount_cents:60000};
const settings={paused:false,pickup_address:'Sample pickup location',pickup_hours:'10 AM – 8 PM'},catalog={products:[product],categories:[],inventory:[],zones:[],settings};
const realClient=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=realClient.slice(realClient.indexOf('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'fixture-user'}}}}),onAuthStateChange:()=>{}};
export async function api(action,payload={},access=null){const r=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({action,payload,access})});const data=await r.json();if(!r.ok)throw Error(data.error);return data}
export async function upload(){throw Error('Unexpected upload')} export async function websiteVisitorStats(){return {}};
export async function academyApi(){throw Error('Unexpected Academy request')} export async function academyUpload(){throw Error('Unexpected Academy upload')} export async function academySignedUrls(){throw Error('Unexpected Academy photos')};
${helpers}`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
async function setup(width,role){
 const orders={delivery:structuredClone(baseOrder),pickup:{...structuredClone(baseOrder),id:'pickup',reference:'TLB-P1C2K3',method:'pickup',fulfillment_status:'confirmed',delivery_cents:0,total_cents:50000,paid_amount_cents:50000,delivery_tracking_url:firstLink},completed:{...structuredClone(baseOrder),id:'completed',reference:'TLB-C1D2E3',fulfillment_status:'completed'}};
 const calls=[],errors=[],unexpected=[],context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin){if(!/fonts\.(googleapis|gstatic)\.com/.test(url.hostname))unexpected.push(url.href);return route.abort();}
  if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
  if(['/assets/ordering/traffic.js','/assets/ordering/newsletter.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
  if(url.pathname==='/fixture-api'){
   const {action,payload,access}=route.request().postDataJSON();calls.push({action,payload,access});let result;
   if(action==='admin_bootstrap')result={role,products:[product],categories:[],orders:Object.values(orders),inventory:[],zones:[{id:'zone',active:true,localities:['Quezon City'],fee_cents:10000}],staff:[],promos:[],settings};
   else if(action==='catalog')result=catalog;
   else if(action==='get_order')result=orders[payload.order_id];
   else if(action==='preview_edit_order')result={...orders[payload.order_id],...payload.changes};
   else if(action==='edit_order')result=orders[payload.order_id]={...orders[payload.order_id],...payload.changes,revision:orders[payload.order_id].revision+1};
   else if(action==='accounting_get_delivery')result={cost:null,order_revision:orders[payload.order_id].revision};
   else throw Error('Unexpected API action '+action);
   return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  }
  const file=resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {page,context,orders,calls,errors,unexpected};
}
try{
 for(const [width,role] of [[1440,'owner'],[390,'staff']]){
  const {page,context,orders,calls,errors,unexpected}=await setup(width,role);
  await page.goto(origin+'/manage.html');await page.locator('[data-view=orders]').click();await page.locator('[data-action=open-order][data-id=delivery]').waitFor();
  await page.locator('[data-action=open-order][data-id=delivery]').click();await page.locator('[data-action=edit-order]').click();
  const form=page.locator('[data-form=order-edit]'),tracking=form.locator('[name=delivery_tracking_url]');
  assert.equal(await tracking.isVisible(),true);assert.equal(await tracking.isEnabled(),true);assert.equal(await tracking.inputValue(),'');
  assert.equal(await tracking.evaluate(el=>Boolean(el.closest('.delivery-accounting'))),false);
  await tracking.fill('http://track.example.test/order');await form.locator('[type=submit]').click();await form.locator('.form-error').filter({hasText:'HTTPS'}).waitFor();assert.equal(calls.filter(c=>c.action==='edit_order'||c.action==='preview_edit_order').length,0);
  await tracking.fill(firstLink);await tracking.evaluate(el=>{el.blur();el.scrollLeft=0;el.parentElement.scrollIntoView({block:'center',behavior:'instant'});});await page.locator('#admin-dialog').screenshot({path:join(output,`admin-${role}-${width}.png`)});
  await form.locator('[type=submit]').click();await page.locator('[data-action=edit-order]').waitFor();
  assert.equal(calls.find(c=>c.action==='preview_edit_order').payload.changes.delivery_tracking_url,firstLink);assert.equal(calls.find(c=>c.action==='edit_order').payload.changes.delivery_tracking_url,firstLink);
  assert.equal(await page.locator('#admin-dialog [data-delivery-tracking]').getAttribute('href'),firstLink);
  await page.locator('[data-action=edit-order]').click();assert.equal(await tracking.inputValue(),firstLink);await tracking.fill(replacementLink);await form.locator('[type=submit]').click();await page.locator('[data-action=edit-order]').waitFor();assert.equal(orders.delivery.delivery_tracking_url,replacementLink);
  await page.locator('[data-action=edit-order]').click();await tracking.fill('');await form.locator('[type=submit]').click();await page.locator('[data-action=edit-order]').waitFor();assert.equal(calls.filter(c=>c.action==='edit_order').at(-1).payload.changes.delivery_tracking_url,'');assert.equal(await page.locator('#admin-dialog [data-delivery-tracking]').count(),0);
  await page.locator('#dialog-close').click();await page.locator('[data-action=open-order][data-id=pickup]').click();assert.equal(await page.locator('#admin-dialog [data-delivery-tracking]').count(),0);await page.locator('[data-action=edit-order]').click();assert.equal(await page.locator('[name=delivery_tracking_url]').count(),0);
  await page.locator('#dialog-close').click();await page.locator('[data-action=open-order][data-id=completed]').click();await page.locator('[data-action=edit-contact]').click();await page.locator('[name=delivery_tracking_url]').fill(replacementLink);
  const completedSave=page.waitForResponse(response=>{if(!response.url().endsWith('/fixture-api'))return false;const payload=response.request().postDataJSON();return payload.action==='edit_order'&&payload.payload.order_id==='completed';});
  await page.locator('[data-form=order-contact] [type=submit]').click();await completedSave;await page.locator('[data-action=edit-contact]').waitFor();assert.equal(orders.completed.delivery_tracking_url,replacementLink,JSON.stringify(calls.filter(c=>c.action==='edit_order')));
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await context.close();console.log(`PASS tracking admin ${role} ${width}px: optional field, valid save/replacement/clear, invalid blocked, pickup hidden, completed contact correction.`);
 }
 for(const width of [1440,390,320]){
  const {page,context,orders,calls,errors,unexpected}=await setup(width,'customer');orders.delivery.delivery_tracking_url=firstLink;
  const open=async id=>{await page.goto(origin+'/shop.html#order='+id+'&token=private-test-token');await page.locator('#customer-order-reference').waitFor();};
  await open('delivery');const link=page.locator('[data-delivery-tracking]');await link.waitFor();assert.equal(await link.getAttribute('href'),firstLink);assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');assert.equal(await link.getAttribute('referrerpolicy'),'no-referrer');
  await link.scrollIntoViewIfNeeded();await page.locator('.order-section').filter({has:page.locator('[data-delivery-tracking]')}).screenshot({path:join(output,`customer-${width}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  orders.delivery.delivery_tracking_url=replacementLink;await page.locator('#refresh-order').click();await page.waitForFunction(url=>document.querySelector('[data-delivery-tracking]')?.href===url,replacementLink);
  for(const value of ['',...unsafe.slice(0,10)]){orders.delivery.delivery_tracking_url=value;await page.locator('#refresh-order').click();await page.locator('#customer-order-reference').waitFor();assert.equal(await page.locator('[data-delivery-tracking]').count(),0,'Unsafe or empty returned data should not become a link');}
  await open('pickup');assert.equal(await page.locator('[data-delivery-tracking]').count(),0);assert.equal(calls.filter(c=>c.action==='get_order').every(c=>c.access==='private-test-token'),true);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await context.close();console.log(`PASS private order tracking ${width}px: latest link, blank/unsafe/pickup hidden, secure external attributes and mobile layout.`);
 }
}finally{await browser.close();}
