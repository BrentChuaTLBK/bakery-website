import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://payments.test',out=join(root,'tests/artifacts/payment-options');
const options=['GCash','BDO','East West'].map((label,i)=>({id:`00000000-0000-4000-8000-00000000000${i+1}`,label,account_name:'QA Test Account',account_number:'00000000000'+(i+1),note:'',enabled:true}));
const settings={shop_name:'The Little Baker Kitchen',contact_email:'test@example.test',contact_phone:'00000000000',site_url:origin,pickup_address:'QA pickup address',pickup_hours:'10am – 8pm',pickup_instructions:'Bring your order ID.',payment_options:options,payment_options_revision:1,payment_note:'',payment_instructions:'Accepted Payment Methods:\n\n'+options.map(p=>[p.label,p.account_name,p.account_number].join('\n')).join('\n\n'),paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],blocked_dates:[],delivery_blocked_dates:[],reminder_time:'08:00'};
const base={role:'owner',products:[],categories:[],orders:[],inventory:[],promos:[],zones:[],staff:[],email_status:[],settings};
const order={id:'old',reference:'QA-PAYMENT',created_at:new Date().toISOString(),payment_deadline:new Date(Date.now()+3600000).toISOString(),payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',method:'pickup',fulfillment_date:'2026-10-30',buyer:{name:'QA Customer',email:'test@example.test',phone:'00000000000'},items:[{name:'Test treats',quantity:1,unit_price_cents:31500,line_total_cents:31500}],subtotal_cents:31500,discount_cents:0,delivery_cents:0,total_cents:31500,history:[],...settings};
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=completeClientFixture(client,`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner',email:'test@example.test',email_confirmed_at:'2026-09-01'}}}}),onAuthStateChange:()=>{}};
window.paymentCalls=[];const base=${JSON.stringify(base)},originalOrder=${JSON.stringify(order)};
function data(){return JSON.parse(localStorage.getItem('payment-fixture')||JSON.stringify(base));}
export async function api(action,payload={}){
 window.paymentCalls.push({action,payload});const d=data();
 if(action==='admin_bootstrap')return {...d,role:window.fixtureRole};
 if(action==='catalog')return d;
 if(action==='get_order'){const next={...originalOrder,...(payload.order_id==='new'?d.settings:{}),id:payload.order_id};if(window.proofSent)next.payment_status='under_review';if(window.legacyOrder)delete next.payment_options;return next;}
 if(action==='save_settings'){if(window.failSave)throw Error('Payment options changed in another window.');await new Promise(r=>setTimeout(r,120));d.settings={...payload.settings,payment_options_revision:d.settings.payment_options_revision+1};localStorage.setItem('payment-fixture',JSON.stringify(d));return d.settings;}
 throw Error('Unexpected fixture action '+action);
}
export async function upload(file,opts){window.paymentCalls.push({action:'upload',opts});window.proofSent=true;return {};}
export async function websiteVisitorStats(){return {}};
${helpers}`);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
await mkdir(out,{recursive:true});const results=[];
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
try{
 for(const [width,role] of [[1440,'owner'],[390,'owner'],[320,'owner'],[390,'staff']]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
  await context.addInitScript(role=>{window.fixtureRole=role;window.copiedText='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(window.denyCopy)throw Error('Denied');window.copiedText=value;}}});document.execCommand=()=>false;},role);
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(u.pathname.endsWith('traffic.js')||u.pathname.endsWith('newsletter.js'))return route.fulfill({contentType:'text/javascript',body:''});
   const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({body:await readFile(file),contentType:mime[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/shop.html#order=old&token=fixture');await page.locator('[data-payment-options]').waitFor();
  assert.equal(await page.locator('.payment-method').count(),3);
  await page.locator('[data-payment-copy=number]').click();assert.equal(await page.evaluate(()=>window.copiedText),'000000000001');
  await page.locator('.payment-method').nth(1).click();assert.equal(await page.locator('#payment-number').inputValue(),'000000000002');
  await page.locator('[data-payment-copy=name]').click();assert.equal(await page.evaluate(()=>window.copiedText),'QA Test Account');
  await page.locator('[data-payment-copy=amount]').click();assert.equal(await page.evaluate(()=>window.copiedText),'315.00');
  await page.locator('[name=payment_reference]').fill('Keep this reference');await page.locator('.payment-method').nth(2).click();assert.equal(await page.locator('[name=payment_reference]').inputValue(),'Keep this reference');
  assert.equal((await page.evaluate(()=>window.paymentCalls)).some(x=>x.action==='upload'),false);
  await page.evaluate(()=>window.denyCopy=true);await page.locator('[data-payment-copy=number]').click();assert.match(await page.locator('[data-payment-status]').innerText(),/selected/);assert.equal(await page.locator('#payment-number').evaluate(el=>el.selectionEnd-el.selectionStart),12);await page.evaluate(()=>window.denyCopy=false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(role==='owner')await page.locator('.order-layout>aside>.panel').screenshot({path:join(out,`payment-${width}.png`)});
  await page.locator('#refresh-order').click();await page.locator('#payment-number').waitFor();assert.equal(await page.locator('#payment-number').inputValue(),'000000000003');
  await page.evaluate(()=>window.legacyOrder=true);await page.locator('#refresh-order').click();await page.locator('[data-payment-options]').waitFor();assert.equal(await page.locator('.payment-method').count(),3);
  await page.locator('[name=proof]').setInputFiles(join(root,'assets/img/brands/Hat.png'));await page.locator('#proof-form button[type=submit]').click();await page.getByRole('heading',{name:'Your payment is under review'}).waitFor();assert.equal(await page.locator('[data-payment-options]').count(),0);
  await page.goto(origin+'/manage.html');await page.locator('#shop-status').filter({hasText:'Shop accepting orders'}).waitFor({state:'attached'});await page.locator('[data-view=settings]').click();await page.locator('#payment-options-editor').waitFor();
  if(role==='staff'){assert.equal(await page.locator('[data-payment-add]').isDisabled(),true);assert.equal(await page.locator('[data-payment-field=account_number]').first().isDisabled(),true);assert.deepEqual(errors,[]);await context.close();results.push({width,role,passed:true});continue;}
  assert.equal(await page.locator('[data-payment-method]').count(),3);await page.locator('[data-payment-add]').click();const extra=page.locator('[data-payment-method]').last();
  await extra.locator('[data-payment-field=label]').fill('Another bank');await extra.locator('[data-payment-field=account_name]').fill('QA New Account');await extra.locator('[data-payment-field=account_number]').fill('000000000004');
  await page.locator('[data-payment-move="3,-1"]').click();assert.equal(await page.locator('[data-payment-method]').nth(2).locator('[data-payment-field=label]').inputValue(),'Another bank');
  await page.locator('[data-payment-remove="2"]').click();await page.getByRole('button',{name:'Keep option',exact:true}).click();assert.equal(await page.locator('[data-payment-method]').count(),4);
  await page.locator('[data-view=orders]').click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.locator('#payment-options-editor').count(),1);
  await page.evaluate(()=>window.failSave=true);await page.getByRole('button',{name:'Save shop settings',exact:true}).click();await page.locator('.form-error').filter({hasText:'another window'}).waitFor();assert.equal(await page.locator('[data-payment-method]').count(),4);await page.evaluate(()=>window.failSave=false);
  await page.getByRole('button',{name:'Save shop settings',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#payment-options-editor')?.dataset.revision==='2');
  await page.reload();await page.locator('[data-view=settings]').click();await page.locator('[data-payment-method]').nth(3).waitFor();assert.equal(await page.locator('[data-payment-method]').count(),4);
  await page.locator('#payment-options-editor').screenshot({path:join(out,`admin-${width}.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.goto(origin+'/shop.html#order=new&token=fixture');await page.locator('.payment-method').nth(3).waitFor();assert.equal(await page.locator('.payment-method').count(),4);await page.locator('.payment-method').nth(2).click();assert.equal(await page.locator('#payment-number').inputValue(),'000000000004');
  await page.goto(origin+'/shop.html#order=old&token=fixture');await page.locator('[data-payment-options]').waitFor();assert.equal(await page.locator('.payment-method').count(),3);
  assert.deepEqual(errors,[]);results.push({width,role,passed:true});console.log('PASS payment copy, receipt upload, editable methods, saved order snapshots: '+width);await context.close();
 }
}finally{await browser.close();await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));}
