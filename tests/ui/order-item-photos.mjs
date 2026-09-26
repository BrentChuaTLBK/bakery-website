// Isolated customer order-page regression. No live API, orders or email.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {orderProductPhoto} from '../../assets/ordering/order-item-photos.js';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://order-photos.test';
const output=join(root,'test-results/order-item-photos');await mkdir(output,{recursive:true});
const storage='https://aulhqofjjckwwjmdvqgi.supabase.co';
const photo=storage+'/storage/v1/object/public/product-images/nori-fixture.webp';
const privatePhoto=storage+'/storage/v1/object/sign/payment-proofs/private.jpg?token=private';
const opts={siteUrl:origin+'/shop.html',storageUrl:storage};
assert.equal(orderProductPhoto({product_id:'a'},[{id:'a',photos:[privatePhoto,photo]}],opts),photo);
for(const unsafe of [privatePhoto,'https://other.test/image.webp','javascript:alert(1)',photo+'?token=secret','https://user:password@aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/nori.webp']){
 assert.equal(orderProductPhoto({product_id:'a'},[{id:'a',photos:[unsafe]}],opts),'');
}
const localPhoto='/assets/pastries/basque/Vanilla.webp';
assert.equal(orderProductPhoto({product_id:'a'},[{id:'a',photos:[localPhoto]}],opts),origin+localPhoto);
assert.equal(orderProductPhoto({product_id:'deleted',name:'Same name'},[{id:'b',name:'Same name',photos:[photo]}],opts),'');

const id='08c47746-bf77-4a92-a1d6-7d6f639b91ce',token='ab'.repeat(32);
const items=[
 {product_id:'nori',name:'Nori Bucket · saved order name',quantity:2,unit_price_cents:24500,line_total_cents:49000,selection_labels:['Original × 1, Cheese × 1']},
 {product_id:'cake',name:'Classic Vanilla Basque (8")',quantity:1,unit_price_cents:225000,line_total_cents:225000,selection_labels:[]},
 {product_id:'broken',name:'Unavailable photo',quantity:1,unit_price_cents:13000,line_total_cents:13000,selection_labels:['Saved choice']},
 {product_id:'deleted',name:'Removed product with a very long saved name and options',quantity:1,unit_price_cents:99900,line_total_cents:99900,selection_labels:['A long saved customization remains readable on a narrow phone screen.']},
 {product_id:'private',name:'Never show a private proof image',quantity:1,unit_price_cents:10000,line_total_cents:10000,selection_labels:[]},
];
const total=items.reduce((sum,line)=>sum+line.line_total_cents,0);
const order={id,reference:'TLB-A7K2M9',created_at:new Date().toISOString(),fulfillment_date:'2026-09-30',method:'pickup',payment_status:'paid',fulfillment_status:'ready_for_pickup',paid_amount_cents:total,total_cents:total,subtotal_cents:total,discount_cents:0,delivery_cents:0,buyer:{name:'Sample customer',email:'customer@example.test',phone:'09171234567'},items,history:[],pickup_address:'Sample pickup address',pickup_hours:'10 AM - 8 PM',pickup_instructions:'Include your name and order ID in courier notes.'};
const catalog={products:[
 {id:'cake',photos:[localPhoto],name:'Catalog renamed cake',price_cents:1},
 {id:'nori',photos:[photo],name:'Catalog renamed nori',price_cents:1},
 {id:'broken',photos:['/assets/img/missing-order-fixture.webp']},
 {id:'different-product',name:items[3].name,photos:[photo]},
 {id:'private',photos:[privatePhoto]},
],categories:[],inventory:[],zones:[],settings:{}};
const realClient=await readFile(join(root,'assets/ordering/client.js'),'utf8');
const helpers=realClient.slice(realClient.indexOf('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth=null;
window.orderApiCalls=[];
export async function api(action,payload={},access=null){window.orderApiCalls.push({action,payload,access});if(action==='catalog')return ${JSON.stringify(catalog)};if(action==='get_order'){if(payload.order_id!==${JSON.stringify(id)}||access!==${JSON.stringify(token)})throw Error('Order access denied');return ${JSON.stringify(order)}}throw Error('Unexpected API: '+action)}
export async function upload(){throw Error('Unexpected upload')}
${helpers}`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:950},isMobile:width<500,hasTouch:width<500,serviceWorkers:'block'}),errors=[],unexpected=[];
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.href===photo)return route.fulfill({contentType:'image/webp',body:await readFile(join(root,'assets/pastries/NoriChips/Small 1L Bucket.webp'))});
   if(url.origin!==origin){if(!/fonts\.(googleapis|gstatic)\.com/.test(url.hostname))unexpected.push(url.href);return route.abort();}
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(['/assets/ordering/newsletter.js','/assets/ordering/traffic.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   const path=resolve(root,'.'+decodeURIComponent(url.pathname));
   if(!path.startsWith(root+'/')&&!path.startsWith(root+'\\'))return route.abort();
   try{return await route.fulfill({contentType:mime[extname(path)]||'application/octet-stream',body:await readFile(path)})}catch{return route.fulfill({status:404,body:''})}
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/shop.html#order=${id}&token=${token}`);
  await page.locator('.order-item-line').first().waitFor();
  for(let i=0;i<items.length;i++)await page.locator('.order-item-line').nth(i).scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelectorAll('[data-order-item-photo]').length===2&&[...document.querySelectorAll('[data-order-item-photo]')].every(img=>img.complete&&img.naturalWidth>0));
  const lines=page.locator('.order-item-line');assert.equal(await lines.count(),items.length);
  assert.equal(await lines.nth(0).locator('img').getAttribute('src'),photo);
  assert.equal(await lines.nth(1).locator('img').getAttribute('src'),origin+localPhoto);
  for(const i of [2,3,4]){assert.equal(await lines.nth(i).locator('img').count(),0);assert.equal(await lines.nth(i).locator('.order-item-photo-fallback').isVisible(),true);}
  assert.equal(await lines.nth(0).locator('h3').innerText(),'2 × '+items[0].name);
  assert.equal(await lines.nth(0).locator('.cart-options').innerText(),items[0].selection_labels[0]);
  assert.match(await lines.nth(0).locator('.order-item-total').innerText(),/490\.00/);
  assert.equal((await page.locator('#app').innerText()).includes('Catalog renamed'),false);
  assert.match(await page.locator('.grand-total').innerText(),/3,969\.00/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(await page.evaluate(()=>window.orderApiCalls.map(c=>c.action)),['catalog','get_order']);
  assert.equal(await page.evaluate(()=>window.orderApiCalls[1].access),token);
  await page.locator('.order-section').first().screenshot({path:join(output,`your-treats-${width}.png`)});
  await page.emulateMedia({media:'print'});
  assert.equal(await lines.nth(0).locator('img').isVisible(),true);
  assert.equal(await lines.nth(0).evaluate(e=>getComputedStyle(e).breakInside),'avoid');
  assert.equal(await page.locator('#copy-order-id').isVisible(),false);
  await page.emulateMedia({media:'screen'});
  await page.goto(`${origin}/shop.html#order=${id}&token=invalid`);
  await page.getByRole('heading',{name:'We couldn’t open that order'}).waitFor();
  assert.equal(await page.locator('.order-item-line').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  await context.close();console.log(`PASS order product photos at ${width}px: correct products, saved details, missing/error/private fallback, mobile, print and private order access`);
 }
}finally{await browser.close();}
