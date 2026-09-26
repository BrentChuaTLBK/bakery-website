import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://accounting.test',output=join(root,'test-results/accounting');
const libraryPath=process.env.EXCELJS_TEST_PATH||join(root,'work/exceljs-4.4.0.min.cjs');
const ExcelJS=require(libraryPath);
const order={id:'delivery',reference:'TLB-A2B3C4',revision:3,created_at:'2026-09-24T01:00:00Z',fulfillment_date:'2026-09-25',method:'delivery',payment_status:'paid',fulfillment_status:'out_for_delivery',buyer:{name:'Test Customer',email:'customer@example.test',phone:'09171234567'},recipient:{name:'Test Customer'},items:[{name:'Nori',quantity:1,unit_price_cents:100000,line_total_cents:100000}],history:[],subtotal_cents:100000,total_cents:110000,discount_cents:5000,delivery_cents:15000,paid_amount_cents:110000};
const pickup={...order,id:'pickup',reference:'TLB-P1C2K3',method:'pickup',fulfillment_status:'confirmed',delivery_cents:0,total_cents:95000,paid_amount_cents:95000};
const cats=[{id:'website',name:'Website sales',kind:'sale',system_key:'website',revision:1},{id:'discount',name:'Discounts',kind:'expense',system_key:'discount',revision:1},{id:'fee',name:'Delivery fees',kind:'sale',system_key:'delivery_fee',revision:1},{id:'cost',name:'Delivery costs',kind:'expense',system_key:'delivery_cost',revision:1},{id:'cakes',name:'Custom cakes',kind:'sale',revision:1}];
const initial=[{id:'1',category_id:'website',entry_date:'2026-09-24',amount_cents:100000,note:'Payment approved',source:'Website',order_id:'delivery',reference:order.reference},{id:'2',category_id:'discount',entry_date:'2026-09-24',amount_cents:5000,note:'Payment approved',source:'Website',order_id:'delivery'},{id:'3',category_id:'fee',entry_date:'2026-09-24',amount_cents:15000,note:'Payment approved',source:'Website',order_id:'delivery'},{id:'4',category_id:'cakes',entry_date:'2026-09-24',amount_cents:250000,note:'Celebration cake',source:'Manual',revision:1}];
initial.forEach(e=>e.kind=cats.find(c=>c.id===e.category_id).kind);
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
export async function api(action,payload={}){const r=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({action,payload})});const data=await r.json();if(!r.ok)throw Error(data.error);return data}
export async function upload(){throw Error('Unexpected upload')} export async function websiteVisitorStats(){return {}};${helpers}`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
await mkdir(output,{recursive:true});
async function pickDate(form,name,value) {
 const picker=form.locator(`.accounting-date-picker:has([name="${name}"])`);
 if(!await picker.evaluate(el=>el.open))await picker.locator('summary').click();
 await picker.locator('[data-date-year]').fill(value.slice(0,4));await picker.locator('[data-date-year]').press('Tab');
 if(value.length>7)await picker.locator('[data-date-month]').selectOption(value.slice(5,7));
 assert.equal(await picker.locator(`[data-date-value="${value}"]`).count(),1,JSON.stringify(await picker.evaluate(el=>({month:el.dataset.month,year:el.querySelector('[data-date-year]').value,choices:[...el.querySelectorAll('[data-date-value]')].map(x=>x.dataset.dateValue)}))));
 await picker.locator(`[data-date-value="${value}"]`).click();
 assert.equal(await form.locator(`[name="${name}"]`).inputValue(),value);
 assert.equal(await picker.evaluate(el=>el.open),false);
}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
try{
 for(const [width,role] of [[1440,'owner'],[390,'owner'],[390,'staff']]){
  const categories=structuredClone(cats),entries=structuredClone(initial),calls=[];let cost=null,excludeOrder=false;
  const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,acceptDownloads:true,serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href==='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js')return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:await readFile(libraryPath)});
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(url.pathname==='/fixture-api'){
    const {action,payload}=route.request().postDataJSON();calls.push({action,payload});let response;
    if(action==='admin_bootstrap')response={role,products:[],categories:[],orders:[order,pickup],inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}};
    else if(action==='get_order')response=payload.order_id===pickup.id?pickup:order;
    else if(action==='accounting_report'){
     const all=[...entries,...(cost?.amount_cents!=null?[{id:order.id,category_id:'cost',kind:'expense',entry_date:cost.cost_date,amount_cents:cost.amount_cents,note:cost.note,source:'Delivery cost',order_id:order.id,reference:order.reference}]:[])].filter(e=>e.entry_date>=payload.start&&e.entry_date<=payload.end&&(!excludeOrder||e.order_id!==order.id));
     response={...payload,report_version:2,categories,entries:all,summary:categories.filter(c=>!c.archived).map(c=>({...c,sales_cents:all.filter(e=>e.category_id===c.id&&e.kind==='sale').reduce((n,e)=>n+e.amount_cents,0),expense_cents:all.filter(e=>e.category_id===c.id&&e.kind==='expense').reduce((n,e)=>n+e.amount_cents,0),entry_count:all.filter(e=>e.category_id===c.id).length})),deliveries:excludeOrder?[]:[{order_id:order.id,reference:order.reference,approval_date:'2026-09-24',status:order.fulfillment_status,fee_cents:15000,cost_cents:cost?.amount_cents??null,cost_date:cost?.cost_date||null}],legacy_count:0};
    }else if(action==='accounting_save_category'){await new Promise(r=>setTimeout(r,50));response={...payload,revision:payload.revision+1};const old=categories.findIndex(c=>c.id===payload.id);if(old>=0)categories[old]=response;else categories.push(response);}
    else if(action==='accounting_save_entry'){await new Promise(r=>setTimeout(r,50));response={...payload,source:'Manual',revision:payload.revision+1};const old=entries.findIndex(e=>e.id===payload.id);if(old>=0)entries[old]=response;else entries.push(response);}
    else if(action==='accounting_delete_entry'){entries.splice(entries.findIndex(e=>e.id===payload.id),1);response={};}
    else if(action==='accounting_get_delivery')response={cost,order_revision:order.revision};
    else if(action==='accounting_save_delivery')response=cost={...payload,revision:payload.revision+1};
    else throw Error('Unexpected action '+action);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
   }
   const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/manage.html#accounting');
  await page.getByText(role==='owner'?'Sales & income':'A little overview',{exact:true}).waitFor();
  if(role==='staff'){
   assert.equal(await page.locator('[data-view=accounting]').isVisible(),false);assert.equal(calls.some(c=>c.action.startsWith('accounting_')),false);
   await page.locator('[data-view=orders]').click();await page.locator('[data-action=open-order]').first().click();assert.equal(await page.locator('.delivery-accounting').count(),0);
  }else{
   await pickDate(page.locator('.accounting-filters'),'start','2026-09-01');await pickDate(page.locator('.accounting-filters'),'end','2026-09-30');await page.locator('.accounting-filters [type=submit]').click();
   await page.locator('.accounting-net').getByText('₱3,600.00',{exact:true}).waitFor();
   await page.screenshot({path:join(output,`overview-${width}.png`),fullPage:true});
   assert.equal(await page.locator('#accounting-manager input[type=date],#accounting-manager input[type=month]').count(),0);
   const startPicker=page.locator('.accounting-date-picker:has([name=start])');
   await startPicker.locator('summary').click();
   await page.screenshot({path:join(output,`calendar-${width}.png`),fullPage:true});
   const box=await startPicker.locator('.accounting-calendar').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,'Calendar fits the screen');
   await startPicker.locator('[data-date-value="2026-09-01"]').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
   assert.equal(await page.locator('.accounting-filters [name=start]').inputValue(),'2026-08-31','Keyboard selection crosses months');
   await pickDate(page.locator('.accounting-filters'),'start','2026-09-01');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'No horizontal page overflow');
   await page.locator('[data-accounting=add]').click();
   const form=page.locator('.accounting-entry-form');await pickDate(form,'entry_date','2026-09-25');await form.locator('[name=category_id]').selectOption('cakes');const saleOptions=await form.locator('[name=category_id] option').allTextContents();await form.locator('[name=kind]').selectOption('expense');assert.equal(await form.locator('[name=category_id]').inputValue(),'cakes','Changing type retains the selected category');assert.deepEqual(await form.locator('[name=category_id] option').allTextContents(),saleOptions,'Both types share every manual category');await form.locator('[name=amount]').fill('250.25');await form.locator('[name=category_id]').selectOption('__new');await form.locator('[name=new_category]').fill('Ingredients');await form.locator('[name=note]').fill('Flour and butter');
   await form.locator('[name=client_name]').fill('Alice <Baker>');await form.locator('[name=payment_method]').selectOption('gcash');
   if(width>500)for(const selectors of [['.accounting-date-picker>summary','[name=kind]','[name=amount]'],['[name=category_id]','[name=client_name]','[name=payment_method]']]){
    const boxes=await form.evaluate((form,selectors)=>selectors.map(selector=>{const box=form.querySelector(selector).getBoundingClientRect();return {y:box.y,height:box.height};}),selectors);
    assert.ok(boxes.every(box=>Math.abs(box.y-boxes[0].y)<1&&Math.abs(box.height-boxes[0].height)<1),'Entry controls have aligned tops and matching heights: '+JSON.stringify(boxes));
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'New entry fields fit on mobile');
   await page.locator('.accounting-editor').screenshot({path:join(output,`entry-${width}.png`)});
   await form.locator('[type=submit]').click();await form.dispatchEvent('submit');await page.getByText('Entry saved.',{exact:true}).waitFor();
   assert.equal(calls.filter(c=>c.action==='accounting_save_entry').length,1,'Duplicate save blocked');
   const entryRow=page.locator('.accounting-records tr').filter({hasText:'Flour and butter'});
   await entryRow.getByText('Client: Alice <Baker>',{exact:true}).waitFor();assert.equal(await entryRow.locator('baker').count(),0,'Client name remains plain text');
   await entryRow.locator('[data-accounting=edit]').click();assert.equal(await form.locator('[name=kind]').inputValue(),'expense','Entry type survives editing');assert.equal(await form.locator('[name=client_name]').inputValue(),'Alice <Baker>');assert.equal(await form.locator('[name=payment_method]').inputValue(),'gcash');
   await form.locator('[name=payment_method]').selectOption('bank_transfer');await form.locator('[type=submit]').click();await page.locator('.accounting-editor').waitFor({state:'hidden'});
   await entryRow.getByText('Payment: Bank Transfer',{exact:true}).waitFor();
   await page.locator('.accounting-net').getByText('₱3,349.75',{exact:true}).waitFor();
   const deliveryRow=page.locator('.accounting-report table tr').filter({hasText:order.reference}).last();await deliveryRow.locator('[data-accounting=order]').click();
   await page.locator('.delivery-accounting > summary').click();await page.locator('.delivery-accounting-form').waitFor();
   await page.locator('.delivery-accounting-form [name=amount]').fill('225.50');await pickDate(page.locator('.delivery-accounting-form'),'cost_date','2026-09-25');
   assert.match(await page.locator('.delivery-difference').textContent(),/75\.50.*shortfall/);
   await page.locator('.delivery-accounting-form [type=submit]').click();await page.getByText('Delivery cost saved to accounting.',{exact:true}).waitFor();
   await page.locator('#dialog-close').click();await page.locator('[data-accounting=refresh]').click();
   await page.locator('.accounting-net').getByText('₱3,124.25',{exact:true}).waitFor();
   excludeOrder=true; // Simulate a cancellation by another staff member after the report loaded.
   const downloadPromise=page.waitForEvent('download');await page.locator('[data-accounting=export]').click();const download=await downloadPromise;
   const file=join(output,download.suggestedFilename());await download.saveAs(file);
   const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await readFile(file));assert.equal(workbook.worksheets.length,8);assert.equal(workbook.getWorksheet('Summary').getCell('D12').value.result,2249.75);
   assert.equal(workbook.getWorksheet('Ingredients').getCell('D13').value,'Alice <Baker>');assert.equal(workbook.getWorksheet('Ingredients').getCell('E13').value,'Bank Transfer');
   await pickDate(page.locator('.accounting-filters'),'month','2024-02');assert.equal(await page.locator('.accounting-filters [name=end]').inputValue(),'2024-02-29');
   await pickDate(page.locator('.accounting-filters'),'start','2026-09-26');await pickDate(page.locator('.accounting-filters'),'end','2026-09-25');await page.locator('.accounting-filters [type=submit]').click();await page.getByText('The end date must be on or after the start date.',{exact:true}).waitFor();
   await page.locator('[data-view=orders]').click();await page.locator('[data-action=open-order][data-id=pickup]').click();await page.locator('#admin-dialog').waitFor();
   assert.equal(await page.locator('.delivery-accounting').count(),0,'Pickup orders have no delivery accounting section');
   assert.equal(calls.some(c=>c.action==='accounting_get_delivery'&&c.payload.order_id==='pickup'),false,'Pickup details never request courier accounting');
  }
  assert.deepEqual(errors,[]);console.log(`PASS accounting ${width}px ${role}: permissions, summary, categories, manual entries, delivery cost, timeframe and real Excel download`);await ctx.close();
 }
}finally{await browser.close();}
