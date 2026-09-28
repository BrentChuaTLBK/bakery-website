import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://pos.test',out=join(root,'tests/artifacts/pos');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const products=[{id:'p1',name:'Brownies',price_cents:10000,min_quantity:1,lead_days:0,active:true,option_groups:[],photos:[]},{id:'p2',name:'Cookie box',price_cents:20000,min_quantity:1,lead_days:0,active:true,photos:[],option_groups:[{id:'flavor',label:'Flavor',required_count:2,choices:[{id:'choc',label:'Chocolate',active:true,surcharge_cents:500},{id:'vanilla',label:'Vanilla',active:true,surcharge_cents:0}]}]}];
products.push({id:'p3',name:'Website cake',price_cents:30000,min_quantity:1,lead_days:1,active:true,option_groups:[],photos:[]});
products.push({...products[1],id:'p4',name:'Nori pouch',option_groups:[{...products[1].option_groups[0],required_count:1}]});
const fixture={products,categories:[],orders:[],inventory:[],zones:[],promos:[],email_status:[],settings:{site_url:origin,shop_name:'TLB Kitchen',paused:false},events:[{id:'event1',name:'Weekend pop-up',location:'QA mall',starts_on:today,ends_on:today,revision:1,closed:false,stock:[{product_id:'p1',capacity:10,remaining:10,used:0,price_cents:8000,active:true},{product_id:'p2',capacity:10,remaining:10,used:0,price_cents:15000,active:true}],sales:[]}]};
fixture.events.push({...fixture.events[0],id:'closed-event',name:'Closed booth',closed:true},{...fixture.events[0],id:'future-event',name:'Future booth',starts_on:'2099-01-01',ends_on:'2099-01-02'});
const original=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=original.slice(original.indexOf('export function money('));
const mock=completeClientFixture(original,`
 export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
 const d=${JSON.stringify(fixture)};window.posCalls=[];window.posOrders=d.orders;const editKeys=new Map();
 d.register_config={revision:1,methods:[{id:'cash',label:'Cash',active:true},{id:'gcash',label:'GCash',active:true},{id:'bdo',label:'BDO',active:true},{id:'eastwest',label:'EastWest',active:true}]};d.cash_sessions=[];const registerKeys=new Map();
 export async function api(action,p={}){
  window.posCalls.push({action,p:structuredClone(p)});
  if(window.pendingFailure&&['pos_create_order','pos_find_submission'].includes(action))throw Error('Temporary network failure');
  if(window.registerFailure&&(action.startsWith('pos_cash_')||action==='pos_register_find'))throw Error('Temporary register connection failure');
  if(action==='pos_bootstrap'&&window.registerRefreshFailure){window.registerRefreshFailure=false;throw Error('Refresh connection failed')}
  if(action==='pos_register_find')return registerKeys.get(p.idempotency_key)||null;
  if(action==='pos_cash_get')return d.cash_sessions.find(s=>s.id===p.session_id);
  if(['pos_cash_open','pos_cash_move','pos_cash_close','pos_payment_methods_save'].includes(action)){
   if(registerKeys.has(p.idempotency_key))return registerKeys.get(p.idempotency_key);
   let result;
   if(action==='pos_payment_methods_save'){d.register_config={...p,revision:d.register_config.revision+1};result=d.register_config}
   else if(action==='pos_cash_open'){
    if(d.cash_sessions.some(s=>s.event_id===p.event_id&&!s.closed_at))throw Error('This event already has an open cash session.');
    result={id:'drawer-'+d.cash_sessions.length,event_id:p.event_id,event_name:d.events.find(e=>e.id===p.event_id).name,opened_at:new Date().toISOString(),opening_cents:p.opening_cents,expected_cents:p.opening_cents,cash_collected_cents:0,cash_in_cents:0,cash_out_cents:0,movements:[],payment_totals:[],revision:1};d.cash_sessions.unshift(result);
   }else{
    result=d.cash_sessions.find(s=>s.id===p.session_id);if(result.closed_at||p.revision!==result.revision)throw Error('The drawer changed. Refresh first.');
    if(action==='pos_cash_close'){if(p.counted_cents!==result.expected_cents&&!p.note)throw Error('Explain the difference.');Object.assign(result,{closed_at:new Date().toISOString(),counted_cents:p.counted_cents,expected_at_close_cents:result.expected_cents,difference_cents:p.counted_cents-result.expected_cents,closing_note:p.note})}
    else {result.movements.unshift({...p,created_at:new Date().toISOString()});result[p.kind+'_cents']+=p.amount_cents;result.expected_cents+=p.kind==='cash_in'?p.amount_cents:-p.amount_cents}
    result.revision++;
   }
   registerKeys.set(p.idempotency_key,structuredClone(result));if(window.loseRegisterResponse){window.loseRegisterResponse=false;throw Error('Lost register response')};return result;
  }
  if(action==='admin_bootstrap')return {...d,role:window.fixtureRole};
  if(action==='pos_bootstrap'){if(window.closeEventId){const target=d.events.find(e=>e.id===window.closeEventId);target.closed=true;window.closeEventId=null;}return {events:d.events,orders:d.orders,cash_sessions:d.cash_sessions,register_config:d.register_config};}
  if(action==='pos_quote'||action==='pos_preview_edit'){
   if(action==='pos_preview_edit'&&d.orders.find(o=>o.id===p.order_id)?.revision!==p.revision)throw Error('This order changed. Reopen it before editing.');
   if(p.source==='popup'&&d.events.find(e=>e.id===p.event_id)?.closed)throw Error('Choose an open pop-up event.');
   const items=p.items.map(i=>{const product=d.products.find(x=>x.id===i.product_id),event=d.events.find(e=>e.id===p.event_id),s=i.custom_event_item_id?event?.custom_stock.find(x=>x.id===i.custom_event_item_id):event?.stock.find(x=>x.product_id===i.product_id);const extra=(p.source==='popup'&&s?.options_tracked?s.option_groups:product?.option_groups)?.reduce((sum,g)=>sum+g.choices.reduce((sum,c)=>sum+(i.selections?.[g.id]?.[c.id]||0)*c.surcharge_cents,0),0)||0;
    const unit_price_cents=p.source==='popup'?s.price_cents+extra:product?product.price_cents+extra:i.unit_price_cents;
    return {...i,name:product?.name||i.name,unit_price_cents,line_total_cents:unit_price_cents*i.quantity};});
   const subtotal_cents=items.reduce((s,i)=>s+i.line_total_cents,0),discount_cents=p.discount.kind==='fixed'?p.discount.value:p.discount.kind==='percent'?Math.round(subtotal_cents*p.discount.value/100):0,delivery_cents=p.method==='delivery'&&!p.delivery_fee_pending?p.delivery_cents:0;
   return {deferred_delivery:p.delivery_fee_pending,delivery_payment_status:p.delivery_fee_pending?'pending':null,items,subtotal_cents,discount_cents,delivery_cents,total_cents:subtotal_cents-discount_cents+delivery_cents,source:p.source,method:p.method,fulfillment_date:p.fulfillment_date,event_id:p.event_id};
  }
  if(action==='pos_find_edit')return editKeys.get(p.idempotency_key)||null;
  if(action==='pos_update_order'){
   if(editKeys.has(p.idempotency_key))return editKeys.get(p.idempotency_key);
   const o=d.orders.find(o=>o.id===p.order_id);if(o.revision!==p.revision)throw Error('This order changed.');
   Object.assign(o,p.expected_quote,{buyer:p.buyer,recipient:p.recipient,address:p.address,instructions:p.instructions,discount:p.discount,override_dates:p.override_dates,override_reason:p.override_reason,email_notifications:p.email_notifications,revision:o.revision+1});
   editKeys.set(p.idempotency_key,o);if(window.loseEditResponse){window.loseEditResponse=false;throw Error('Connection lost after editing')};return o;
  }
  if(action==='pos_create_order'){
   const found=d.orders.find(o=>o.idempotency_key===p.idempotency_key);if(found)return found;
   const session=p.source==='popup'?d.cash_sessions.find(s=>s.event_id===p.event_id&&!s.closed_at):null;
   if(p.source==='popup'&&p.payment?.method==='cash'&&(!session||p.payment.cash_session_id!==session.id))throw Error('Open a cash session first.');
   const o={...p,...p.expected_quote,id:'order'+d.orders.length,reference:'TLB-POS-'+d.orders.length,revision:1,access_token:'a'.repeat(64),created_at:new Date().toISOString(),payment_status:p.payment?'paid':'awaiting_payment',fulfillment_status:p.payment?(p.source==='popup'?'completed':'confirmed'):'pending_confirmation',payment_deadline:p.source==='direct_message'?null:new Date().toISOString(),paid_amount_cents:p.payment?.amount_cents,payment_method:p.payment?.method,cash_received_cents:p.payment?.received_cents,change_cents:p.payment?.received_cents-p.expected_quote.total_cents,event_name:p.source==='popup'?'Weekend pop-up':null};
   if(p.payment)o.payment_method_label=d.register_config.methods.find(m=>m.id===p.payment.method).label;
   if(session&&p.payment){o.cash_session_id=session.id;const n=p.payment.amount_cents;if(p.payment.method==='cash'){session.cash_collected_cents+=n;session.expected_cents+=n};let t=session.payment_totals.find(m=>m.method===p.payment.method);if(!t){t={method:p.payment.method,method_label:o.payment_method_label,sales:0,amount_cents:0};session.payment_totals.push(t)}t.sales++;t.amount_cents+=n;session.revision++}
   d.orders.unshift(o);if(window.loseResponse){window.loseResponse=false;throw Error('Connection lost')};return o;
  }
  if(action==='pos_find_submission')return d.orders.find(o=>o.idempotency_key===p.idempotency_key)||null;
  if(action==='pos_order_link'||action==='get_order')return d.orders.find(o=>o.id===p.order_id);
  if(action==='pos_payment'||action==='pos_update_details'||action==='pos_void_sale'){
   const o=d.orders.find(o=>o.id===p.order_id);
   if(action==='pos_update_details')Object.assign(o,p);
   if(action==='pos_payment')Object.assign(o,{payment_status:'paid',fulfillment_status:'confirmed',paid_amount_cents:p.payment.amount_cents,payment_method:p.payment.method,cash_received_cents:p.payment.received_cents,change_cents:p.payment.received_cents-o.total_cents});
   if(action==='pos_void_sale')o.fulfillment_status='cancelled';o.revision++;return o;
  }
  if(['pos_delivery_fee','pos_delivery_payment','pos_delivery_reject'].includes(action)){const o=d.orders.find(o=>o.id===p.order_id);if(action==='pos_delivery_fee')Object.assign(o,{delivery_cents:p.amount_cents,total_cents:o.subtotal_cents-o.discount_cents+p.amount_cents,delivery_payment_status:p.amount_cents?'awaiting_payment':'paid'});if(action==='pos_delivery_payment')Object.assign(o,{delivery_payment_status:'paid',delivery_paid_cents:p.payment.amount_cents,delivery_payment_method:p.payment.method,delivery_cash_received_cents:p.payment.received_cents,delivery_change_cents:p.payment.received_cents-p.payment.amount_cents});if(action==='pos_delivery_reject')o.delivery_payment_status='awaiting_payment';o.revision++;return o;}
  if(action==='pos_save_event'){const old=d.events.find(e=>e.id===p.id);const e={...p,id:p.id||'new-event',revision:(old?.revision||0)+1,stock:p.stock.map(s=>({...s,used:0,remaining:s.capacity,option_groups:s.option_groups?.map(g=>({...g,choices:g.choices.map(c=>({...c,used:0,remaining:c.capacity}))}))})),custom_stock:(p.custom_stock||[]).map(s=>({...s,used:0,remaining:s.capacity,option_groups:s.option_groups?.map(g=>({...g,choices:g.choices.map(c=>({...c,used:0,remaining:c.capacity}))}))})),sales:[]};d.events=d.events.filter(x=>x.id!==e.id);d.events.push(e);return e}
  throw Error('Unexpected action '+action);
 }
 export async function upload(){throw Error('Unexpected upload')};export async function websiteVisitorStats(){return {}};
 ${helpers}`);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});await mkdir(out,{recursive:true});const results=[];
try{
 for(const [width,role] of [[1440,'owner'],[820,'owner'],[390,'owner'],[320,'owner'],[320,'staff']]){
  const context=await browser.newContext({viewport:{width,height:width<760?844:1000},serviceWorkers:'block'});await context.addInitScript(role=>{window.fixtureRole=role;Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied=text}})},role);
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});if(u.pathname==='/assets/ordering/order-slips.js')return route.fulfill({contentType:'text/javascript',body:'export async function printOrderSlips(orders){window.printed=orders}'});const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)})}catch{return route.fulfill({status:404,body:''})}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const basket=async()=>{if(width<760&&await page.locator('[data-pos=mobile-basket]').isVisible())await page.locator('[data-pos=mobile-basket]').click()};
  const productView=async()=>{if(width<760)await page.locator('[data-pos=mobile-products]').click()};
  const openCashDrawer=async()=>{
   await page.locator('[data-pos=section][data-section=drawer]').click();await page.locator('.pos-cash-panel').waitFor();
   if(await page.locator('#pos-cash-open-form').count()){await page.locator('[name=opening]').fill('1000');await page.getByRole('button',{name:'Open cash session',exact:true}).click();await page.locator('[data-pos=cash-mode]').first().waitFor()}
   await page.locator('[data-pos=cash-back]').click();await productView();
  };
  await page.goto(origin+'/manage.html#pos');await page.locator('[data-pos=add]').first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('.pos-section-nav button').evaluateAll(buttons=>buttons.every(button=>{const r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=44})),true,'Every POS section is visible and touch-sized without horizontal scrolling');
  assert.equal(await page.locator('[data-pos=event-new]').count(),0);assert.equal(await page.locator('[data-pos=event-edit]').count(),0);assert.equal(await page.locator('.pos-recent').count(),0);
  assert.equal(await page.locator('[data-pos=section][data-section=setup]').count(),role==='owner'?1:0);
  if(width<760){assert.equal(await page.locator('.admin-sidebar').isVisible(),false);assert.equal(await page.locator('.pos-basket-panel').isVisible(),false);const dock=await page.locator('.pos-mobile-dock').boundingBox();assert.ok(dock.y+dock.height<=845);assert.ok(dock.y>700)}
  assert.equal(await page.locator('[name=event_id] option').count(),2);
  if(width===820){assert.equal(await page.locator('.admin-sidebar').isVisible(),false);assert.equal(await page.locator('.pos-basket-panel').isVisible(),true)}
  await page.screenshot({path:join(out,`selling-products-${width}.png`)});await openCashDrawer();
  assert.equal(await page.locator('[data-pos=add][data-id=p3]').count(),0);await page.locator('[data-pos=add][data-id=p1]').click();await page.locator('[data-pos=add][data-id=p1]').click();assert.equal(await page.locator('.pos-cart li').count(),1);assert.equal(await page.locator('[name=qty_0]').inputValue(),'2');
  await page.locator('[data-pos=section][data-section=orders]').click();assert.equal(await page.locator('.pos-products-panel').count(),0);await page.locator('[data-pos=section][data-section=sell]').click();assert.equal(await page.locator('[name=qty_0]').inputValue(),'2');
  await basket();
  await page.getByRole('button',{name:'Increase Brownies quantity',exact:true}).click();assert.equal(await page.locator('[name=qty_0]').inputValue(),'3');assert.match(await page.locator('[data-line-total]').innerText(),/240\.00.*for 3/);
  await page.getByRole('button',{name:'Decrease Brownies quantity',exact:true}).click();assert.equal(await page.locator('[name=qty_0]').inputValue(),'2');
  if(width<760){await page.locator('[name=qty_0]').fill('0');await productView();const before=await page.evaluate(()=>window.posCalls.filter(c=>c.action==='pos_quote').length);await page.evaluate(()=>document.querySelector('#pos-sale-form').requestSubmit());assert.equal(await page.locator('.pos-basket-panel').isVisible(),true);assert.equal(await page.evaluate(()=>window.posCalls.filter(c=>c.action==='pos_quote').length),before);await page.locator('[name=qty_0]').fill('2')}
  await page.locator('[name=discount_kind]').selectOption('percent');await page.locator('[name=discount_value]').fill('10');
  await page.screenshot({path:join(out,`counter-${width}.png`)});
  await page.getByRole('button',{name:'Review sale',exact:true}).click();await page.locator('[name=cash_received]').fill('200');assert.match(await page.locator('[data-change]').innerText(),/56\.00/);
  await page.evaluate(()=>window.loseResponse=true);await page.getByRole('button',{name:'Complete sale',exact:true}).click();await page.locator('[data-pos=print]').waitFor();
  assert.equal(await page.evaluate(()=>window.posOrders.length),1);assert.equal(await page.evaluate(()=>window.posOrders[0].total_cents),14400);assert.equal(await page.evaluate(()=>window.posOrders[0].email_notifications),false);
  await page.locator('[data-pos=copy]').click();await page.waitForFunction(()=>window.copied);assert.match(await page.evaluate(()=>window.copied),/shop.html#order=order0&token=/);
  await page.locator('[data-pos=print]').click();assert.equal((await page.evaluate(()=>window.printed))[0].source,'popup');
  await page.locator('[data-pos=new-sale]').click();await page.locator('[data-source=direct_message]').click();
  await page.locator('[data-pos=add][data-id=p1]').click();await page.locator('[data-pos=add][data-id=p1]').click();assert.equal(await page.locator('[name=qty_0]').inputValue(),'2');assert.equal(await page.locator('[name=price_0]').count(),0);await basket();await page.locator('[data-pos=remove]').click();await productView();
  for(const variant of ['Chocolate','Chocolate','Vanilla']){
   const beforeItems=await page.locator('.pos-cart li').count();await page.locator('[data-pos=add][data-id=p2]').click();assert.equal(await page.locator('#pos-options-dialog').evaluate(d=>d.open),true);assert.equal(await page.locator('.pos-products-panel').isVisible(),true);
   assert.equal(await page.locator('#pos-options-dialog').evaluate(d=>d.contains(document.activeElement)),true);assert.equal(await page.getByRole('button',{name:'Add to order',exact:true}).isDisabled(),true);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#pos-options-dialog').count(),0);assert.equal(await page.locator('.pos-cart li').count(),beforeItems);assert.equal(await page.locator('[data-pos=add][data-id=p2]').evaluate(b=>b===document.activeElement),true);
   await page.locator('[data-pos=add][data-id=p2]').click();const plus=page.getByRole('button',{name:`Increase ${variant} quantity`,exact:true});
   await plus.click();await plus.click();assert.equal(await plus.isDisabled(),true);assert.match(await page.locator('[data-option-count]').innerText(),/2 of 2/);
   await page.getByRole('button',{name:`Decrease ${variant} quantity`,exact:true}).click();assert.equal(await plus.isDisabled(),false);await plus.click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,`options-${width}.png`)});
   await page.getByRole('button',{name:'Add to order',exact:true}).click();
  }
  assert.equal(await page.locator('[data-pos=remove]').count(),2);assert.equal(await page.locator('[name=qty_0]').inputValue(),'2');assert.equal(await page.locator('[name=qty_1]').inputValue(),'1');assert.equal(await page.locator('[name^=price_]').count(),0);
  await basket();await page.locator('[data-pos=remove]').first().click();await page.locator('[data-pos=remove]').first().click();
  const calendar=page.locator('.accounting-date-picker').filter({has:page.locator('[name=fulfillment_date]')});await calendar.locator('summary').click();await calendar.locator(`[data-date-value="${today}"]`).click();assert.equal(await page.locator('[name=fulfillment_date]').inputValue(),today);assert.equal(await page.locator('input[type=date]').count(),0);
  await page.locator('#pos-sale-form [name=name]').fill('Client draft');await productView();
  const customCalls=await page.evaluate(()=>window.posCalls.length);
  for(const close of ['Escape','Close custom item','Cancel','backdrop']){
   await page.locator('[data-pos=custom]').click();
   assert.equal(await page.locator('#pos-custom-dialog').evaluate(d=>d.open),true);
   assert.equal(await page.locator('.pos-products-panel').isVisible(),true);
   assert.equal(await page.locator('#pos-manager').getAttribute('data-screen'),'sale');
   assert.equal(await page.locator('#pos-custom-form [name=name]').evaluate(el=>el===document.activeElement),true);
   assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow),'hidden');
   await page.locator('#pos-custom-form [name=name]').fill('Discarded item');
   await page.locator('#pos-custom-form [name=price]').fill('9');
   if(close==='Escape')await page.keyboard.press('Escape');
   else if(close==='backdrop')await page.mouse.click(2,2);
   else await page.getByRole('button',{name:close,exact:true}).click();
   assert.equal(await page.locator('#pos-custom-dialog').count(),0);
   assert.equal(await page.locator('.pos-cart [data-cart-line]').count(),0);
   assert.equal(await page.locator('#pos-sale-form [name=name]').inputValue(),'Client draft');
   assert.equal(await page.locator('[name=fulfillment_date]').inputValue(),today);
   assert.equal(await page.locator('[data-pos=custom]').evaluate(el=>el===document.activeElement),true);
  }
  assert.equal(await page.evaluate(()=>window.posCalls.length),customCalls,'Opening and cancelling custom items must not call the backend');
  await page.locator('[data-pos=custom]').click();await page.getByRole('button',{name:'Add item',exact:true}).click();
  assert.equal(await page.locator('#pos-custom-dialog').evaluate(d=>d.open),true,'An empty item is rejected inside the popup');
  await page.locator('#pos-custom-form [name=name]').fill('Custom cake');await page.locator('#pos-custom-form [name=price]').fill('250');
  assert.equal(await page.locator('#pos-custom-dialog').evaluate(d=>{const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),true);
  await page.screenshot({path:join(out,`custom-item-popup-${width}-${role}.png`)});
  await page.getByRole('button',{name:'Add item',exact:true}).click();await basket();
  assert.equal(await page.locator('#pos-custom-dialog').count(),0);assert.equal(await page.locator('.pos-cart [data-cart-line]').count(),1);
  assert.equal(await page.locator('#pos-sale-form [name=name]').inputValue(),'Client draft');
  await page.locator('#pos-sale-form [name=name]').fill('');
  await page.locator('[name=method]').selectOption('delivery');await page.locator('[name=delivery_fee]').fill('50');
  if(width===1440){
   await page.locator('#pos-sale-form [name=name]').fill('Client remains separate');await page.locator('[name=qty_0]').fill('10000');
   await page.locator('[data-pos=custom]').click();await page.locator('#pos-custom-form [name=name]').fill('Custom cake');await page.locator('#pos-custom-form [name=price]').fill('250');
   await page.getByRole('button',{name:'Add item',exact:true}).click();
   assert.match(await page.locator('#pos-custom-dialog [role=alert]').innerText(),/10000 units/);
   assert.equal(await page.locator('#pos-custom-form [name=name]').inputValue(),'Custom cake');
   assert.equal(await page.locator('#pos-custom-form [name=price]').inputValue(),'250');
   assert.equal(await page.locator('#pos-sale-form [name=name]').inputValue(),'Client remains separate');
   assert.equal(await page.locator('[name=qty_0]').inputValue(),'10000');
   assert.equal(await page.locator('[name=method]').inputValue(),'delivery');assert.equal(Number(await page.locator('[name=delivery_fee]').inputValue()),50);
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   await page.locator('[name=qty_0]').fill('1');await page.locator('#pos-sale-form [name=name]').fill('');
  }
  // Every customer field, including recipient and delivery address, stays empty.
  await page.locator('[name=social_username]').fill('@draft-client');await page.locator('[data-pos=section][data-section=orders]').click();await page.locator('[data-pos=section][data-section=sell]').click();await basket();assert.equal(await page.locator('[name=social_username]').inputValue(),'@draft-client');await page.locator('[name=social_username]').fill('');
  await page.screenshot({path:join(out,`direct-order-${width}.png`)});
  await page.getByRole('button',{name:'Review order',exact:true}).click();await page.getByRole('button',{name:'Create direct order',exact:true}).click();await page.locator('#pos-payment-form').waitFor();
  let saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.source,'direct_message');assert.equal(saved.buyer.name,'');assert.equal(saved.payment_deadline,null);assert.equal(saved.total_cents,30000);
  await page.locator('[data-pos=details]').click();await page.locator('#pos-details-form [name=name]').fill('Optional client');await page.locator('[name=social_platform]').selectOption('Instagram');await page.locator('[name=social_username]').fill('@example');await page.getByRole('button',{name:'Save details',exact:true}).click();await page.locator('#pos-payment-form').waitFor();
  saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.buyer.social_username,'@example');assert.equal(saved.payment_status,'awaiting_payment');
  const editId=saved.id,editReference=saved.reference,editLink=await page.locator('[data-share-link]').inputValue(),orderCount=await page.evaluate(()=>window.posOrders.length);
  await page.getByRole('button',{name:'Edit order',exact:true}).click();await page.locator('[name=qty_0]').fill('3');
  await page.getByRole('button',{name:'Cancel edits',exact:true}).click();await page.getByRole('button',{name:'Discard edits',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.posOrders[0].total_cents),30000);assert.equal(await page.locator('[data-share-link]').inputValue(),editLink);
  await page.getByRole('button',{name:'Edit order',exact:true}).click();assert.equal(await page.locator('#pos-sale-form [name=name]').inputValue(),'Optional client');
  assert.equal(await page.locator('[name=social_username]').inputValue(),'@example');assert.equal(await page.locator('[name=method]').inputValue(),'delivery');assert.equal(Number(await page.locator('[name=delivery_fee]').inputValue()),50);
  await page.locator('[name=qty_0]').fill('2');await page.locator('[name=discount_kind]').selectOption('fixed');await page.locator('[name=discount_value]').fill('25');
  await page.locator('[name=instructions]').fill('Updated direct order');
  await page.screenshot({path:join(out,`edit-direct-order-${width}-${role}.png`)});
  await page.getByRole('button',{name:'Review changes',exact:true}).click();assert.match(await page.locator('.pos-review').innerText(),/525.00/);
  assert.equal(await page.locator('[name=payment_state]').count(),0);assert.equal(await page.locator('[name=cash_received]').count(),0);
  await page.getByRole('button',{name:'Back to edit',exact:true}).click();assert.equal(await page.locator('[name=qty_0]').inputValue(),'2');
  await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.locator('[name=amendment_reason]').fill('Customer added one cake');
  await page.evaluate(()=>window.loseEditResponse=true);await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.locator('#pos-payment-form').waitFor();
  saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.id,editId);assert.equal(saved.reference,editReference);assert.equal(saved.total_cents,52500);assert.equal(saved.payment_status,'awaiting_payment');
  assert.equal(await page.locator('[data-share-link]').inputValue(),editLink);assert.equal(await page.evaluate(()=>window.posOrders.length),orderCount);
  assert.equal(await page.evaluate(()=>window.posCalls.filter(c=>c.action==='pos_update_order').length),1);
  assert.equal(await page.evaluate(()=>window.posCalls.some(c=>c.action==='pos_find_edit')),true);
  await page.locator('#pos-payment-form [data-pos-payment=eastwest]').click();await page.getByRole('button',{name:'Confirm payment received',exact:true}).click();await page.waitForFunction(()=>window.posOrders[0].payment_status==='paid');
  await page.getByRole('button',{name:'Edit order',exact:true}).click();await page.locator('[name=price_0]').fill('300');await productView();await page.locator('[data-pos=add][data-id=p1]').click();await basket();
  assert.equal(await page.locator('[name=price_1]').count(),0,'Website prices stay locked when editing');
  await page.getByRole('button',{name:'Review changes',exact:true}).click();assert.match(await page.locator('.pos-review .notice').innerText(),/stays Paid/);
  assert.match(await page.locator('.pos-review').innerText(),/725.00/);assert.equal(await page.locator('[name=payment_state]').count(),0);
  await page.screenshot({path:join(out,`review-paid-edit-${width}-${role}.png`)});
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.locator('[data-share-link]').waitFor();
  saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.id,editId);assert.equal(saved.payment_status,'paid');assert.equal(saved.total_cents,72500);assert.equal(saved.paid_amount_cents,52500);
  assert.equal(await page.locator('#pos-payment-form').count(),0);assert.equal(await page.locator('[data-share-link]').inputValue(),editLink);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(out,`receipt-${width}.png`)});
  await page.locator('[data-pos=new-sale]').click();await page.locator('[data-pos=custom]').click();await page.locator('#pos-custom-form [name=name]').fill('Delivery test cake');await page.locator('#pos-custom-form [name=price]').fill('100');await page.getByRole('button',{name:'Add item',exact:true}).click();
  await page.locator('[name=method]').selectOption('delivery');await page.locator('[name=delivery_fee_pending]').check();assert.equal(await page.locator('#pos-sale-form [name=delivery_fee]').count(),0);
  await page.getByRole('button',{name:'Review order',exact:true}).click();await page.locator('[name=payment_state]').selectOption('paid');await page.locator('[data-pos-payment=gcash]').click();await page.getByRole('button',{name:'Create direct order',exact:true}).click();await page.locator('#pos-delivery-fee-form').waitFor();
  saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.paid_amount_cents,10000);assert.equal(saved.delivery_payment_status,'pending');
  await page.locator('#pos-delivery-fee-form [name=delivery_fee]').fill('15.50');await page.getByRole('button',{name:'Set exact delivery fee',exact:true}).click();await page.locator('#pos-delivery-payment-form').waitFor();
  assert.equal(await page.locator('#pos-payment-form').count(),0);assert.equal(await page.locator('#pos-delivery-payment-form [name=cash_received]').inputValue(),'15.50');await page.locator('#pos-delivery-payment-form [name=cash_received]').fill('20');assert.match(await page.locator('[data-change]').innerText(),/4\.50/);
  await page.getByRole('button',{name:'Confirm delivery payment received',exact:true}).click();await page.waitForFunction(()=>window.posOrders[0].delivery_payment_status==='paid');
  saved=await page.evaluate(()=>window.posOrders[0]);assert.equal(saved.total_cents,11550);assert.equal(saved.paid_amount_cents,10000);assert.equal(saved.delivery_paid_cents,1550);assert.equal(saved.delivery_change_cents,450);assert.equal(await page.locator('#pos-delivery-fee-form').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,`delivery-receipt-${width}.png`)});
  await page.locator('[data-pos=manage-order]').click();await page.locator('[data-action=pos-open-order]').waitFor();assert.match(await page.locator('#admin-dialog').innerText(),/Delivery fee paid/);assert.doesNotMatch(await page.locator('#admin-dialog').innerText(),/Any difference after an order edit/);await page.locator('[data-action=pos-open-order]').click();await page.locator('[data-pos=new-sale]').waitFor();
  await page.locator('[data-pos=new-sale]').click();await page.locator('[data-source=popup]').click();
  if(role==='owner'){
   await page.locator('[data-pos=section][data-section=setup]').click();assert.equal(await page.locator('.pos-products-panel').count(),0);assert.equal(await page.locator('.pos-mobile-dock').count(),0);
   assert.equal(await page.locator('[data-pos=event-sell][data-id=closed-event]').isDisabled(),true);assert.equal(await page.locator('[data-pos=event-sell][data-id=future-event]').isDisabled(),true);
   await page.screenshot({path:join(out,`setup-list-${width}.png`)});
   await page.locator('[data-pos=event-new]').click();await page.locator('#pos-event-form [name=name]').fill('New booth');await page.locator('[data-pos=section][data-section=sell]').click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.locator('#pos-event-form [name=name]').inputValue(),'New booth');assert.equal(await page.locator('[data-stock-id]').count(),0);assert.equal(await page.locator('[data-pos=event-add]').count(),0);
   await page.locator('[data-pos=event-picker]').click();await page.locator('[name=event_search]').fill('Brown');await page.locator('[data-pos=event-add][data-id=p1]').click();assert.equal(await page.locator('#pos-event-form [name=name]').inputValue(),'New booth');
   await page.getByRole('button',{name:'Done',exact:true}).click();await page.locator('[name=stock_p1]').fill('30');await page.locator('[name=event_price_p1]').fill('75');
   await page.locator('[data-pos=event-custom]').click();await page.locator('[name^=custom_name_]').fill('Event cookie');await page.locator('[name^=custom_description_]').fill('Only here');await page.locator('[name^=stock_]').last().fill('12');await page.locator('[name^=event_price_]').last().fill('35');assert.equal(await page.locator('[name=stock_p1]').inputValue(),'30');assert.equal(await page.locator('[name=event_price_p1]').inputValue(),'75');
   const eventCalendar=page.locator('.accounting-date-picker').filter({has:page.locator('[name=starts_on]')});await eventCalendar.locator('summary').click();await eventCalendar.locator(`[data-date-value="${today}"]`).click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,`event-setup-${width}.png`)});await page.getByRole('button',{name:'Save event',exact:true}).click();await page.locator('[data-pos=event-sell][data-id=new-event]').waitFor();assert.equal(await page.locator('[name=event_id]').count(),0);assert.match(await page.locator('.pos-status').innerText(),/Event saved/);await page.locator('[data-pos=event-sell][data-id=new-event]').click();await page.locator('[name=event_id]').waitFor();assert.equal(await page.locator('[name=event_id]').inputValue(),'new-event');
   assert.equal(await page.locator('[data-pos=add]').count(),1);assert.equal(await page.locator('[data-pos=add-event-custom]').count(),1);assert.equal(await page.locator('[data-pos=add][data-id=p3]').count(),0);
   await page.locator('[data-pos=section][data-section=setup]').click();await page.locator('[data-pos=event-edit][data-id=new-event]').click();await page.locator('[data-pos=event-remove][data-id=p1]').click();assert.equal(await page.locator('[data-stock-id]').count(),1);await page.getByRole('button',{name:'Save event',exact:true}).click();await page.locator('[data-pos=event-sell][data-id=new-event]').click();await page.locator('[data-pos=add-event-custom]').waitFor();assert.equal(await page.locator('[data-pos=add]').count(),0);
   await openCashDrawer();await page.locator('[data-pos=add-event-custom]').click();await page.locator('[data-pos=add-event-custom]').click();assert.equal(await page.locator('[name=qty_0]').inputValue(),'2');await basket();await page.getByRole('button',{name:'Review sale',exact:true}).click();await page.getByRole('button',{name:'Complete sale',exact:true}).click();await page.locator('[data-pos=print]').waitFor();assert.equal(await page.evaluate(()=>window.posOrders[0].total_cents),7000);
  }else assert.equal(await page.locator('[data-pos=event-new]').count(),0);
  if(width===390){
   await page.locator('[data-pos=new-sale]').click();await page.locator('[data-source=direct_message]').click();await page.locator('[data-pos=custom]').click();await page.locator('#pos-custom-form [name=name]').fill('Retry order');await page.locator('#pos-custom-form [name=price]').fill('10');await page.getByRole('button',{name:'Add item',exact:true}).click();await page.getByRole('button',{name:'Review order',exact:true}).click();
   const count=await page.evaluate(()=>window.posOrders.length);await page.evaluate(()=>window.pendingFailure=true);await page.getByRole('button',{name:'Create direct order',exact:true}).click();await page.getByRole('button',{name:'Retry saving this order',exact:true}).waitFor();assert.equal(await page.locator('[data-pos=section][data-section=setup]').isDisabled(),true);assert.equal(await page.locator('#pos-manager').getAttribute('data-busy'),'true');
   await page.evaluate(()=>window.pendingFailure=false);await page.getByRole('button',{name:'Retry saving this order',exact:true}).click();await page.locator('[data-pos=print]').waitFor();assert.equal(await page.evaluate(()=>window.posOrders.length),count+1);
   await page.locator('[data-pos=new-sale]').click();await page.locator('[data-source=popup]').click();await page.locator('[data-pos=add-event-custom]').click();
   const selected=await page.locator('[name=event_id]').inputValue();await page.evaluate(id=>window.closeEventId=id,selected);await page.locator('[data-pos=section][data-section=orders]').click();await page.locator('[data-pos=refresh]').click();await page.locator('[data-pos=section][data-section=sell]').click();assert.match(await page.locator('.pos-products-panel .notice').innerText(),/no longer open/);assert.equal(await page.locator('[name=event_id]').inputValue(),'');await basket();await page.getByRole('button',{name:'Review sale',exact:true}).click();assert.match(await page.locator('.pos-error').innerText(),/open pop-up event/);assert.equal(await page.evaluate(()=>window.posCalls.filter(c=>c.action==='pos_quote').at(-1).p.event_id),selected);await page.locator('[data-pos=remove]').click();

  }
  if(role==='owner'){
   await page.locator('[data-pos=section][data-section=setup]').click();await page.locator('[data-pos=event-new]').click();await page.locator('#pos-event-form [name=name]').fill('Flavor booth');
   await page.locator('[data-pos=event-picker]').first().click();await page.locator('[data-pos=event-add][data-id=p2]').click();await page.locator('[data-pos=event-add][data-id=p4]').click();
   const pouch=page.locator('[data-stock-id=p4]'),box=page.locator('[data-stock-id=p2]');
   assert.equal(await pouch.locator('[name=stock_p4]').getAttribute('readonly'),'');
   await pouch.locator('[name=flavor_p4_flavor_choc]').fill('3');await pouch.locator('[name=flavor_p4_flavor_vanilla]').fill('5');assert.equal(await pouch.locator('[name=stock_p4]').inputValue(),'8');
   await pouch.locator('[name=flavor_p4_flavor_vanilla_active]').uncheck();await pouch.locator('[data-pos=event-flavor-add]').click();
   await pouch.locator('[data-pos=event-flavor-remove]').click();assert.equal(await pouch.locator('[data-flavor-id^=event-]').count(),0);await pouch.locator('[data-pos=event-flavor-add]').click();
   const extra=pouch.locator('[data-flavor-id^=event-]');await extra.locator('input[type=text]').fill('Truffle');await extra.locator('input[name$=_price]').fill('10');await extra.locator('input[type=number]').first().fill('2');const extraId=await extra.getAttribute('data-flavor-id');
   assert.equal(await pouch.locator('[name=stock_p4]').inputValue(),'10');assert.equal(await pouch.locator('[name=flavor_p4_flavor_vanilla_active]').isChecked(),false);
   await box.locator('[name=stock_p2]').fill('10');await box.locator('[name=flavor_p2_flavor_choc]').fill('1');await box.locator('[name=flavor_p2_flavor_vanilla]').fill('2');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await pouch.screenshot({path:join(out,`flavor-stock-${width}.png`)});
   await pouch.locator('[data-pos=event-flavor-add]').click();let blank=pouch.locator('[data-flavor-id^=event-]').last();await blank.locator('input[type=number]').first().fill('2');assert.equal(await page.locator('#pos-event-form').evaluate(f=>f.checkValidity()),false);await blank.locator('input[type=checkbox]').uncheck();assert.equal(await page.locator('#pos-event-form').evaluate(f=>f.checkValidity()),true);assert.equal(await pouch.locator('[name=stock_p4]').inputValue(),'10');
   await pouch.locator('[data-pos=event-flavor-add]').click();assert.equal(await page.locator('#pos-event-form').evaluate(f=>f.checkValidity()),true);
   await pouch.locator('[data-pos=event-flavor-add]').click();await pouch.locator('[data-flavor-id^=event-]').last().locator('input[type=text]').fill('Temporary flavor');
   await page.getByRole('button',{name:'Save event',exact:true}).click();await page.locator('[data-pos=event-edit][data-id=new-event]').click();
   assert.equal(await pouch.locator('[data-flavor-id^=event-]').count(),2);await pouch.getByRole('button',{name:'Remove Temporary flavor',exact:true}).click();assert.equal(await pouch.locator('[data-flavor-id^=event-]').count(),1);
   assert.equal(await page.locator('[name=stock_p4]').inputValue(),'10');assert.equal(await page.locator(`[data-flavor-id="${extraId}"] input[type=text]`).inputValue(),'Truffle');await page.getByRole('button',{name:'Save event',exact:true}).click();
   const savedStock=await page.evaluate(()=>window.posCalls.filter(c=>c.action==='pos_save_event').at(-1).p.stock);
   assert.equal(savedStock.find(s=>s.product_id==='p4').options_tracked,true);assert.equal(savedStock.find(s=>s.product_id==='p4').option_groups[0].choices[2].surcharge_cents,1000);
   await page.locator('[data-pos=event-sell][data-id=new-event]').click();assert.match(await page.locator('[data-pos=add][data-id=p4]').innerText(),/5 left/);
   for(let n=0;n<2;n++){
    await productView();await page.locator('[data-pos=add][data-id=p4]').click();assert.equal(await page.locator('[name="flavor:vanilla"]').count(),0);
    await page.getByRole('button',{name:'Increase Truffle quantity',exact:true}).click();await page.getByRole('button',{name:'Add to order',exact:true}).click();
   }
   await basket();assert.equal(await page.locator('[name=qty_0]').inputValue(),'2');assert.match(await page.locator('.pos-basket-panel').innerText(),/Truffle/);
   await productView();await page.locator('[data-pos=add][data-id=p4]').click();assert.equal(await page.getByRole('button',{name:'Increase Truffle quantity',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'Close flavors',exact:true}).click();await page.locator('[data-pos=add][data-id=p2]').click();await page.getByRole('button',{name:'Increase Chocolate quantity',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Increase Chocolate quantity',exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'Increase Vanilla quantity',exact:true}).click();await page.getByRole('button',{name:'Add to order',exact:true}).click();await basket();await page.getByRole('button',{name:'Review sale',exact:true}).click();await page.getByRole('button',{name:'Complete sale',exact:true}).click();await page.locator('[data-pos=print]').waitFor();
   assert.equal(await page.evaluate(()=>window.posOrders[0].total_cents),62500);
   await page.locator('[data-pos=new-sale]').click();await page.locator('[data-source=direct_message]').click();await page.locator('[data-pos=add][data-id=p4]').click();assert.equal(await page.getByRole('button',{name:'Increase Truffle quantity',exact:true}).count(),0);assert.equal(await page.locator('[name="flavor:vanilla"]').count(),1);await page.getByRole('button',{name:'Close flavors',exact:true}).click();
  }
  if(role==='owner'){
   await page.locator('[data-pos=section][data-section=setup]').click();await page.locator('[data-pos=event-new]').click();await page.locator('#pos-event-form [name=name]').fill('Custom flavor booth');await page.locator('[data-pos=event-custom]').click();
   const custom=page.locator('[data-stock-id]');await custom.locator('[name^=custom_name_]').fill('Chunkies singles');await custom.locator('[name^=event_price_]').fill('140');await custom.locator('[data-pos=event-custom-flavors]').click();
   let row=custom.locator('[data-flavor-id]').first();await row.locator('input[type=text]').fill('Classic Chocochip');await row.locator('input[type=number]').first().fill('2');
   await custom.locator('[data-pos=event-flavor-add]').click();row=custom.locator('[data-flavor-id]').last();await row.locator('input[type=text]').fill('Chocolate');await row.locator('input[type=number]').first().fill('1');await row.locator('[name$=_price]').fill('10');
   assert.equal(await custom.locator('[name^=stock_]').inputValue(),'3');await custom.screenshot({path:join(out,`custom-flavors-${width}.png`)});
   await custom.locator('[data-pos=event-flavor-add]').click();await page.getByRole('button',{name:'Save event',exact:true}).click();await page.locator('[data-pos=event-edit][data-id=new-event]').click();assert.equal(await page.locator('[data-flavor-id]').count(),2);assert.equal(await page.locator('[name^=stock_]').inputValue(),'3');await page.getByRole('button',{name:'Save event',exact:true}).click();
   await page.locator('[data-pos=event-sell][data-id=new-event]').click();assert.match(await page.locator('[data-pos=add-event-custom]').innerText(),/3 left/);
   for(let n=0;n<2;n++){await productView();await page.locator('[data-pos=add-event-custom]').click();await page.getByRole('button',{name:'Increase Classic Chocochip quantity',exact:true}).click();await page.getByRole('button',{name:'Add to order',exact:true}).click()}
   await basket();assert.equal(await page.locator('[name=qty_0]').inputValue(),'2');assert.equal(await page.getByRole('button',{name:'Increase Chunkies singles quantity',exact:true}).isDisabled(),true);
   await productView();await page.locator('[data-pos=add-event-custom]').click();assert.equal(await page.getByRole('button',{name:'Increase Classic Chocochip quantity',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Increase Chocolate quantity',exact:true}).click();await page.screenshot({path:join(out,`custom-flavor-popup-${width}.png`)});await page.getByRole('button',{name:'Add to order',exact:true}).click();await basket();
   assert.equal(await page.locator('[data-cart-line]').count(),2);assert.match(await page.locator('[data-estimate]').innerText(),/430\.00/);await page.screenshot({path:join(out,`custom-flavor-basket-${width}.png`)});
   await page.getByRole('button',{name:'Review sale',exact:true}).click();await page.getByRole('button',{name:'GCash',exact:true}).click();await page.getByRole('button',{name:'Complete sale',exact:true}).click();await page.locator('[data-pos=print]').waitFor();assert.equal(await page.evaluate(()=>window.posOrders[0].total_cents),43000);
   await page.locator('[data-pos=new-sale]').click();await page.locator('[data-source=direct_message]').click();assert.equal(await page.locator('[data-pos=add-event-custom]').count(),0);
  }
  await page.locator('[data-pos=section][data-section=drawer]').click();await page.locator('[name=cash_event_id]').selectOption('event1');
  await page.locator('[data-pos=cash-mode][data-mode=cash_in]').click();await page.locator('[name=amount]').fill('200');await page.locator('.pos-cash-form [name=note]').fill('Extra small change');await page.evaluate(()=>{window.loseRegisterResponse=true;window.registerRefreshFailure=true});await page.getByRole('button',{name:'Record cash movement',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.pos-status').textContent.includes('Cash movement recorded'));
  assert.equal(await page.locator('.pos-cash-movements li').count(),1);
  await page.locator('[data-pos=cash-mode][data-mode=cash_out]').click();await page.locator('[name=amount]').fill('100');await page.locator('.pos-cash-form [name=note]').fill('Cash removed');await page.evaluate(()=>window.registerFailure=true);await page.getByRole('button',{name:'Record cash movement',exact:true}).click();await page.locator('[data-pos=register-retry]').waitFor();assert.equal(await page.locator('#pos-manager').getAttribute('data-busy'),'true');assert.equal(await page.locator('[data-pos=section][data-section=sell]').isDisabled(),true);
  await page.evaluate(()=>window.registerFailure=false);await page.locator('[data-pos=register-retry]').click();await page.waitForFunction(()=>!document.querySelector('[data-pos=register-retry]'));assert.equal(await page.locator('.pos-cash-movements li').count(),2);
  await page.locator('[data-pos=cash-mode][data-mode=close]').click();const expected=await page.locator('.pos-cash-expected dd').innerText();const counted=Number(expected.replace(/[^0-9.]/g,''))-1;await page.locator('[name=counted]').fill(String(counted));await page.locator('.pos-cash-form [name=note]').fill('One peso short');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,`cash-session-${width}.png`)});await page.getByRole('button',{name:'Confirm closing count',exact:true}).click();await page.locator('#pos-cash-open-form').waitFor();assert.match(await page.locator('.pos-cash-history summary').innerText(),/Difference/);
  if(role==='owner'){
   await page.locator('[data-pos=section][data-section=methods]').click();await page.locator('[data-pos=method-add]').click();await page.locator('input[name^=method_pos-]').fill('Maya');await page.getByRole('button',{name:'Save POS payment methods',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.pos-status').textContent.includes('methods saved'));
   await page.screenshot({path:join(out,`payment-methods-${width}.png`)});await page.locator('[data-pos=section][data-section=sell]').click();await page.locator('[data-source=direct_message]').click();await page.locator('[data-pos=custom]').click();await page.locator('#pos-custom-form [name=name]').fill('Card order');await page.locator('#pos-custom-form [name=price]').fill('25');await page.getByRole('button',{name:'Add item',exact:true}).click();await basket();await page.getByRole('button',{name:'Review order',exact:true}).click();await page.locator('[name=payment_state]').selectOption('paid');await page.getByRole('button',{name:'Maya',exact:true}).click();assert.equal(await page.locator('[name=cash_received]').isVisible(),false);assert.equal(await page.locator('.pos-cash-shortcuts').isVisible(),false);await page.screenshot({path:join(out,`payment-choices-${width}.png`)});await page.getByRole('button',{name:'Create direct order',exact:true}).click();await page.locator('[data-pos=print]').waitFor();assert.match(await page.locator('.pos-receipt').innerText(),/Maya/);
  }else assert.equal(await page.locator('[data-pos=section][data-section=methods]').count(),0);
  await page.locator('[data-pos=section][data-section=orders]').click();await page.locator('.pos-recent').waitFor();assert.equal(await page.locator('.pos-products-panel').count(),0);assert.equal(await page.locator('[data-pos=event-new]').count(),0);
  await page.locator('.pos-dashboard').click();await page.waitForFunction(()=>!document.body.classList.contains('pos-workspace'));assert.equal(await page.locator('.admin-sidebar').isVisible(),true);
  assert.deepEqual(errors,[]);results.push({width,role,passed:true});await context.close();
 }
 console.log(JSON.stringify(results));await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
}finally{await browser.close()}
