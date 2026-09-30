import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';

const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),output=resolve(root,'tests/artifacts/maintenance-countdown');
await mkdir(output,{recursive:true});
const origin='https://maintenance.test',base=Date.parse('2026-09-29T07:50:00Z');
const mime={'.css':'text/css','.js':'text/javascript','.ttf':'font/ttf'};
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
async function fixture(width,{duration=309000,path='/index.html',manual=false}={}){
 let server=base,calls=0,fail=false,status={active:true,announce:true,uploads_paused:true,message:'We’re making a few improvements. Thank you for your patience.',starts_at:new Date(base).toISOString(),ends_at:manual?null:new Date(base+duration).toISOString()};
 const errors=[],ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:`export const configured=true;export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));export async function api(){const r=await fetch('/api');if(!r.ok)throw Error('Offline');return r.json();}`});
  if(u.pathname==='/api'){calls++;return route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify({...status,server_time:new Date(server).toISOString()})});}
  if(u.pathname.endsWith('.html'))return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/ordering.css"><link rel="stylesheet" href="${path.startsWith('/shop')?'/assets/ordering/ordering.css':'/assets/ordering/ordering.css'}"><link rel="stylesheet" href="/assets/ordering/site-maintenance.css"><script type="module" src="/assets/ordering/site-maintenance.js"></script></head><body><main><h1>Storefront</h1></main></body></html>`});
  const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 // Deliberately wrong device date: countdown must follow server_time.
 await page.clock.install({time:new Date('2035-01-01T00:00:00Z')});
 await page.goto(origin+path);await page.locator('#site-maintenance-screen').waitFor({state:'attached'});
 const advance=async ms=>{server+=ms;await page.clock.runFor(ms);};
 const check=async()=>{const before=calls;await page.locator('[data-maint-check]').click();await page.waitForFunction(()=>!document.querySelector('[data-maint-check]').disabled);assert.equal(calls,before+1);};
 return {ctx,page,advance,check,calls:()=>calls,fail:value=>{fail=value;},status:changes=>Object.assign(status,changes),close:async()=>{assert.deepEqual(errors,[]);await ctx.close();}};
}

try{
 for(const width of [1440,768,390,320]){
  const f=await fixture(width),{page}=f;
  assert.equal(await page.locator('[data-maint-minutes]').textContent(),'05');
  assert.equal(await page.locator('[data-maint-seconds]').textContent(),'09');
  assert.equal(await page.locator('[data-maint-day-cell]').isVisible(),false);
  assert.equal(await page.locator('#site-maintenance-banner').isVisible(),false);
  assert.match(await page.locator('.maintenance-schedule').textContent(),/3:55 PM.*Manila/);
  await f.advance(1000);assert.equal(await page.locator('[data-maint-seconds]').textContent(),'08');assert.equal(f.calls(),1);
  await page.locator('.maintenance-contact').focus();await f.advance(29000);
  await page.waitForFunction(()=>document.querySelector('[data-maint-seconds]').textContent==='39');
  assert.equal(f.calls(),2);assert.equal(await page.locator('.maintenance-contact').evaluate(e=>e===document.activeElement),true);
  await page.locator('.maintenance-contact').evaluate(e=>e.blur());
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(output,`scheduled-${width}.png`),fullPage:true});
  // An extension is reflected, rather than reopening on the original deadline.
  f.status({ends_at:new Date(base+600000).toISOString()});await f.check();
  assert.equal(await page.locator('[data-maint-minutes]').textContent(),'09');
  assert.equal(await page.locator('[data-maint-seconds]').textContent(),'30');
  await f.close();console.log(`PASS server-timed countdown, polling, focus, extension and layout ${width}px`);
 }
 {
  const f=await fixture(390,{duration:2000}),{page}=f;
  f.fail(true);await f.advance(2200);await page.getByText('We’re checking the connection. Please bear with us.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-maint-seconds]').textContent(),'00');
  assert(await page.locator('#site-maintenance-screen').isVisible());
  const failedCalls=f.calls();await f.advance(2000);assert.equal(f.calls(),failedCalls,'No per-second request storm');
  f.fail(false);f.status({active:false,announce:false,uploads_paused:false});await f.advance(3100);
  await page.locator('#site-maintenance-screen').waitFor({state:'hidden'});assert(await page.getByRole('heading',{name:'Storefront',exact:true}).isVisible());
  const afterOpen=f.calls();await f.advance(2000);assert.equal(f.calls(),afterOpen);
  const polled=page.waitForResponse(r=>r.url().endsWith('/api'));await f.advance(31000);await polled;
  assert.equal(f.calls(),afterOpen+1,'A completed schedule returns to normal polling, not five-second retries');await f.close();
  console.log('PASS zero countdown stays closed offline, retries and reopens only after server confirmation');
 }
 {
  const f=await fixture(320,{duration:((2*24+4)*3600+5*60+6)*1000}),{page}=f;
  assert.equal(await page.locator('[data-maint-days]').textContent(),'02');assert.equal(await page.locator('[data-maint-hours]').textContent(),'04');
  assert(await page.locator('[data-maint-day-cell]').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(output,'long-schedule-320.png'),fullPage:true});
  f.status({ends_at:null});await f.check();assert.equal(await page.locator('[data-maint-countdown]').count(),0);
  assert(await page.getByText('We’ll be back as soon as our updates are complete.',{exact:true}).isVisible());
  await page.screenshot({path:join(output,'manual-320.png'),fullPage:true});await f.close();
 console.log('PASS multi-day schedules and switching to manual maintenance');
 }
 for(const width of [1440,390,320]){
  const f=await fixture(width,{manual:true}),{page}=f;
  assert(await page.getByRole('heading',{name:'We’ll be back soon.',exact:true}).isVisible());
  assert.equal(await page.locator('[data-maint-countdown],.maintenance-schedule,time').count(),0);
  assert.equal(await page.locator('[data-maint-manual-status]').textContent(),'This page will reopen automatically when we’re ready.');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:join(output,`open-ended-${width}.png`),fullPage:true});
  f.fail(true);await f.advance(30000);
  await page.getByText('We couldn’t check just now. We’ll try again shortly.',{exact:true}).waitFor();
  assert(await page.locator('#site-maintenance-screen').isVisible());
  assert.equal(f.calls(),2);
  f.fail(false);f.status({uploads_paused:false});await f.check();
  assert.equal(await page.locator('[data-maint-manual-status]').textContent(),'This page will reopen automatically when we’re ready.');
  assert(!((await page.locator('.maintenance-order-note').textContent()).includes('uploads are paused')));
  f.status({active:false,announce:false});await f.advance(30000);
  await page.locator('#site-maintenance-screen').waitFor({state:'hidden'});
  assert(await page.getByRole('heading',{name:'Storefront',exact:true}).isVisible());
  await f.close();console.log(`PASS open-ended maintenance layout, offline recovery and automatic reopening ${width}px`);
 }
 {
  const f=await fixture(390,{path:'/shop.html#order=existing'}),{page}=f;
  assert(await page.getByRole('heading',{name:'Storefront',exact:true}).isVisible());assert(await page.locator('#site-maintenance-banner').isVisible());
  assert.equal(await page.locator('[data-maint-countdown]').count(),0);
  await page.evaluate(()=>{location.hash='';});await page.locator('[data-maint-countdown]').waitFor();
  await page.evaluate(()=>{location.hash='order=existing';});await page.locator('#site-maintenance-screen').waitFor({state:'hidden'});
  await f.close();console.log('PASS existing orders stay accessible across hash navigation');
 }
 {
  const f=await fixture(390),{page}=f;
  f.status({active:false,announce:true,uploads_paused:false});await f.check();assert.equal(await page.locator('#site-maintenance-screen').isVisible(),false);
  assert(await page.getByText('Planned maintenance',{exact:true}).isVisible());
  f.status({active:true,message:'<img src=x onerror=alert(1)>'});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('#site-maintenance-screen:not([hidden])').waitFor();assert.equal(await page.locator('.maintenance-message img').count(),0);
  assert.equal(await page.locator('.maintenance-message').textContent(),'<img src=x onerror=alert(1)>');await f.close();
  console.log('PASS announcement-only mode, return to tab and escaped messages');
 }
}finally{await browser.close();}
