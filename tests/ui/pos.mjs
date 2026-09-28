import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://pos.test',out=join(root,'tests/artifacts/pos');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const products=[{id:'p1',name:'Brownies',price_cents:10000,min_quantity:1,lead_days:0,active:true,option_groups:[],photos:[]},{id:'p2',name:'Cookie box',price_cents:20000,min_quantity:1,lead_days:0,active:true,photos:[],option_groups:[{id:'flavor',label:'Flavor',required_count:1,choices:[{id:'choc',label:'Chocolate',active:true,surcharge_cents:500}]}]}];
const fixture={products,categories:[],orders:[],inventory:[],zones:[],promos:[],email_status:[],settings:{site_url:origin,shop_name:'TLB Kitchen',paused:false},events:[{id:'event1',name:'Weekend pop-up',location:'QA mall',starts_on:today,ends_on:today,revision:1,closed:false,stock:[{product_id:'p1',capacity:10,remaining:10,used:0,price_cents:8000,active:true},{product_id:'p2',capacity:10,remaining:10,used:0,price_cents:15000,active:true}],sales:[]}]};
const original=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=original.slice(original.indexOf('export function money('));
const mock=completeClientFixture(original,`
 export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
 const d=${JSON.stringify(fixture)};window.posCalls=[];window.posOrders=d.orders;
 export async function api(action,p={}){
  window.posCalls.push({action,p:structuredClone(p)});
  if(action==='admin_bootstrap')return {...d,role:window.fixtureRole};
  if(action==='pos_bootstrap')return {events:d.events,orders:d.orders};
  if(action==='pos_quote'){
   const items=p.items.map(i=>{const product=d.products.find(x=>x.id===i.product_id),s=d.events[0].stock.find(x=>x.product_id===i.product_id);const extra=product?.option_groups.reduce((sum,g)=>sum+g.choices.reduce((sum,c)=>sum+(i.selections?.[g.id]?.[c.id]||0)*c.surcharge_cents,0),0)||0;
    const unit_price_cents=p.source==='popup'?s.price_cents+extra:i.unit_price_cents;
    return {...i,name:product?.name||i.name,unit_price_cents,line_total_cents:unit_price_cents*i.quantity};});
   const subtotal_cents=items.reduce((s,i)=>s+i.line_total_cents,0),discount_cents=p.discount.kind==='fixed'?p.discount.value:p.discount.kind==='percent'?Math.round(subtotal_cents*p.discount.value/100):0,delivery_cents=p.method==='delivery'&&!p.delivery_fee_pending?p.delivery_cents:0;
   return {deferred_delivery:p.delivery_fee_pending,delivery_payment_status:p.delivery_fee_pending?'pending':null,items,subtotal_cents,discount_cents,delivery_cents,total_cents:subtotal_cents-discount_cents+delivery_cents,source:p.source,method:p.method,fulfillment_date:p.fulfillment_date,event_id:p.event_id};
  }
  if(action==='pos_create_order'){
   const found=d.orders.find(o=>o.idempotency_key===p.idempotency_key);if(found)return found;
   const o={...p,...p.expected_quote,id:'order'+d.orders.length,reference:'TLB-POS-'+d.orders.length,revision:1,access_token:'a'.repeat(64),created_at:new Date().toISOString(),payment_status:p.payment?'paid':'awaiting_payment',fulfillment_status:p.payment?(p.source==='popup'?'completed':'confirmed'):'pending_confirmation',payment_deadline:p.source==='direct_message'?null:new Date().toISOString(),paid_amount_cents:p.payment?.amount_cents,payment_method:p.payment?.method,cash_received_cents:p.payment?.received_cents,change_cents:p.payment?.received_cents-p.expected_quote.total_cents,event_name:p.source==='popup'?'Weekend pop-up':null};
   d.orders.unshift(o);if(window.loseResponse){window.loseResponse=false;throw Error('Connection lost')};return o;
  }
  if(action==='pos_find_submission')return d.orders.find(o=>o.idempotency_key===p.idempotency_key)||null;
  if(action==='pos_order_link'||action==='get_order')return d.orders.find(o=>o.id===p.order_id);
  if(action==='pos_payment'||action==='pos_update_details'||action==='pos_void_sale'){
   const o=d.orders.find(o=>o.id===p.order_id);
   if(action==='pos_update_details')Object.assign(o,p);
   if(action==='pos_payment')Object.assign(o,{payment_status:'paid',fulfillment_status:'confirmed',payment_method:p.payment.method,cash_received_cents:p.payment.received_cents,change_cents:p.payment.received_cents-o.total_cents});
   if(action==='pos_void_sale')o.fulfillment_status='cancelled';o.revision++;return o;
  }
  if(['pos_delivery_fee','pos_delivery_payment','pos_delivery_reject'].includes(action)){const o=d.orders.find(o=>o.id===p.order_id);if(action==='pos_delivery_fee')Object.assign(o,{delivery_cents:p.amount_cents,total_cents:o.subtotal_cents-o.discount_cents+p.amount_cents,delivery_payment_status:p.amount_cents?'awaiting_payment':'paid'});if(action==='pos_delivery_payment')Object.assign(o,{delivery_payment_status:'paid',delivery_paid_cents:p.payment.amount_cents,delivery_payment_method:p.payment.method,delivery_cash_received_cents:p.payment.received_cents,delivery_change_cents:p.payment.received_cents-p.payment.amount_cents});if(action==='pos_delivery_reject')o.delivery_payment_status='awaiting_payment';o.revision++;return o;}
  if(action==='pos_save_event'){const old=d.events.find(e=>e.id===p.id);const e={...p,id:p.id||'new-event',revision:(old?.revision||0)+1,stock:p.stock.map(s=>({...s,used:0,remaining:s.capacity})),sales:[]};d.events=d.events.filter(x=>x.id!==e.id);d.events.push(e);return e}
  throw Error('Unexpected action '+action);
 }
 export async function upload(){throw Error('Unexpected upload')};export async function websiteVisitorStats(){return {}};
 ${helpers}`);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});await mkdir(out,{recursive:true});const results=[];
try{
 for(const [width,role] of [[1440,'owner'],[390,'owner'],[320,'staff']]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});await context.addInitScript(role=>{window.fixtureRole=role;Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied=text}})},role);
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});if(u.pathname==='/assets/ordering/order-slips.js')return route.fulfill({contentType:'text/javascript',body:'export async function printOrderSlips(orders){window.printed=orders}'});const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)})}catch{return route.fulfill({status:404,body:''})}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/manage.html#pos');await page.locator('[data-pos=add]').first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('[data-pos=add][data-id=p1]').click();await page.locator('[name=qty_0]').fill('2');await page.locator('[name=discount_kind]').selectOption('percent');await page.locator('[name=discount_value]').fill('10');
  await page.screenshot({path:join(out,`counter-${width}.png`)});
  await page.getByRole('button',{name:'Review sale',exact:true}).click();await page.locator('[name=cash_received]').fill('200');assert.match(await page.locator('[data-change]').innerText(),/56\.00/);
  await page.evaluate(()=>window.loseResponse=true);await page.getByRole('button',{name:'Complete sale',exact:true}).click();await page.locator('[data-pos=print]').waitFor();
  assert.equal(await page.evaluate(()=>window.posOrders.length),1);assert.equal(await page.evaluate(()=>window.posOrders[0].total_cents),14400);assert.equal(await page.evaluate(()=>window.posOrders[0].email_notifications),false);
  await page.locator('[data-pos=copy]').click();await page.waitForFunction(()=>window.copied);assert.match(await page.evaluate(()=>window.copied),/shop.html#order=order0&token=/);
  await page.locator('[data-pos=print]').click();assert.equal((await page.evaluate(()=>window.printed))[0].source,'popup');
  await page.locator('[data-pos=new-sale]').click();await page.locator('[data-source=direct_message]').click();await page.locator('[data-pos=custom]').click();await page.locator('#pos-custom-form [name=name]').fill('Custom cake');await page.locator('#pos-custom-form [name=price]').fill('250');await page.getByRole('button',{name:'Add item',exact:true}).click();
  await page.locator('[name=method]').selectOption('delivery');await page.locator('[name=delivery_fee]').fill('50');
  // Every customer field, including recipient and delivery address, stays empty.
  await page.screenshot({path:join(out,`direct-order-${width}.png`)});
  await page.getByRole('button',{name:'Review order',exact:true}).click();await page.getByRole('button',{name:'Create direct order',exact:true}).click();await page.locator('#pos-payment-form').waitFor();
  let saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.source,'direct_message');assert.equal(saved.buyer.name,'');assert.equal(saved.payment_deadline,null);assert.equal(saved.total_cents,30000);
  await page.locator('[data-pos=details]').click();await page.locator('#pos-details-form [name=name]').fill('Optional client');await page.locator('[name=social_platform]').selectOption('Instagram');await page.locator('[name=social_username]').fill('@example');await page.getByRole('button',{name:'Save details',exact:true}).click();await page.locator('#pos-payment-form').waitFor();
  saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.buyer.social_username,'@example');assert.equal(saved.payment_status,'awaiting_payment');
  await page.locator('#pos-payment-form [name=payment_method]').selectOption('eastwest');await page.getByRole('button',{name:'Confirm payment received',exact:true}).click();await page.waitForFunction(()=>window.posOrders[0].payment_status==='paid');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(out,`receipt-${width}.png`)});
  await page.locator('[data-pos=new-sale]').click();await page.locator('[data-pos=custom]').click();await page.locator('#pos-custom-form [name=name]').fill('Delivery test cake');await page.locator('#pos-custom-form [name=price]').fill('100');await page.getByRole('button',{name:'Add item',exact:true}).click();
  await page.locator('[name=method]').selectOption('delivery');await page.locator('[name=delivery_fee_pending]').check();assert.equal(await page.locator('#pos-sale-form [name=delivery_fee]').count(),0);
  await page.getByRole('button',{name:'Review order',exact:true}).click();await page.locator('[name=payment_state]').selectOption('paid');await page.locator('[name=payment_method]').selectOption('gcash');await page.getByRole('button',{name:'Create direct order',exact:true}).click();await page.locator('#pos-delivery-fee-form').waitFor();
  saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.paid_amount_cents,10000);assert.equal(saved.delivery_payment_status,'pending');
  await page.locator('#pos-delivery-fee-form [name=delivery_fee]').fill('15.50');await page.getByRole('button',{name:'Set exact delivery fee',exact:true}).click();await page.locator('#pos-delivery-payment-form').waitFor();
  assert.equal(await page.locator('#pos-payment-form').count(),0);assert.equal(await page.locator('#pos-delivery-payment-form [name=cash_received]').inputValue(),'15.50');await page.locator('#pos-delivery-payment-form [name=cash_received]').fill('20');assert.match(await page.locator('[data-change]').innerText(),/4\.50/);
  await page.getByRole('button',{name:'Confirm delivery payment received',exact:true}).click();await page.waitForFunction(()=>window.posOrders[0].delivery_payment_status==='paid');
  saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.total_cents,11550);assert.equal(saved.paid_amount_cents,10000);assert.equal(saved.delivery_paid_cents,1550);assert.equal(saved.delivery_change_cents,450);assert.equal(await page.locator('#pos-delivery-fee-form').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,`delivery-receipt-${width}.png`)});
  await page.locator('[data-pos=manage-order]').click();await page.locator('[data-action=pos-open-order]').waitFor();assert.match(await page.locator('#admin-dialog').innerText(),/Delivery fee paid/);assert.doesNotMatch(await page.locator('#admin-dialog').innerText(),/Any difference after an order edit/);await page.locator('[data-action=pos-open-order]').click();await page.locator('[data-pos=new-sale]').waitFor();
  await page.locator('[data-pos=new-sale]').click();await page.locator('[data-source=popup]').click();
  if(role==='owner'){
   await page.locator('[data-pos=event-new]').click();await page.locator('#pos-event-form [name=name]').fill('New booth');await page.locator('[name=active_p1]').check();await page.locator('[name=stock_p1]').fill('30');await page.locator('[name=price_p1]').fill('75');await page.getByRole('button',{name:'Save event',exact:true}).click();await page.locator('[name=event_id]').waitFor();assert.equal(await page.locator('[name=event_id]').inputValue(),'new-event');
  }else assert.equal(await page.locator('[data-pos=event-new]').count(),0);
  assert.deepEqual(errors,[]);results.push({width,role,passed:true});await context.close();
 }
 console.log(JSON.stringify(results));await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
}finally{await browser.close()}
