// Fully local fixtures: this test never signs into or writes to production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://vouchers.test',out=join(root,'test-results/vouchers');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
const user={id:'customer',email:'client.with.a.long.email@example.test',email_confirmed_at:'2026-09-20'};
const voucher=i=>({id:'voucher-'+i,code:'TLB-ABCDEF'+i,title:i%2?'Your welcome treat':'A little thank-you from TLB',source:i%2?'newsletter':'campaign',status:'available',kind:'fixed',value:5000,min_subtotal_cents:50000,expires_at:'2027-10-20T15:59:00+08:00'});
const client=`export const ready=Promise.resolve(),configured=true,initializationError=null,authLink={};
export const auth={getUser:async()=>({data:{user:${JSON.stringify(user)}}}),getSession:async()=>({data:{session:{user:${JSON.stringify(user)}}}}),onAuthStateChange:()=>{},signOut:async()=>({}),resend:async()=>({})};
export const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(v/100);
export const formatDate=v=>v,manilaDate=()=> '2026-09-29',toast=()=>{};
export async function api(action,payload={}){const r=await fetch('/api',{method:'POST',body:JSON.stringify({action,payload})});const data=await r.json();if(!r.ok)throw Error(data.message);return data;}`;
try{for(const width of [1440,768,390,320]){
 const ctx=await browser.newContext({viewport:{width,height:1000}}),errors=[];let campaigns=[],saves=0,previews=0,mode='many',walletReads=0,preferenceFailed=false;
 const respond=(action,p)=>{
  if(action==='admin_bootstrap')return{};
  if(action==='my_orders')return[{id:'order-1',reference:'TLB-AB1234',method:'pickup',fulfillment_date:'October 3, 2026',created_at:'2026-09-29',payment_status:'paid',fulfillment_status:'confirmed',total_cents:260000,items:[{quantity:3,name:'Custom cake with a long product name'}]}];
  if(action==='my_vouchers'){walletReads++;const all=p.status==='available'?(mode==='many'?Array.from({length:6},(_,i)=>voucher(i)):[voucher(0)]):[];return{vouchers:all.slice(p.offset||0),total:all.length,counts:{available:all.length,used:0,expired:0}};}
  if(action==='voucher_campaigns')return{campaigns};
  if(action==='voucher_campaign_report'){const all=Array.from({length:51},(_,i)=>({code:'TLB-REPORT'+i,email:'customer.with.a.long.email.address@example.test',status:'used',sales_cents:260000,discount_cents:5000,issued_at:'2026-09-29T08:00:00Z',expires_at:'2026-10-29T08:00:00Z',email_status:'sent'}));return{total:51,limit:50,vouchers:all.slice(p.offset,p.offset+50)};}
  if(action==='voucher_save_campaign'){saves++;const c={...p.campaign,id:'campaign-1',revision:saves};campaigns=[c];return c;}
  if(action==='voucher_email_preview'){previews++;const c=p.campaign||campaigns[0];return{subject:c.email_subject,payload:{event_type:'newsletter_voucher',email_copy:c.email_copy,offer:{...c.terms,code:'A7K2M9',expires_at:'2027-10-20T15:59:00+08:00'},settings:{site_url:origin,shop_name:'The Little Baker Kitchen',pickup_address:'QA Bakery Address'},unsubscribe_token:'a'.repeat(64)}};}
  throw Error('Unexpected action '+action);
 };
 await ctx.route('**/*',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/api'){try{const p=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(respond(p.action,p.payload))});}catch(e){return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:e.message})});}}
  if(u.pathname.includes('/functions/v1/newsletter')){if(!preferenceFailed){preferenceFailed=true;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Temporary test outage"}'});}return route.fulfill({contentType:'application/json',body:'{"status":"subscribed"}'});}
  if(u.origin!==origin)return route.abort();
  if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:client});
  if(u.pathname==='/admin')return route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/ordering.css"><link rel="stylesheet" href="/assets/ordering/manage.css"><link rel="stylesheet" href="/assets/ordering/vouchers.css"><link rel="stylesheet" href="/assets/ordering/site-dialog.css"></head><body class="manage-page"><main style="max-width:1100px;margin:auto;padding:16px"><div id="manager"></div></main><script type="module">import{mountVoucherCampaigns}from"/assets/ordering/voucher-campaigns.js";mountVoucherCampaigns(document.querySelector("#manager"),{owner:true})</script></body></html>'});
  try{return route.fulfill({contentType:{'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.woff2':'font/woff2'}[extname(u.pathname)]||'application/octet-stream',body:await readFile(join(root,u.pathname))});}catch{return route.fulfill({status:404,body:'Missing fixture asset'});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/account.html');await page.waitForSelector('.voucher-compact');await page.evaluate(()=>document.fonts.ready);assert.match(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),/Lobster/);assert.match(await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily),/Chelsea/);
 assert.equal(await page.locator('.voucher-compact').count(),4);assert.equal(await page.locator('.account-order-total').innerText(),'₱2,600.00');
 await page.locator('[data-retry-preference]').click();await page.locator('[name=newsletter]').uncheck();const readsBefore=walletReads;
 await page.getByRole('button',{name:'Save email preference'}).click();await page.getByText('You’re unsubscribed from the TLB newsletter.',{exact:false}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.voucher-compact').length===4);assert.equal(walletReads,readsBefore+1,'Successful preference save after a retry must refresh the wallet');
 await page.locator('[data-voucher-details="0"]').click();await page.waitForSelector('dialog[open]');assert.match(await page.locator('dialog').innerText(),/TLB-ABCDEF0/);await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
 await page.locator('[data-voucher-page=next]').click();await page.waitForSelector('[data-voucher-range]');assert.equal(await page.locator('.voucher-compact').count(),2);
 await page.locator('[data-voucher-tab=used]').click();await page.waitForSelector('.voucher-empty');await page.locator('[data-voucher-tab=available]').click();await page.waitForSelector('.voucher-compact');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Account overflow ${width}`);
 await page.screenshot({path:join(out,`account-${width}.png`),fullPage:true});
 mode='single';await page.locator('[data-voucher-refresh]').click();await page.waitForSelector('.voucher-card');assert.equal(await page.locator('.voucher-card a').getAttribute('href'),'shop.html#voucher=TLB-ABCDEF0');
 await page.goto(origin+'/admin');await page.getByRole('button',{name:'+ Create campaign'}).click();await page.waitForSelector('[data-offer-form]');
 await page.locator('input[name=name]').fill('A thank-you for your next sweet moment');
 await page.getByRole('button',{name:'Email preview',exact:true}).click();await page.waitForSelector('iframe');assert.equal(previews,1);assert.equal(saves,0);
 await page.getByRole('button',{name:'Mobile',exact:true}).click();assert.equal(await page.locator('[data-preview-canvas]').evaluate(e=>e.classList.contains('is-mobile')),true);
 await page.getByRole('button',{name:'Plain text',exact:true}).click();assert.match(await page.locator('[data-preview-text]').innerText(),/A7K2M9/);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('button',{name:'Edit / activate'}).waitFor();assert.equal(campaigns[0].status,'draft');
  await page.getByRole('button',{name:'Edit / activate'}).click();await page.locator('[name=status]').selectOption('active');await page.getByRole('button',{name:'Save campaign',exact:true}).click();await page.getByRole('button',{name:'Edit / activate'}).waitFor();assert.equal(campaigns[0].status,'active');
 await page.getByRole('button',{name:'View report',exact:true}).click();await page.locator('.offer-recipient').first().waitFor();assert.equal(await page.locator('.offer-recipient').count(),50);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Report overflow ${width}`);
 assert.match(await page.locator('.offer-recipient').first().innerText(),/accepted by provider/);
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('button',{name:'Previous',exact:true}).waitFor();assert.equal(await page.locator('.offer-recipient').count(),1);
 await page.getByRole('button',{name:'Back to campaigns',exact:true}).click();await page.getByRole('button',{name:'Edit / activate'}).waitFor();
 await page.getByRole('button',{name:'Edit / activate'}).click();await page.locator('[name=kind]').selectOption('percent');await page.locator('[name=value]').fill('10');await page.locator('[name=expiry_mode]').selectOption('fixed');await page.locator('.accounting-date-picker summary').click();await page.waitForSelector('.calendar-month');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Campaign overflow ${width}`);
 await page.screenshot({path:join(out,`campaign-${width}.png`),fullPage:true});assert.deepEqual(errors,[]);
 await ctx.close();console.log(`PASS account wallet, campaign edit, preview and calendar at ${width}px`);
}}finally{await browser.close();}
