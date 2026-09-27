import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://email-alerts.test',output=join(root,'tests/artifacts/email-alerts');
const alerts=Array.from({length:5},(_,i)=>({id:'alert-'+i,event_type:i?'order_updated':'newsletter_test',order_id:i?'order-'+i:null,status:'pending',attempts:2,last_error:'Provider failed <script>unsafe()</script>',alert_acknowledged:false}));
const base={role:'owner',products:[],categories:[],orders:[],inventory:[],promos:[],zones:[],staff:[],email_status:alerts,settings:{paused:false}};
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=completeClientFixture(client,`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
const key='email-alert-fixture';
window.calls=[];
export async function api(action,payload={}){
 const data=JSON.parse(localStorage.getItem(key)||${JSON.stringify(JSON.stringify(base))});
 if(action==='admin_bootstrap')return {...data,role:window.fixtureRole};
 if(action!=='acknowledge_email_alert')throw Error('Unexpected action '+action);
 window.calls.push({action,payload});
 await new Promise(resolve=>setTimeout(resolve,120));
 if(window.failAck)throw Error('This email status changed. Refresh the dashboard before acknowledging it.');
 const row=data.email_status.find(r=>r.id===payload.id);
 if(row.attempts!==payload.attempts||row.status!==payload.status||row.last_error!==payload.last_error)throw Error('Stale alert');
 const result={id:row.id,alert_acknowledged:true,alert_acknowledged_at:'2026-09-28T06:00:00Z'};
 Object.assign(row,result);localStorage.setItem(key,JSON.stringify(data));return result;
}
export async function websiteVisitorStats(){return {}};
${helpers}`);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
await mkdir(output,{recursive:true});
try{
 for(const [width,role] of [[1440,'owner'],[390,'owner'],[390,'staff']]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
  await context.addInitScript(role=>window.fixtureRole=role,role);
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();
   try{return await route.fulfill({body:await readFile(file),contentType:mime[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/manage.html');
  const card=page.locator('#email-delivery'),buttons=card.locator('[data-action="acknowledge-email-alert"]');
  await buttons.first().waitFor();assert.equal(await buttons.count(),4);
  assert.match(await card.innerText(),/Newsletter notification/);assert.equal(await card.locator('script').count(),0);
  await card.screenshot({path:join(output,`alerts-${width}-${role}.png`)});
  await buttons.first().focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.email-delivery-acknowledged summary')?.textContent==='Acknowledged alerts (1)');
  assert.equal(await buttons.count(),4);assert.equal(await card.locator('[data-id="alert-0"]').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.id),'alert-1');
  assert.equal(await page.evaluate(()=>window.calls.length),1);
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('email-alert-fixture')));
  assert.equal(data.email_status[0].status,'pending');assert.equal(data.email_status[0].attempts,2);assert.equal(data.email_status.length,5);
  await page.reload();await card.waitFor();assert.equal(await card.locator('[data-id="alert-0"]').count(),0);
  await page.evaluate(()=>window.failAck=true);await buttons.first().click();
  await page.waitForFunction(()=>document.body.innerText.includes('This email status changed.'));
  assert.equal(await buttons.count(),4);assert.equal(await buttons.first().isDisabled(),false);
  await page.evaluate(()=>{window.failAck=false;const key='email-alert-fixture',data=JSON.parse(localStorage.getItem(key));data.email_status[0].attempts++;data.email_status[0].alert_acknowledged=false;localStorage.setItem(key,JSON.stringify(data));});
  await page.reload();await card.locator('[data-id="alert-0"]').waitFor();
  assert.equal(await card.locator('.email-delivery-acknowledged').count(),0);
  while(await buttons.count()){const previous=await card.locator('summary').count()?await card.locator('summary').textContent():null;await buttons.first().click();await page.waitForFunction(previous=>{const current=document.querySelector('#email-delivery summary')?.textContent;return current&&current!==previous;},previous);}
  assert.match(await card.locator('summary').textContent(),/5/);
  await card.locator('summary').click();assert.equal(await card.locator('.email-delivery-acknowledged .notice:visible').count(),5);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS email alert acknowledgement: '+width+' '+role);
  await context.close();
 }
}finally{await browser.close();}
