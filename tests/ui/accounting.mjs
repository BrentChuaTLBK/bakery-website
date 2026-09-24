import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://accounting.test',output=join(root,'test-results/accounting');
const libraryPath=process.env.EXCELJS_TEST_PATH||join(root,'work/exceljs-4.4.0.min.cjs');
const ExcelJS=require(libraryPath);
const order={id:'delivery',reference:'TLB-A2B3C4',revision:3,created_at:'2026-09-24T01:00:00Z',fulfillment_date:'2026-09-25',method:'delivery',payment_status:'paid',fulfillment_status:'out_for_delivery',buyer:{name:'Test Customer',email:'customer@example.test',phone:'09171234567'},recipient:{name:'Test Customer'},items:[{name:'Nori',quantity:1,unit_price_cents:100000,line_total_cents:100000}],history:[],subtotal_cents:100000,total_cents:110000,discount_cents:5000,delivery_cents:15000,paid_amount_cents:110000};
const cats=[{id:'website',name:'Website sales',kind:'sale',system_key:'website',revision:1},{id:'discount',name:'Discounts',kind:'expense',system_key:'discount',revision:1},{id:'fee',name:'Delivery fees',kind:'sale',system_key:'delivery_fee',revision:1},{id:'cost',name:'Delivery costs',kind:'expense',system_key:'delivery_cost',revision:1},{id:'cakes',name:'Custom cakes',kind:'sale',revision:1}];
const initial=[{id:'1',category_id:'website',entry_date:'2026-09-24',amount_cents:100000,note:'Payment approved',source:'Website',order_id:'delivery',reference:order.reference},{id:'2',category_id:'discount',entry_date:'2026-09-24',amount_cents:5000,note:'Payment approved',source:'Website'},{id:'3',category_id:'fee',entry_date:'2026-09-24',amount_cents:15000,note:'Payment approved',source:'Website'},{id:'4',category_id:'cakes',entry_date:'2026-09-24',amount_cents:250000,note:'Celebration cake',source:'Manual',revision:1}];
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
export async function api(action,payload={}){const r=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({action,payload})});const data=await r.json();if(!r.ok)throw Error(data.error);return data}
export async function upload(){throw Error('Unexpected upload')} export async function websiteVisitorStats(){return {}};${helpers}`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
try{
 for(const [width,role] of [[1440,'owner'],[390,'owner'],[390,'staff']]){
  const categories=structuredClone(cats),entries=structuredClone(initial),calls=[];let cost=null;
  const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,acceptDownloads:true,serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href==='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js')return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:await readFile(libraryPath)});
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(url.pathname==='/fixture-api'){
    const {action,payload}=route.request().postDataJSON();calls.push({action,payload});let response;
    if(action==='admin_bootstrap')response={role,products:[],categories:[],orders:[order],inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}};
    else if(action==='get_order')response=order;
    else if(action==='accounting_report'){
     const all=[...entries,...(cost?.amount_cents!=null?[{id:order.id,category_id:'cost',entry_date:cost.cost_date,amount_cents:cost.amount_cents,note:cost.note,source:'Delivery cost',order_id:order.id,reference:order.reference}]:[])].filter(e=>e.entry_date>=payload.start&&e.entry_date<=payload.end);
     response={...payload,categories,entries:all,summary:categories.filter(c=>!c.archived).map(c=>({...c,amount_cents:all.filter(e=>e.category_id===c.id).reduce((n,e)=>n+e.amount_cents,0),entry_count:all.filter(e=>e.category_id===c.id).length})),deliveries:[{order_id:order.id,reference:order.reference,approval_date:'2026-09-24',status:order.fulfillment_status,fee_cents:15000,cost_cents:cost?.amount_cents??null,cost_date:cost?.cost_date||null}],legacy_count:0};
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
   await page.locator('[data-view=orders]').click();await page.locator('[data-action=open-order]').click();assert.equal(await page.locator('.delivery-accounting').count(),0);
  }else{
   await page.locator('.accounting-filters [name=start]').fill('2026-09-01');await page.locator('.accounting-filters [name=end]').fill('2026-09-30');await page.locator('.accounting-filters [type=submit]').click();
   await page.locator('.accounting-net').getByText('₱3,600.00',{exact:true}).waitFor();
   await page.screenshot({path:join(output,`overview-${width}.png`),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'No horizontal page overflow');
   await page.locator('[data-accounting=add]').click();
   const form=page.locator('.accounting-entry-form');await form.locator('[name=entry_date]').fill('2026-09-25');await form.locator('[name=kind]').selectOption('expense');await form.locator('[name=amount]').fill('250.25');await form.locator('[name=category_id]').selectOption('__new');await form.locator('[name=new_category]').fill('Ingredients');await form.locator('[name=note]').fill('Flour and butter');
   await form.locator('[type=submit]').click();await form.dispatchEvent('submit');await page.getByText('Entry saved.',{exact:true}).waitFor();
   assert.equal(calls.filter(c=>c.action==='accounting_save_entry').length,1,'Duplicate save blocked');
   await page.locator('.accounting-net').getByText('₱3,349.75',{exact:true}).waitFor();
   const deliveryRow=page.locator('.accounting-report table tr').filter({hasText:order.reference}).last();await deliveryRow.locator('[data-accounting=order]').click();
   await page.locator('.delivery-accounting > summary').click();await page.locator('.delivery-accounting-form').waitFor();
   await page.locator('.delivery-accounting-form [name=amount]').fill('225.50');await page.locator('.delivery-accounting-form [name=cost_date]').fill('2026-09-25');
   assert.match(await page.locator('.delivery-difference').textContent(),/75\.50.*shortfall/);
   await page.locator('.delivery-accounting-form [type=submit]').click();await page.getByText('Delivery cost saved to accounting.',{exact:true}).waitFor();
   await page.locator('#dialog-close').click();await page.locator('[data-accounting=refresh]').click();
   await page.locator('.accounting-net').getByText('₱3,124.25',{exact:true}).waitFor();
   const downloadPromise=page.waitForEvent('download');await page.locator('[data-accounting=export]').click();const download=await downloadPromise;
   const file=join(output,download.suggestedFilename());await download.saveAs(file);
   const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await readFile(file));assert.equal(workbook.worksheets.length,8);assert.equal(workbook.getWorksheet('Summary').getCell('E12').value.result,3124.25);
   await page.locator('.accounting-filters [name=month]').fill('2024-02');assert.equal(await page.locator('.accounting-filters [name=end]').inputValue(),'2024-02-29');
   await page.locator('.accounting-filters [name=start]').fill('2026-09-26');await page.locator('.accounting-filters [name=end]').fill('2026-09-25');await page.locator('.accounting-filters [type=submit]').click();await page.getByText('The end date must be on or after the start date.',{exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);console.log(`PASS accounting ${width}px ${role}: permissions, summary, categories, manual entries, delivery cost, timeframe and real Excel download`);await ctx.close();
 }
}finally{await browser.close();}
