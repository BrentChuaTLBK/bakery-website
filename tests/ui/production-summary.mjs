import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://production.test',out=join(root,'tests/artifacts/production-summary');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const item=(name,quantity,labels=[],other={})=>({product_id:name,name,quantity,selection_labels:labels,...other});
const choice=(label,quantity=1)=>({group:'Flavor',label,quantity});
const order=(id,items,other={})=>({id,reference:'TEST-'+id,created_at:today+'T01:00:00Z',fulfillment_date:today,payment_status:'paid',fulfillment_status:'confirmed',source:'website',method:'pickup',refund_label:false,buyer:{name:'Fixture customer'},items,...other});
const orders=[
 order('ONE',[item('Butter Cookies (440ml)',1,[choice('Earl Grey')])]),
 order('BOX',[item('Cookie Box of 6',2,[choice('Chocolate',3),choice('Vanilla',3)])],{source:'direct_message',method:'delivery'}),
 order('DONE',[item('Butter Cookies (440ml)',3,[choice('Vanilla')])],{fulfillment_status:'completed'}),
 order('OVERDUE',[item('Butter Cookies (440ml)',4,[choice('Earl Grey')])],{fulfillment_date:shift(-1)}),
 order('UNPAID',[item('Butter Cookies (440ml)',9,[choice('Earl Grey')])],{payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation'}),
 order('POPUP',[item('Butter Cookies (440ml)',50)],{source:'popup',fulfillment_status:'completed'}),
 order('REFUND',[item('Butter Cookies (440ml)',50)],{refund_label:true}),
 order('FUTURE',[item('Butter Cookies (440ml)',5,[choice('Earl Grey')]),item('Custom celebration cake',1,[],{product_id:null,custom:true,description:'Purple cake · Happy birthday'})],{fulfillment_date:shift(1)})
];
const fixture={products:[],categories:[],orders:[],inventory:[],zones:[],promos:[],email_status:[],settings:{site_url:origin,shop_name:'TLB Kitchen',paused:false}};
const original=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=original.slice(original.indexOf('export function money('));
const mock=completeClientFixture(original,`
export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'fixture'}}}}),onAuthStateChange:()=>{}};
const rows=${JSON.stringify(orders)},today=${JSON.stringify(today)};window.productionCalls=[];
export async function api(action,p={}){
 window.productionCalls.push({action,p:structuredClone(p)});
 if(action==='admin_bootstrap')return {...${JSON.stringify(fixture)},role:window.fixtureRole};
 if(action==='admin_production'){
  const delay=window.productionDelay||0;window.productionDelay=0;
  const fail=window.productionFailure;window.productionFailure=false;
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  if(fail)throw Error('Fixture connection failed');
  return {today,orders:rows.filter(o=>o.fulfillment_date>=p.from&&o.fulfillment_date<=p.to||o.payment_status==='paid'&&!o.refund_label&&o.source!=='popup'&&o.fulfillment_status!=='completed'&&o.fulfillment_date<p.from&&o.fulfillment_date<today)};
 }
 throw Error('Unexpected action '+action);
}
${helpers}`);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{channel:'chrome'}),headless:true});
await mkdir(out,{recursive:true});const reports=[];
try{
 for(const [width,role] of [[1440,'owner'],[820,'owner'],[390,'owner'],[320,'staff']]){
  const context=await browser.newContext({viewport:{width,height:width<760?900:1000},serviceWorkers:'block'});
  await context.addInitScript(role=>{window.fixtureRole=role;window.print=()=>{window.printRequested=true;};},role);
  const remote=[];await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin){remote.push(url.origin);return route.abort();}
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   const file=resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));
  const check=(name)=>checks.push(name);
  const metric=key=>page.locator('[data-production-metric="'+key+'"]');
  const ready=()=>metric('units').waitFor();
  const units=async n=>{await ready();assert.equal(await metric('units').textContent(),String(n));};
  const picker=name=>page.locator('.accounting-date-picker').filter({has:page.locator('[name="'+name+'"]')});
  const selectDate=async(name,date)=>{
   const control=picker(name);await control.locator('summary').click();
   await control.locator('[data-date-year]').fill(date.slice(0,4));await control.locator('[data-date-year]').press('Tab');
   await control.locator('[data-date-month]').selectOption(date.slice(5,7));await control.locator('[data-date-value="'+date+'"]').click();
  };
  const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  try{
   await page.goto(origin+'/manage.html#production');await units(6);
   assert.equal(await metric('remaining').textContent(),'3');assert.equal(await metric('completed').textContent(),'3');
   assert.equal(await metric('orders').textContent(),'3');assert.equal(await page.locator('input[type=date]').count(),0);
   assert.match(await page.locator('.production-filter-note').textContent(),/1 unpaid/);await fits();
   check('Real admin navigation loads scoped report independently of empty bootstrap orders');
   const cookie=page.locator('.production-product-card').filter({has:page.getByRole('heading',{name:'Butter Cookies (440ml)',exact:true})});
   assert.equal(await cookie.locator('tfoot .production-total').textContent(),'4');
   const box=page.locator('.production-product-card').filter({has:page.getByRole('heading',{name:'Cookie Box of 6',exact:true})});
   assert.match(await box.locator('.production-option-chips').textContent(),/6 Chocolate/);assert.match(await box.locator('.production-option-chips').textContent(),/6 Vanilla/);
   check('Paid POS single units and per-box flavor selection counts reconcile');
   await cookie.locator('[data-production-product-orders]').click();await page.locator('.production-order-dialog[open]').waitFor();
   assert.equal(await page.locator('.production-order-detail').count(),2);await page.keyboard.press('Escape');
   assert.equal(await cookie.locator('[data-production-product-orders]').evaluate(el=>el===document.activeElement),true);
   check('Read-only order detail supports keyboard close and restores focus');
   await page.locator('[data-production-filter=scope]').selectOption('paid-pending');await units(3);
   await page.locator('[data-production-filter=scope]').selectOption('completed');await units(3);assert.equal(await page.locator('[data-production-overdue]').isDisabled(),true);
   await page.locator('[data-production-filter=scope]').selectOption('all-paid');
   await page.locator('[data-production-filter=method]').selectOption('delivery');await units(2);
   await page.locator('[data-production-filter=method]').selectOption('all');await page.locator('[data-production-filter=source]').selectOption('direct_message');await units(2);
   await page.locator('[data-production-filter=source]').selectOption('all');await page.locator('[data-production-search]').fill('Chocolate');await units(2);
   await page.locator('[data-production-search]').fill('');await page.locator('[data-production-overdue]').check();await units(10);
   await page.locator('[data-production-overdue]').uncheck();await units(6);check('Status, source, fulfillment, search and overdue filters update totals');
   await page.locator('[data-production-mode=range]').click();
   for(const name of ['production_from','production_to']){
    const control=picker(name);await control.locator('summary').click();await control.locator('.accounting-calendar').waitFor();
    // details toggle positions the panel in its queued toggle event.
    await page.waitForFunction(({name,width})=>{const panel=document.querySelector('[name="'+name+'"]').closest('.accounting-date-picker').querySelector('.accounting-calendar');const bounds=panel.getBoundingClientRect();return bounds.x>=15&&bounds.right<=width-15;},{name,width});await fits();
    await control.locator('[data-date-value="'+today+'"]').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    assert.equal(await page.locator('[name="'+name+'"]').inputValue(),shift(1));
    await control.locator('summary').click();await page.keyboard.press('Escape');assert.equal(await control.getAttribute('open'),null);
   }
   await selectDate('production_from',today);await selectDate('production_to',shift(1));await page.locator('[data-production=apply]').click();await units(12);
   await page.locator('[data-production-view=days]').click();assert.equal(await page.locator('.production-day-card').count(),2);
   await page.locator('[data-production-view=products]').click();check('Shared TLBK calendar handles keyboard selection, both range endpoints and phone bounds');
   await selectDate('production_to',shift(-1));await page.locator('[data-production=apply]').click();assert.match(await page.locator('.production-date-error').textContent(),/start on or before/);await units(12);
   await page.locator('[data-production-preset=today]').click();await units(6);await page.locator('[data-production-preset=week]').click();await units(12);
   assert.equal(await page.locator('[name=production_to]').inputValue(),shift(6));check('Invalid ranges preserve results and quick dates synchronize branded labels');
   const download=page.waitForEvent('download');await page.locator('[data-production=export]').click();const file=await download;await file.saveAs(join(out,'production-'+width+'.csv'));
   const csv=await readFile(join(out,'production-'+width+'.csv'),'utf8');assert.match(csv,/TEST-ONE/);assert.match(csv,/TEST-FUTURE/);assert.doesNotMatch(csv,/TEST-(UNPAID|POPUP|REFUND|OVERDUE)/);
   const rows=csv.trim().split(/\r?\n/).slice(1).map(line=>line.slice(1,-1).split('","'));
   assert.equal(rows.reduce((total,row)=>total+Number(row[6]),0),12);
   await page.locator('[data-production=print]').click();assert.equal(await page.evaluate(()=>window.printRequested),true);
   await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));await page.emulateMedia({media:'print'});
   assert.equal(await page.locator('.admin-sidebar').isVisible(),false);assert.equal(await page.locator('.production-filters').isVisible(),false);
   assert.equal(await page.locator('.production-report-content').isVisible(),true);assert.equal(await metric('units').isVisible(),true);
   await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));check('CSV and print preserve the selected report and hide management controls');
   await page.evaluate(()=>window.productionFailure=true);await page.locator('[data-production=refresh]').first().click();await page.getByRole('heading',{name:'Production summary unavailable'}).waitFor();
   assert.equal(await metric('units').count(),0);assert.equal(await page.locator('[data-production=export]').isDisabled(),true);
   await page.locator('[data-production=refresh]').first().click();await units(12);check('Failed refresh clears stale totals and export, then recovers');
   await page.evaluate(()=>window.productionDelay=300);await page.locator('[data-production-preset=tomorrow]').click();await page.locator('[data-production-preset=today]').click();await units(6);
   await page.waitForTimeout(350);await units(6);check('Out-of-order responses cannot overwrite the selected period');
   await selectDate('production_from',shift(40));await page.locator('[data-production=apply]').click();await units(0);assert.equal(await page.locator('[data-production=export]').isDisabled(),true);
   await page.locator('[data-production=reset]').click();await units(6);check('Empty report has a useful reset action');
   await page.screenshot({path:join(out,'production-'+width+'.png'),fullPage:true});
   await picker('production_from').locator('summary').click();await page.screenshot({path:join(out,'calendar-'+width+'.png')});await page.keyboard.press('Escape');
   await page.evaluate(()=>window.productionDelay=200);await page.locator('[data-production=refresh]').first().click();
   if(width<=760)await page.locator('#admin-nav-toggle').click();await page.locator('[data-view=overview]').click();await page.waitForTimeout(250);
   assert.equal(await page.locator('#production-manager').count(),0);assert.equal(await page.locator('.production-order-dialog').count(),0);
   if(width<=760)await page.locator('#admin-nav-toggle').click();await page.locator('[data-view=production]').click();await units(6);
   assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);check('Leaving and reopening the screen cleans up pending requests and dialogs');
   reports.push({width,role,checks});console.log('PASS production '+width+' '+role+': '+checks.length+' scenarios');
  }catch(error){await page.screenshot({path:join(out,'failure-'+width+'.png'),fullPage:true});throw error;}
  finally{await context.close();}
 }
 await writeFile(join(out,'report.json'),JSON.stringify({reports},null,2));
}finally{await browser.close();}
