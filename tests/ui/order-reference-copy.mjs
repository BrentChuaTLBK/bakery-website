import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://order-copy.test';
const output=join(root,'test-results/order-copy');
await mkdir(output,{recursive:true});
const realClient=await readFile(join(root,'assets/ordering/client.js'),'utf8');
const helpers=realClient.slice(realClient.indexOf('export function money('));
const id='08c47746-bf77-4a92-a1d6-7d6f639b91ce',token='ab'.repeat(32);
const order={id,reference:'TLB-A7K2M9',created_at:new Date().toISOString(),fulfillment_date:'2026-09-30',method:'pickup',payment_status:'paid',fulfillment_status:'ready_for_pickup',paid_amount_cents:24500,total_cents:24500,subtotal_cents:24500,discount_cents:0,delivery_cents:0,buyer:{name:'Sample customer',email:'customer@example.test',phone:'09171234567'},items:[{name:'Nori Bucket',quantity:1,unit_price_cents:24500,line_total_cents:24500,selection_labels:[]}],history:[],pickup_address:'Sample pickup address',pickup_hours:'10 AM - 8 PM',pickup_instructions:'Include your name and order ID in courier notes.'};
const mock=`export const configured=true,ready=Promise.resolve(),auth=null;
export async function api(action){if(action==='catalog')return {products:[],categories:[],inventory:[],zones:[],settings:{}};if(action==='get_order')return {...${JSON.stringify(order)},reference:window.testReference||'TLB-A7K2M9'};throw Error('Unexpected API: '+action)}
export async function upload(){throw Error('Unexpected upload')}
${helpers}`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:950},isMobile:width<500,hasTouch:width<500,serviceWorkers:'block'});
  const errors=[];
  await context.addInitScript(()=>{
   window.copied=[];window.copyMode='modern';
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.copyMode!=='modern')throw Error('Clipboard permission denied');window.copied.push(text)}}});
   document.execCommand=command=>{if(command==='copy'&&window.copyMode==='fallback'){window.copied.push(document.activeElement.value);return true}return false};
  });
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin){if(/supabase|resend/.test(url.hostname))errors.push('Live API attempted');return route.abort()}
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(['/assets/ordering/newsletter.js','/assets/ordering/traffic.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   const path=resolve(root,'.'+decodeURIComponent(url.pathname));
   if(!path.startsWith(root+'/')&&!path.startsWith(root+'\\'))return route.abort();
   try{return await route.fulfill({contentType:mime[extname(path)]||'application/octet-stream',body:await readFile(path)})}catch{return route.fulfill({status:404,body:''})}
  });
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/shop.html#order=${id}&token=${token}`);
  const button=page.locator('#copy-order-id');
  await button.waitFor();
  const click=()=>width<500?button.tap():button.click();
  await click();
  await page.waitForFunction(()=>document.getElementById('copy-order-id').textContent==='Copied!');
  assert.deepEqual(await page.evaluate(()=>window.copied),[order.reference]);
  assert.match(await page.locator('#toast-region').innerText(),/Order ID copied/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.order-title').screenshot({path:join(output,`heading-${width}.png`)});
  await page.evaluate(()=>{window.copyMode='fallback';window.copied=[]});
  await click();
  await page.waitForFunction(()=>window.copied.length===1);
  assert.deepEqual(await page.evaluate(()=>window.copied),[order.reference]);
  assert.equal(await page.locator('textarea[aria-label="Order ID to copy"]').count(),0);
  await page.evaluate(()=>{window.copyMode='denied';window.copied=[]});
  await click();
  await page.waitForFunction(()=>document.getElementById('toast-region').textContent.includes('Could not copy automatically'));
  assert.deepEqual(await page.evaluate(()=>window.copied),[]);
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),order.reference);
  assert.equal(await button.isDisabled(),false);
  assert.equal(await button.textContent(),'Copy order ID');
  for(const reference of ['TLB-260919-012345ABCD','TLB-A2B3C4D5E6F7']){
   await page.evaluate(reference=>{window.testReference=reference;window.copyMode='modern';window.copied=[]},reference);
   await page.locator('#refresh-order').click();
   await page.waitForFunction(reference=>document.getElementById('customer-order-reference')?.textContent===reference,reference);
   await click();
   await page.waitForFunction(()=>window.copied.length===1);
   assert.deepEqual(await page.evaluate(()=>window.copied),[reference]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  assert.deepEqual(errors,[]);
  await context.close();
  console.log(`PASS order ID copy at ${width}px: only reference, clipboard fallback, denied permissions, legacy and longer IDs`);
 }
}finally{await browser.close();}
