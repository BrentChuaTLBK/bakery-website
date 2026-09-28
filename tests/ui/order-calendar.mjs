import {completeClientFixture} from '../helpers/client-fixture.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),output=resolve(root,'test-results/order-calendar'),origin='https://thelittlebakerkitchen.com';
await mkdir(output,{recursive:true});
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
export async function api(p_action,p_payload={}){return (await fetch('/fixture',{method:'POST',body:JSON.stringify({p_action,p_payload})})).json()}
export async function calendarConnection(action,payload={}){return (await fetch('/functions/v1/calendar-sync',{method:'POST',body:JSON.stringify({action,...payload})})).json()}
export async function upload(){throw Error('Unexpected upload')} export async function websiteVisitorStats(){return {}};${helpers}`;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
const connection={connected:true,calendar_id:'tlb@example.test',pending:0,last_success_at:new Date().toISOString()};
const base={date:today,status:'confirmed',buyer:{name:'Buyer',email:'buyer@example.test',phone:'09170000000'},recipient:{name:'Recipient <safe>',phone:'09171111111'},address:{line1:'12 Test Street',locality:'Makati'},items:[{name:'Signature Trio',quantity:1}],window:'9 AM – 6 PM',sync_state:'synced'};
const orders=[{...base,id:'pickup',reference:'TLB-PICKUP',method:'pickup',pickup_address:'TLB kitchen'},{...base,id:'z',reference:'TLB-Z',method:'delivery',address:{...base.address,locality:'Quezon City'}},{...base,id:'a',reference:'TLB-A',method:'delivery'}];
for(const order of orders){order.total_cents=90000;order.buyer={...order.buyer,social_platform:'Instagram',social_username:'@mia.santos'};}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
try{for(const width of [1440,390,320]){
 for(const order of orders)order.status='confirmed';
 const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'}),errors=[],calls=[];
 const products=[{id:'flavor',name:'Vanilla fixture',kind:'flavor',price_cents:0,photos:[],active:true},{id:'box',name:'Box fixture',kind:'set',price_cents:90000,photos:[],active:true,lead_days:2,box_flavors:['flavor','flavor','flavor']}];
 await ctx.route('**/*',async route=>{const url=new URL(route.request().url());if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:completeClientFixture(client,mock)});if(url.origin!==origin)return route.abort();
  let data;
  if(url.pathname==='/functions/v1/calendar-sync')data={configured:true,service_account_email:'test@fixture.iam.gserviceaccount.com',connection};
  else if(url.pathname==='/fixture'){
   const {p_action:action,p_payload:payload}=route.request().postDataJSON();calls.push({action,payload});
   if(action==='admin_bootstrap')data={role:'owner',orders:[],products,categories:[],inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}};
   else if(action==='site_status')data={active:false,uploads_paused:false,announce:false};
   else if(action==='calendar_list')data={orders:orders.filter(o=>o.date>=payload.from&&o.date<=payload.to),connection};
   else if(action==='calendar_sync_now')data=connection;
   else if(action==='delete_product'){const p=products.find(p=>p.id===payload.id);p.deleted_at=new Date().toISOString();p.active=false;data={deleted:true};}
   else throw Error('Unexpected API '+action);
  }
  if(data!==undefined)return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto(origin+'/manage.html#calendar');
 await page.locator('[data-calendar-order=a]').waitFor();assert.equal(await page.locator('.calendar-order.pickup').count(),1);assert.equal(await page.locator('.calendar-order.delivery').count(),2);
 assert.deepEqual(await page.locator('.calendar-group-heading.delivery').allTextContents(),['Makati · 1 delivery','Quezon City · 1 delivery']);
 assert.deepEqual(await page.locator('.sidebar-group-title').allTextContents(),['Operations','Catalog','Website','Marketing','Reports','Settings']);
 assert.equal(await page.locator('#admin-nav .sidebar-link').first().getAttribute('data-view'),'pos');
 assert.deepEqual(await page.locator('[aria-labelledby=nav-website-title] .sidebar-link').evaluateAll(elements=>elements.map(el=>el.dataset.view)),['homepage','academy','galleries']);
 if(width<761){
  assert.equal(await page.locator('#admin-nav').isVisible(),false,'Mobile navigation starts compact');
  assert.equal(await page.locator('#admin-nav-current').textContent(),'Calendar');
  await page.getByRole('button',{name:'Dashboard menu',exact:true}).click();
  assert.equal(await page.locator('#admin-nav').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Menu has no horizontal overflow');
  await page.locator('.admin-sidebar').screenshot({path:join(output,`navigation-${width}.png`)});
  await page.locator('#admin-nav [data-view=pos]').focus();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#admin-nav').isVisible(),false);
  assert.equal(await page.locator('#admin-nav-toggle').evaluate(el=>el===document.activeElement),true);
 }else await page.locator('.admin-sidebar').screenshot({path:join(output,`navigation-${width}.png`)});
 const alternate=today.slice(0,8)+(today.endsWith('01')?'02':'01');
 await page.locator('.accounting-date-picker summary').click();
 await page.locator(`[data-date-value="${alternate}"]`).click();
 assert.equal(await page.locator('[data-calendar-date]').inputValue(),alternate);
 assert.equal(await page.locator(`[data-calendar-day="${alternate}"]`).getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('.calendar-order').count(),0);
 await page.locator('[data-calendar-action=next]').click();
 await page.locator('.accounting-date-picker summary').click();
 const nextDate=await page.locator('[data-calendar-date]').inputValue();
 assert.notEqual(nextDate.slice(0,7),today.slice(0,7));
 assert.equal(await page.locator(`[data-date-value="${nextDate}"]`).getAttribute('aria-pressed'),'true','Date picker follows month navigation after it was opened');
 await page.locator('[data-date-close]').click();
 await page.locator('[data-calendar-action=previous]').click();
 await page.locator('[data-calendar-action=today]').click();
 await page.locator('[data-calendar-order=a]').waitFor();
 const pickupCard=page.locator('[data-calendar-order=pickup]');
 assert.doesNotMatch(await pickupCard.textContent(),/TLB kitchen|Buyer email|Pickup location|9 AM|buyer@example/);
 assert.equal(await pickupCard.locator('.calendar-amount strong').textContent(),'₱900.00');
 await pickupCard.locator('[data-calendar-copy=social]').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Instagram · @mia.santos');
 await pickupCard.locator('[data-calendar-copy=all]').click();const copied=await page.evaluate(()=>navigator.clipboard.readText());
 assert.match(copied,/Order ID: TLB-PICKUP/);assert.match(copied,/Amount: ₱900.00/);assert.doesNotMatch(copied,/TLB kitchen|Window:|Email:/);
 assert.doesNotMatch(await page.locator('[data-calendar-order=a]').textContent(),/Buyer email|9 AM|buyer@example/);
 orders[0].status='completed';orders[2].status='completed';await page.locator('[data-calendar-action=refresh]').click();
 await page.locator('[data-calendar-order=a].is-completed').waitFor();
 assert.equal(await page.locator('.calendar-order').count(),3,'Completed orders remain visible');
 assert.equal(await page.locator('.calendar-completed-badge').count(),2);
 assert.equal(await page.locator('[data-calendar-order=a] .calendar-completed-badge').textContent(),'✓ Completed');
 const day=page.locator(`[data-calendar-day="${today}"]`);
 assert.match(await day.getAttribute('aria-label'),/0 pending pickups; 1 pending deliveries; 2 completed orders/);
 assert.equal(await day.locator('.completed').textContent(),'✓ 2');
 assert.equal(await day.locator('.pickup').count(),0,'Completed pickups do not count as pending');
 assert.equal(await page.locator('[data-calendar-order=a]').evaluate(el=>getComputedStyle(el).borderLeftColor),'rgb(138, 132, 124)');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Completed calendar has no page overflow');
 await page.locator('#order-calendar-manager').screenshot({path:join(output,`calendar-completed-${width}.png`)});
 await page.locator('[data-calendar-order=a] [data-calendar-copy=address]').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'12 Test Street, Makati');
 await page.locator('[data-calendar-filter=method]').selectOption('delivery');assert.equal(await page.locator('.calendar-order.pickup').count(),0);
 await page.locator('[data-calendar-filter=area]').selectOption('Makati');assert.equal(await page.locator('.calendar-order').count(),1);
 await page.locator('[data-calendar-filter=search]').fill('safe');assert.equal(await page.locator('.calendar-order').count(),1);
 await page.clock.fastForward(16000);assert.equal(await page.locator('[data-calendar-filter=area]').inputValue(),'Makati');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow');
 await page.locator('#order-calendar-manager').screenshot({path:join(output,`calendar-${width}.png`)});
 const beforeRestore=calls.filter(c=>c.action==='calendar_list').length;
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 await page.clock.fastForward(31000);assert.equal(calls.filter(c=>c.action==='calendar_list').length,beforeRestore);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await page.locator('[data-calendar-order=a]').waitFor();
 assert.equal(await page.locator('[data-calendar-filter=area]').inputValue(),'Makati','Restoring the page preserves filters');
 assert.ok(calls.filter(c=>c.action==='calendar_list').length>beforeRestore,'Restoring the page resumes refresh');
 if(width<761)await page.getByRole('button',{name:'Dashboard menu',exact:true}).click();
 await page.locator('[data-view=orders]').click();
 if(width<761){assert.equal(await page.locator('#admin-nav').isVisible(),false);assert.equal(await page.locator('#admin-nav-current').textContent(),'Orders');}
 const count=calls.filter(c=>c.action==='calendar_list').length;await page.clock.fastForward(31000);assert.equal(calls.filter(c=>c.action==='calendar_list').length,count);
 assert.deepEqual(errors,[]);await ctx.close();console.log(`PASS calendar, quick copy, completed orders, filters and polling cleanup at ${width}px`);
}}finally{await browser.close();}
