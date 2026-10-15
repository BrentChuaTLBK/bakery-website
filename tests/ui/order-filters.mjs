import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/artifacts/order-filters'),origin='https://order-filters.test';
const now=Date.now(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const day=offset=>{const value=new Date(today+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10);};
const base={revision:1,created_at:today+'T00:00:00Z',fulfillment_date:today,method:'pickup',payment_status:'paid',fulfillment_status:'confirmed',buyer:{name:'Filter Fixture',email:'filters@example.test',phone:'09171234567'},items:[{name:'Cookie box',quantity:1,unit_price_cents:50000,line_total_cents:50000}],subtotal_cents:50000,total_cents:50000,paid_amount_cents:50000,discount_cents:0,delivery_cents:0,history:[],payment_reference:'FIXTURE',source:'website'};
const fixture=(id,date,changes={})=>({...structuredClone(base),id,reference:'TLB-'+id.toUpperCase(),fulfillment_date:day(date),...changes});
const overdueIds=[];
const overdueStates=['confirmed','preparing','ready_for_pickup','out_for_delivery'];
const overdue=overdueStates.flatMap(status=>['website','direct_message'].map(source=>{
 const id='overdue-'+status+'-'+(source==='website'?'web':'dm');overdueIds.push(id);
 return fixture(id,-1,{fulfillment_status:status,source,method:status==='out_for_delivery'?'delivery':'pickup'});
}));
const awaitingIds=['unpaid-past-web','unpaid-past-dm','unpaid-today-web','unpaid-future-web','unpaid-future-dm'];
const fixtures=[
 fixture('future-paid',2),
 fixture('unpaid-future-web',4,{payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',paid_amount_cents:0}),
 fixture('completed-future',3,{fulfillment_status:'completed'}),
 ...overdue.slice().reverse(),
 fixture('unpaid-past-web',-1,{payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',paid_amount_cents:0}),
 fixture('refund-future',3,{refund_label:true}),
 fixture('oldest-paid',-3,{fulfillment_status:'preparing'}),
 fixture('unpaid-future-dm',5,{source:'direct_message',payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',paid_amount_cents:0}),
 fixture('cancelled-past',-1,{fulfillment_status:'cancelled'}),
 fixture('today-paid',0),
 fixture('future-review',3,{payment_status:'under_review',fulfillment_status:'pending_confirmation',paid_amount_cents:0,proof_path:'fixture-proof'}),
 fixture('unpaid-past-dm',-2,{source:'direct_message',payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',paid_amount_cents:0}),
 fixture('expired-future',3,{fulfillment_status:'expired'}),
 fixture('unpaid-today-web',0,{payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',paid_amount_cents:0}),
 fixture('completed-past',-1,{fulfillment_status:'completed'}),
 fixture('delivery-balance',1,{source:'direct_message',method:'delivery',deferred_delivery:true,delivery_payment_status:'awaiting_payment'}),
 fixture('cancelled-future',3,{fulfillment_status:'cancelled'}),
 fixture('refund-past',-1,{refund_label:true}),
 fixture('unpaid-cancelled',4,{payment_status:'awaiting_payment',fulfillment_status:'cancelled',paid_amount_cents:0}),
 fixture('unpaid-expired',4,{payment_status:'awaiting_payment',fulfillment_status:'expired',paid_amount_cents:0}),
 fixture('unpaid-refund',4,{payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation',refund_label:true,paid_amount_cents:0}),
];
// Expected groups are specified from business examples, not from the app helper.
const upcomingIds=['oldest-paid',...overdueIds,'today-paid','unpaid-today-web','delivery-balance','future-paid','future-review','unpaid-future-web','unpaid-future-dm'];
const todayIds=['today-paid','unpaid-today-web'];
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8');
const helpers=client.slice(client.indexOf('export function money('));
const mock=completeClientFixture(client,`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};export async function api(action,payload={}){const response=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({action,payload})});const result=await response.json();if(!response.ok)throw Error(result.error);return result}export async function websiteVisitorStats(){return {}}${helpers}`);
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
await mkdir(out,{recursive:true});

try{
 for(const width of [1440,390]){
  const orders=structuredClone(fixtures),calls=[],errors=[],checks=[];
  const context=await browser.newContext({viewport:{width,height:1050},serviceWorkers:'block'});
  // Keep the fixture dates and the browser's Manila date stable across midnight.
  await context.addInitScript(({now})=>{const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};},{now});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(url.pathname==='/fixture-api'){
    const {action,payload}=route.request().postDataJSON();calls.push({action,payload});
    if(action!=='admin_bootstrap')throw Error('Unexpected API action in filter-only test: '+action);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({role:'owner',products:[],categories:[],orders,inventory:[],zones:[],staff:[],promos:[],settings:{paused:false,pickup_address:'Fixture kitchen'}})});
   }
   try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[extname(url.pathname)]||'application/octet-stream',body:await readFile(join(root,url.pathname))});}
   catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  const ids=()=>page.locator('#order-table [data-order-row]').evaluateAll(rows=>rows.map(row=>row.dataset.orderRow));
  const assertRows=async(expected,message)=>assert.deepEqual((await ids()).sort(),expected.slice().sort(),message);
  const assertChronology=async()=>{
   const actual=await ids(),dates=actual.map(id=>orders.find(order=>order.id===id).fulfillment_date);
   assert.deepEqual(dates,dates.slice().sort(),'Upcoming orders are sorted by fulfillment date, oldest first');
   assert.equal(actual[0],'oldest-paid','Oldest overdue paid order appears first');
  };
  const tab=id=>page.locator('[data-order-view="'+id+'"]');
  const tabCount=async id=>Number(await tab(id).locator('span').textContent());
  const clearState=async()=>{
   for(const selector of ['#order-search','[data-filter=payment]','[data-filter=fulfillment]','[data-filter=method]','[name=filter-date]','[data-filter=refund]'])assert.equal(await page.locator(selector).inputValue(),'','Changing a tab clears '+selector);
   assert.equal(await page.locator('[data-filter=upcoming]').isChecked(),false,'Changing a tab clears Upcoming');
   assert.equal(await page.locator('#order-quick-panel').isVisible(),false,'Changing a tab clears quick selection');
   assert.equal(await page.locator('#print-selection-count').innerText(),'0 selected','Changing a tab clears print selection');
  };
  const navigate=async view=>{
   const toggle=page.locator('#admin-nav-toggle');
   if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
   await page.locator('#admin-nav [data-view="'+view+'"]').click();
  };
  const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+width+'px '+name);};
  try{
   await page.goto(origin+'/manage.html#orders');await page.locator('.order-view-tabs').waitFor();
   await check('Awaiting payment tab includes active primary unpaid orders at every date',async()=>{
    await tab('awaiting').click();assert.match(await tab('awaiting').innerText(),/Awaiting payment/);
    assert.equal(await tab('awaiting').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.order-view-title').innerText(),'Awaiting payment');
    assert.equal(await tabCount('awaiting'),awaitingIds.length);await assertRows(awaitingIds);
    assert.equal(await page.locator('#order-table [data-order-row=delivery-balance]').count(),0,'Unpaid delivery balance does not mean the primary payment is unpaid');
   });
   await check('Upcoming retains every overdue paid fulfillment state and future active orders',async()=>{
    await tab('all').click();await page.locator('[data-filter=upcoming]').check();
    assert.match(await page.locator('[data-filter=upcoming]').locator('..').innerText(),/Upcoming, including overdue/);
    await assertRows(upcomingIds);await assertChronology();
    assert.equal(await page.locator('#order-count').innerText(),upcomingIds.length+' orders');
    await page.screenshot({path:join(out,'upcoming-'+width+'.png')});
   });
   await check('Tab changes clear filters, selected order and print selection',async()=>{
    await page.locator('[data-action=select-order][data-id=today-paid]').click();
    await page.locator('[data-print-order=today-paid]').check();
    await page.locator('#order-search').fill('TODAY-PAID');
    await page.locator('[data-filter=payment]').selectOption('paid');
    await page.locator('[data-filter=fulfillment]').selectOption('confirmed');
    await page.locator('[data-filter=method]').selectOption('pickup');
    await page.locator('[data-filter=refund]').selectOption('no');
    const picker=page.locator('.accounting-date-picker:has([name=filter-date])');await picker.locator('summary').click();await picker.locator('[data-date-value="'+today+'"]').click();
    await page.locator('[data-print-order=today-paid]').check();assert.equal(await page.locator('#print-selection-count').innerText(),'1 selected');assert.equal(await page.locator('#order-quick-panel').isVisible(),true);
    await tab('awaiting').click();await clearState();await assertRows(awaitingIds);
    await tab('review').click();await clearState();await assertRows(['future-review']);
    await tab('today').click();await clearState();await assertRows(todayIds);
    await tab('all').click();await clearState();await assertRows(fixtures.map(order=>order.id));
   });
   await check('Overview count and preview use the same Upcoming group and its link clears stale filters',async()=>{
    await tab('awaiting').click();await page.locator('#order-search').fill('UNPAID');
    await page.locator('[data-filter=payment]').selectOption('awaiting_payment');
    await page.locator('[data-filter=fulfillment]').selectOption('pending_confirmation');
    await page.locator('[data-filter=method]').selectOption('delivery');
    await page.locator('[data-filter=refund]').selectOption('yes');
    const picker=page.locator('.accounting-date-picker:has([name=filter-date])');await picker.locator('summary').click();await picker.locator('[data-date-value="'+today+'"]').click();
    await navigate('overview');
    const metric=page.locator('.metric-card').filter({has:page.locator('.metric-label',{hasText:/Upcoming/})});
    assert.equal(await metric.locator('.metric-value').innerText(),String(upcomingIds.length));
    const section=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Coming out of the kitchen',exact:true})});
    const preview=await section.locator('[data-action=open-order]').evaluateAll(nodes=>nodes.map(node=>node.dataset.id));
    assert.equal(preview.length,7);assert.equal(preview[0],'oldest-paid');assert(preview.every(id=>upcomingIds.includes(id)));
    const previewDates=preview.map(id=>orders.find(order=>order.id===id).fulfillment_date);assert.deepEqual(previewDates,previewDates.slice().sort());
    await section.locator('[data-action=upcoming]').click();
    assert.equal(await tab('all').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-filter=upcoming]').isChecked(),true);
    for(const selector of ['#order-search','[data-filter=payment]','[data-filter=fulfillment]','[data-filter=method]','[name=filter-date]','[data-filter=refund]'])assert.equal(await page.locator(selector).inputValue(),'','Overview shortcut clears '+selector);
    await assertRows(upcomingIds);await assertChronology();
   });
   await check('Refresh removes a newly paid order from Awaiting and includes it in overdue Upcoming',async()=>{
    await tab('awaiting').click();await page.locator('[data-action=select-order][data-id=unpaid-past-dm]').click();
    await page.locator('[data-print-order=unpaid-past-dm]').check();
    const changed=orders.find(order=>order.id==='unpaid-past-dm');changed.payment_status='paid';changed.fulfillment_status='confirmed';changed.paid_amount_cents=changed.total_cents;changed.revision++;
    await page.locator('[data-action=refresh]').click();
    await page.waitForFunction(()=>!document.querySelector('#order-table [data-order-row="unpaid-past-dm"]'));
    const remaining=awaitingIds.filter(id=>id!==changed.id);await assertRows(remaining);assert.equal(await tabCount('awaiting'),remaining.length);
    assert.equal(await page.locator('#order-quick-panel').isVisible(),false);assert.equal(await page.locator('#print-selection-count').innerText(),'0 selected');
    await page.screenshot({path:join(out,'awaiting-'+width+'.png')});
    await tab('all').click();await page.locator('[data-filter=upcoming]').check();await assertRows([...upcomingIds,changed.id]);await assertChronology();
   });
   await check('Phone/desktop layout stays within the page and filters make no write calls',async()=>{
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page horizontal overflow');
    assert.deepEqual(errors,[]);assert(calls.every(call=>call.action==='admin_bootstrap'),'Only local bootstrap/refresh reads were used');
   });
   results.push({width,status:'PASS',checks,fixtureCount:fixtures.length,upcomingCount:upcomingIds.length,awaitingCount:awaitingIds.length,afterPaymentUpcomingCount:upcomingIds.length+1,afterPaymentAwaitingCount:awaitingIds.length-1,apiCalls:calls.map(call=>call.action)});
  }catch(error){await page.screenshot({path:join(out,'failure-'+width+'.png')}).catch(()=>{});throw error;}
  finally{await context.close();}
 }
 await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
 console.log('Order filter UI checks complete: '+results.length+' widths, '+results.reduce((sum,result)=>sum+result.checks.length,0)+' checks.');
}finally{await browser.close();}
