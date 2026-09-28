import {selectDashboardSection} from '../helpers/dashboard-nav.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://delete-products.test',out=join(root,'tests/artifacts/delete-products');
const product=(id,name)=>({id,name,description:'Test fixture',price_cents:10000,active:true,lead_days:0,min_quantity:1,photos:[],option_groups:[],category_ids:[],sort_order:0});
const initial={products:[product('unused','Unused product'),product('used','Product with orders'),product('other','Other <b>product</b>')],categories:[],orders:[],inventory:[{product_id:'unused',date:'2026-10-01',capacity:4}],promos:[],zones:[],staff:[],email_status:[],settings:{paused:false}};
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=completeClientFixture(client,`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
const initial=${JSON.stringify(initial)};window.deleteCalls=[];
function data(){return JSON.parse(localStorage.getItem('product-delete-fixture')||JSON.stringify(initial));}
export async function api(action,payload={}){
 const d=data();if(action==='admin_bootstrap')return {...d,role:window.fixtureRole};
 if(action==='delete_product'){
  window.deleteCalls.push(payload);await new Promise(r=>setTimeout(r,120));
  if(window.fixtureRole!=='owner')throw Error('Only the owner can delete products.');
  if(payload.id==='used')throw Error('This product has order history and cannot be deleted. Turn off Show this product in the shop to hide it instead.');
  if(window.rejectDelete)throw Error('This product changed in another window. Refresh Products and review it before deleting.');
  const current=d.products.find(p=>p.id===payload.id);if(JSON.stringify(current)!==JSON.stringify(payload.expected_product))throw Error('Stale confirmation.');
  d.products=d.products.filter(p=>p.id!==payload.id);d.inventory=d.inventory.filter(i=>i.product_id!==payload.id);localStorage.setItem('product-delete-fixture',JSON.stringify(d));return {deleted:true,id:payload.id};
 }
 throw Error('Unexpected action '+action);
}
export async function upload(){throw Error('Unexpected upload')}export async function websiteVisitorStats(){return {}};
${helpers}`);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});await mkdir(out,{recursive:true});const results=[];
try{
 for(const [width,role] of [[1440,'owner'],[390,'owner'],[320,'owner'],[390,'staff']]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});await context.addInitScript(role=>window.fixtureRole=role,role);
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('Native dialog');return d.dismiss()});
  await page.goto(origin+'/manage.html');await page.locator('#shop-status').filter({hasText:'Shop accepting orders'}).waitFor({state:'attached'});await selectDashboardSection(page, 'products');
  if(role==='staff'){
   assert.equal(await page.locator('[data-action=delete-product]').count(),0);await page.locator('[data-action=edit-product]').first().click();assert.equal(await page.locator('[data-action=delete-product]').count(),0);await context.close();results.push({width,role,passed:true});continue;
  }
  assert.equal(await page.locator('#product-results [data-action=delete-product]').count(),3);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(out,`products-${width}.png`)});
  await page.locator('[data-action=delete-product][data-id=unused]').click();await page.getByRole('button',{name:'Keep product',exact:true}).click();assert.equal(await page.evaluate(()=>window.deleteCalls.length),0);
  await page.locator('[data-action=delete-product][data-id=used]').click();await page.getByRole('button',{name:'Delete product',exact:true}).click();await page.locator('#toast-region').filter({hasText:'order history'}).waitFor();assert.equal(await page.locator('[data-action=edit-product][data-id=used]').count(),1);
  await page.locator('[data-action=delete-product][data-id=other]').click();const confirm=page.getByRole('dialog',{name:'Delete product?',exact:true});assert.match(await confirm.innerText(),/Other <b>product<\/b>/);assert.equal(await confirm.locator('b').count(),0);
  await page.evaluate(()=>window.rejectDelete=true);await confirm.screenshot({path:join(out,`confirm-${width}.png`)});await confirm.getByRole('button',{name:'Delete product',exact:true}).click();await page.locator('#toast-region').filter({hasText:'another window'}).waitFor();await page.evaluate(()=>window.rejectDelete=false);
  await page.locator('[data-action=edit-product][data-id=unused]').click();await page.locator('[data-form=product] [name=name]').fill('Unsaved name');
  await page.locator('[data-form=product] [data-action=delete-product]').click();await page.getByRole('dialog',{name:'Delete product?',exact:true}).getByRole('button',{name:'Keep product',exact:true}).click();assert.equal(await page.locator('[data-form=product] [name=name]').inputValue(),'Unsaved name');
  await page.locator('[data-form=product] [data-action=delete-product]').click();await page.getByRole('dialog',{name:'Delete product?',exact:true}).getByRole('button',{name:'Delete product',exact:true}).click();
  await page.locator('#toast-region').filter({hasText:'Product deleted.'}).waitFor();assert.equal(await page.locator('[data-form=product]').count(),1);assert.equal(await page.locator('[data-form=product]').isVisible(),false);
  assert.equal(await page.locator('#product-results [data-action=edit-product][data-id=unused]').count(),0);assert.equal(await page.locator('#product-results [data-action=edit-product]').count(),2);
  assert.equal(await page.evaluate(()=>window.deleteCalls.filter(x=>x.id==='unused').length),1);
  await page.reload();await selectDashboardSection(page, 'products');assert.equal(await page.locator('#product-results [data-action=edit-product]').count(),2);
  await page.locator('[data-action=new-product]').click();assert.equal(await page.locator('[data-form=product] [data-action=delete-product]').count(),0);
  assert.deepEqual(errors,[]);results.push({width,role,passed:true});console.log('PASS owner product deletion, cancel, history protection, stale error and reload at '+width);await context.close();
 }
}finally{await browser.close();await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));}
