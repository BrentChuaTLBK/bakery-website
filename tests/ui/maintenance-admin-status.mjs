import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),output=resolve(root,'tests/artifacts/maintenance-status'),origin='https://maintenance.test';
await mkdir(output,{recursive:true});
const helpers=`export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));export const manilaDate=()=> '2026-09-29';`;
const base=Date.parse('2026-09-29T08:00:00Z'),iso=ms=>new Date(ms).toISOString();
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.ttf':'font/ttf'};
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
async function fixture(width,{future=false,manual=false,failInitially=false}={}){
 let server=base,revision=1,fail=failInitially,hold=false,release,heldResolve;
 const held=new Promise(resolve=>{heldResolve=resolve;});
 let settings={mode:manual?'manual':'scheduled',announce:true,pause_uploads:true,message:'A few improvements.',starts_at:iso(base+(future?2000:-600000)),ends_at:iso(base+(future?5000:-300000))};
 const calls=[],errors=[],ctx=await browser.newContext({viewport:{width,height:1000}});
 const snapshot=()=>{const active=settings.mode==='manual'||(settings.mode==='scheduled'&&Date.parse(settings.starts_at)<=server&&server<Date.parse(settings.ends_at));return {revision,settings:{...settings},status:{active,uploads_paused:active&&settings.pause_uploads,announce:settings.announce,starts_at:settings.starts_at,ends_at:settings.mode==='manual'?null:settings.ends_at,server_time:iso(server)}};};
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:`export async function api(action,payload={}){const r=await fetch('/api',{method:'POST',body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}export async function affiliateReceipt(){};${helpers}`});
  if(u.pathname==='/api'){
   const {action,payload}=route.request().postDataJSON();calls.push({action,payload});
   if(fail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Connection unavailable'})});
   if(action==='save_maintenance'){
    if(payload.revision!==revision)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Maintenance settings changed. Refresh before saving.'})});
    settings=payload.settings;revision++;
   }else assert.equal(action,'maintenance_admin');
   const result=snapshot();if(hold&&action==='maintenance_admin')await new Promise(resolve=>{release=resolve;heldResolve();});
   return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  }
  if(u.pathname==='/test.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/ordering.css"><link rel="stylesheet" href="/assets/ordering/manage.css"><link rel="stylesheet" href="/assets/ordering/ordering.css"><link rel="stylesheet" href="/assets/ordering/accounting.css"><link rel="stylesheet" href="/assets/ordering/site-maintenance.css"><main id="maintenance-root" style="max-width:1100px;margin:auto;padding:24px"></main><script type="module">import {mountMaintenance} from "/assets/ordering/maintenance-admin.js";window.maintenanceController=mountMaintenance(document.querySelector("main"),{owner:true});</script>'});
  const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2035-01-01T00:00:00Z')});await page.goto(origin+'/test.html');
 if(!failInitially)await page.locator('[data-maint-state] strong').waitFor();else await page.getByText('Connection unavailable',{exact:true}).waitFor();
 return {page,calls,held,advance:async ms=>{server+=ms;await page.clock.runFor(ms);},fail:value=>{fail=value;},external:changes=>{settings={...settings,...changes};revision++;},hold:()=>{hold=true;},release:()=>{hold=false;release?.();},close:async()=>{assert.deepEqual(errors,[]);await ctx.close();}};
}
try{
 for(const width of [1440,390]){
  const f=await fixture(width),p=f.page;
  assert.equal(await p.locator('[data-maint-state] strong').textContent(),'Maintenance completed');
  assert.match(await p.locator('[data-maint-state]').textContent(),/Ended Sep 29, 2026, 3:55 PM/);
  assert.equal(await p.locator('[name=mode] option:checked').textContent(),'Scheduled — completed');
  assert(await p.locator('[data-maint-history]').isVisible());assert.equal(await p.locator('#maintenance-root').getAttribute('data-dirty'),'false');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.screenshot({path:join(output,`completed-${width}.png`),fullPage:true});await f.close();
 }
 {
  const f=await fixture(390,{future:true}),p=f.page;
  assert.equal(await p.locator('[data-maint-state] strong').textContent(),'Maintenance is scheduled');
  await p.locator('[name=message]').fill('Keep this unfinished edit.');await f.advance(2200);
  await p.getByText('Maintenance is active',{exact:true}).waitFor();await f.advance(3000);
  await p.getByText('Maintenance completed',{exact:true}).waitFor();
  assert.equal(await p.locator('[name=message]').inputValue(),'Keep this unfinished edit.');
  assert(await p.locator('[name=message]').evaluate(e=>e===document.activeElement));assert.equal(await p.locator('#maintenance-root').getAttribute('data-dirty'),'true');
  f.external({mode:'off',message:'Another owner’s saved update.'});await f.advance(30000);
  await p.locator('[data-maint-conflict]:not([hidden])').waitFor();
  assert.equal(await p.locator('[name=message]').inputValue(),'Keep this unfinished edit.');
  await p.locator('[name=mode]').selectOption('off');await p.getByRole('button',{name:'Save maintenance settings',exact:true}).click();
  await p.getByText('Maintenance settings changed. Refresh before saving.',{exact:true}).waitFor();
  assert.equal(f.calls.find(c=>c.action==='save_maintenance').payload.revision,1);
  await f.close();
 }
 {
  const f=await fixture(390,{manual:true}),p=f.page;
  assert.equal(await p.locator('[data-maint-state] strong').textContent(),'Maintenance is active');
  assert.equal(await p.locator('[data-maint-history]').isVisible(),false);
  f.fail(true);await f.advance(30000);await p.locator('[data-maint-poll-error]:not([hidden])').waitFor();
  assert.equal(await p.locator('[data-maint-state] strong').textContent(),'Maintenance is active');
  f.fail(false);f.external({mode:'off'});await f.advance(30000);await p.getByText('Website maintenance is off',{exact:true}).waitFor();
  await p.evaluate(()=>window.maintenanceController.destroy());const count=f.calls.length;
  await f.advance(90000);await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal(f.calls.length,count);await f.close();
 }
 {
  const f=await fixture(390,{failInitially:true});f.fail(false);await f.advance(30000);
  await f.page.getByText('Maintenance completed',{exact:true}).waitFor();await f.close();
 }
 {
  const f=await fixture(390),p=f.page;f.hold();await f.advance(30000);await f.held;
  assert.equal(f.calls.length,2);
  await p.locator('[name=mode]').selectOption('off');await p.getByRole('button',{name:'Save maintenance settings',exact:true}).click();
  await p.getByText('Maintenance settings saved.',{exact:true}).waitFor();const reply=p.waitForResponse('**/api');f.release();await reply;await p.clock.runFor(100);
  assert.equal(await p.locator('[data-maint-state] strong').textContent(),'Website maintenance is off');
  assert.equal(await p.locator('[data-maint-conflict]').isVisible(),false);await f.close();
 }
 console.log('PASS completed/upcoming/active states, server time, automatic boundaries, draft and revision preservation, manual mode, offline recovery, cleanup and save/refresh race');
}finally{await browser.close();}
