// Real shop inline-photo UI; all catalog/photos are local fixtures and external
// requests are blocked. Adding to the basket never creates an order.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';

const require=createRequire(import.meta.url),dependencies=process.env.PLAYWRIGHT_PACKAGE_ROOT;
const {chromium}=require(dependencies?join(dependencies,'playwright'):'playwright');
const sharp=require(dependencies?join(dependencies,'sharp'):'sharp');
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/artifacts/shop-photo-fit'),origin='https://shop-photo-fit.test';
const now=Date.now(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const future=new Date(today+'T12:00:00Z');future.setUTCDate(future.getUTCDate()+7);const date=future.toISOString().slice(0,10);
const corners=[[225,25,25],[25,180,25],[25,92,225],[225,189,25]];
const photo=(width,height,title)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#efe3d2"/><path d="M0 0L${width} ${height}M${width} 0L0 ${height}" stroke="#baa88c" stroke-width="4"/><rect width="80" height="80" fill="rgb(${corners[0]})"/><rect x="${width-80}" width="80" height="80" fill="rgb(${corners[1]})"/><rect y="${height-80}" width="80" height="80" fill="rgb(${corners[2]})"/><rect x="${width-80}" y="${height-80}" width="80" height="80" fill="rgb(${corners[3]})"/><rect x="6" y="6" width="${width-12}" height="${height-12}" fill="none" stroke="#493527" stroke-width="12"/><text x="${width/2}" y="${height/2}" text-anchor="middle" font-size="40" font-family="Arial" fill="#493527">${title}</text><text x="${width/2}" y="${height/2+55}" text-anchor="middle" font-size="24" font-family="Arial" fill="#493527">All four corners must remain visible</text></svg>`;
const portrait=origin+'/fixtures/portrait.svg',landscape=origin+'/fixtures/landscape.svg',broken=origin+'/fixtures/broken.jpg';
const product=(id,photos)=>({id,name:'Fixture '+id,description:'Local inline photo regression fixture.',price_cents:10000,min_quantity:1,lead_days:1,active:true,photos,option_groups:[],sort_order:0});
const gallery={...product('gallery',[portrait,landscape,broken]),option_groups:[
 {id:'finish',label:'Finish',required_count:1,choices:[{id:'plain',label:'Plain',surcharge_cents:0,active:true},{id:'premium',label:'Premium',surcharge_cents:1000,active:true}]},
 {id:'flavors',label:'Flavors',required_count:3,choices:[{id:'vanilla',label:'Vanilla',surcharge_cents:0,active:true},{id:'cocoa',label:'Cocoa',surcharge_cents:500,active:true}]},
]};
const products=[gallery,product('single',[portrait]),product('missing',[]),product('unsafe',['','javascript:alert(1)','data:image/png;base64,AAAA']),product('broken',[broken])];
const catalog={products,categories:[],inventory:products.map(p=>({product_id:p.id,date,capacity:100,remaining:100,available:true})),zones:[],settings:{paused:false,production_weekdays:[0,1,2,3,4,5,6],fulfillment_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],blocked_dates:[],pickup_blocked_dates:[],delivery_blocked_dates:[],pickup_address:'Local fixture kitchen',pickup_hours:'9 AM–6 PM',delivery_window:'9 AM–6 PM'}};
const source=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=source.slice(source.indexOf('export function money('));
const mock=completeClientFixture(source,`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})};export async function api(action,payload={}){const response=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({action,payload})});const result=await response.json();if(!response.ok)throw Error(result.error);return result}${helpers}`);
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
await mkdir(out,{recursive:true});

try{
 for(const width of [1440,820,390,320]){
  const touch=width<=390,errors=[],calls=[],checks=[];
  const context=await browser.newContext({viewport:{width,height:touch?844:1000},hasTouch:touch,isMobile:touch,deviceScaleFactor:1,serviceWorkers:'block'});
  await context.addInitScript(({now,date})=>{
   const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
   localStorage.setItem('tlb-checkout-v1',JSON.stringify({items:[],fulfillment_date:date,method:'pickup',saved_at:now}));
  },{now,date});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(url.pathname==='/fixture-api'){
    const {action,payload}=route.request().postDataJSON();calls.push({action,payload});
    if(action==='site_status')return route.fulfill({contentType:'application/json',body:JSON.stringify({active:false,mode:'off',message:'',uploads_paused:false})});
    if(action!=='catalog')throw Error('Unexpected API action in photo-only test: '+action);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(catalog)});
   }
   if(url.pathname==='/fixtures/portrait.svg')return route.fulfill({contentType:'image/svg+xml',body:photo(600,1000,'PORTRAIT')});
   if(url.pathname==='/fixtures/landscape.svg')return route.fulfill({contentType:'image/svg+xml',body:photo(1200,600,'LANDSCAPE')});
   if(url.pathname==='/fixtures/broken.jpg')return route.fulfill({status:404,body:'Deliberately missing fixture image'});
   try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[extname(url.pathname)]||'application/octet-stream',body:await readFile(join(root,url.pathname))});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>{errors.push('Unexpected browser dialog: '+dialog.message());dialog.dismiss();});
  const dialog=page.locator('#product-dialog'),image=()=>dialog.locator('#detail-photo'),trigger=()=>dialog.locator('.product-photo-toggle');
  const openProduct=async id=>{await page.locator('[data-product="'+id+'"]').click();await dialog.locator('#product-title').waitFor();assert.equal(await dialog.evaluate(el=>el.open),true);};
  const tapOrClick=async locator=>touch?locator.tap():locator.click();
  const state=()=>dialog.evaluate(el=>({quantity:el.querySelector('#product-quantity').value,premium:el.querySelector('[data-group="finish"][data-choice="premium"]').checked,vanilla:el.querySelector('#choice-flavors-vanilla').value,cocoa:el.querySelector('#choice-flavors-cocoa').value,price:el.querySelector('#detail-price').textContent,add:el.querySelector('#add-to-cart').textContent}));
  const assertMode=async mode=>{
   assert.equal(await image().evaluate(el=>getComputedStyle(el).objectFit),mode,'The photo uses the selected fit mode');
   assert.equal(await trigger().getAttribute('aria-pressed'),String(mode==='contain'),'The toggle announces its pressed state');
   assert.equal(await trigger().getAttribute('data-photo-fit'),mode);
   assert.match(await trigger().getAttribute('aria-label'),/View full photo/,'The accessible toggle name stays stable');
   assert.equal(await trigger().getAttribute('title'),mode==='contain'?'Fill photo frame':'View full photo');
   assert.equal(await page.locator('dialog[open]').count(),1,'The product remains the only open dialog');
   assert.equal(await page.locator('#product-photo-viewer').count(),0,'Toggling does not create a photo popup');
  };
  const assertCorners=async name=>{
   await image().evaluate(img=>img.decode());await image().scrollIntoViewIfNeeded();
   const rect=await image().evaluate(img=>{
    const b=img.getBoundingClientRect(),s=getComputedStyle(img),n=value=>parseFloat(value)||0;
    const left=b.left+n(s.borderLeftWidth)+n(s.paddingLeft),top=b.top+n(s.borderTopWidth)+n(s.paddingTop);
    const w=b.width-n(s.borderLeftWidth)-n(s.borderRightWidth)-n(s.paddingLeft)-n(s.paddingRight),h=b.height-n(s.borderTopWidth)-n(s.borderBottomWidth)-n(s.paddingTop)-n(s.paddingBottom);
    const scale=Math.min(w/img.naturalWidth,h/img.naturalHeight),paintW=img.naturalWidth*scale,paintH=img.naturalHeight*scale;
    return {fit:s.objectFit,left:left+(w-paintW)/2,top:top+(h-paintH)/2,width:paintW,height:paintH,scale,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,viewport:{width:innerWidth,height:innerHeight}};
   });
   assert.equal(rect.fit,'contain',name+' uses contain');assert(rect.width>0&&rect.height>0,name+' is visible');
   assert(rect.left>=-1&&rect.top>=-1&&rect.left+rect.width<=rect.viewport.width+1&&rect.top+rect.height<=rect.viewport.height+1,name+' fully fits the viewport');
   const buffer=await page.screenshot({path:join(out,name+'-'+width+'.png'),animations:'disabled'});
   const {data,info}=await sharp(buffer).removeAlpha().raw().toBuffer({resolveWithObject:true});
   const points=[[40,40],[rect.naturalWidth-40,40],[40,rect.naturalHeight-40],[rect.naturalWidth-40,rect.naturalHeight-40]];
   for(let i=0;i<points.length;i++){
    const x=Math.floor(rect.left+points[i][0]*rect.scale),y=Math.floor(rect.top+points[i][1]*rect.scale),offset=(y*info.width+x)*info.channels;
    const actual=[...data.subarray(offset,offset+3)];assert(actual.every((value,c)=>Math.abs(value-corners[i][c])<=12),name+' corner '+i+' remains visible: '+actual);
   }
  };
  const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+width+'px '+name);};
  try{
   await page.goto(origin+'/shop.html');await page.locator('[data-product="gallery"]').waitFor();
   await check('Photo tap zooms out in place and reveals every corner without changing the frame',async()=>{
    await openProduct('gallery');await image().evaluate(img=>img.decode());await assertMode('cover');await trigger().scrollIntoViewIfNeeded();
    const before=await image().boundingBox();await tapOrClick(trigger());await assertMode('contain');const after=await image().boundingBox();
    assert.deepEqual(after,before,'Switching fit mode preserves the image frame and scroll position');
    await assertCorners('inline-portrait');await tapOrClick(trigger());await assertMode('cover');
   });
   await check('Space and Enter toggle the same photo while keyboard focus stays on the control',async()=>{
    await trigger().focus();await page.keyboard.press('Space');await assertMode('contain');
    assert.equal(await trigger().evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Enter');await assertMode('cover');
    assert.equal(await trigger().evaluate(el=>el===document.activeElement),true);
   });
   await dialog.locator('[data-group="finish"][data-choice="premium"]').check();
   await dialog.locator('#choice-flavors-vanilla').fill('2');await dialog.locator('#choice-flavors-cocoa').fill('1');await dialog.locator('#product-quantity').fill('3');
   const preserved=await state();
   await check('Thumbnails retain zoom mode and recover from a broken image without changing order selections',async()=>{
    await tapOrClick(trigger());await assertMode('contain');await tapOrClick(dialog.locator('[data-photo="1"]'));
    assert.equal(await dialog.locator('[data-photo="1"]').getAttribute('aria-pressed'),'true');assert.equal(await dialog.locator('[data-photo="0"]').getAttribute('aria-pressed'),'false');
    assert.equal(await image().getAttribute('src'),landscape);await assertMode('contain');await assertCorners('inline-landscape');
    await tapOrClick(dialog.locator('[data-photo="2"]'));await image().evaluate(img=>img.decode().catch(()=>{}));await assertMode('contain');
    await tapOrClick(dialog.locator('[data-photo="0"]'));await assertMode('contain');await assertCorners('inline-recovered');
    await tapOrClick(trigger());await assertMode('cover');await tapOrClick(dialog.locator('[data-photo="1"]'));await assertMode('cover');
    assert.deepEqual(await state(),preserved,'Photo actions preserve quantity, flavor choices and displayed pricing');
   });
   await check('Retained options and quantity reach the basket unchanged and remain editable',async()=>{
    await dialog.locator('#add-to-cart').click();await dialog.waitFor({state:'hidden'});
    const basket=await page.evaluate(()=>JSON.parse(localStorage.getItem('tlb-checkout-v1')).items);
    assert.equal(basket.length,1);assert.equal(basket[0].product_id,'gallery');assert.equal(basket[0].quantity,3);
    assert.deepEqual(basket[0].selections,{finish:{premium:1},flavors:{vanilla:2,cocoa:1}});assert.equal(basket[0].unit_price_cents,11500);
    assert.equal(await page.locator('#checkout-dialog').evaluate(el=>el.open),false);
    await page.locator('[data-edit="0"]').click();await dialog.locator('#product-title').waitFor();await assertMode('cover');
    const editState=await state();assert.deepEqual({...editState,add:preserved.add},preserved);
    await tapOrClick(trigger());await assertMode('contain');assert.deepEqual(await state(),editState);
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('dialog[open]').count(),0,'Escape closes the sole product dialog');
   });
   await check('Single photos toggle inline without thumbnails and reset when reopened',async()=>{
    await openProduct('single');assert.equal(await dialog.locator('[data-photo]').count(),0);await assertMode('cover');
    await tapOrClick(trigger());await assertMode('contain');await dialog.locator('.close-button').click();
    await openProduct('single');await assertMode('cover');await dialog.locator('.close-button').click();
   });
   await check('Missing and unsafe photos have no toggle; a broken single photo leaves the product usable',async()=>{
    for(const id of ['missing','unsafe']){await openProduct(id);assert.equal(await trigger().count(),0);assert.equal(await image().count(),0);await dialog.locator('.close-button').click();}
    await openProduct('broken');await image().evaluate(img=>img.decode().catch(()=>{}));await tapOrClick(trigger());await assertMode('contain');
    await tapOrClick(trigger());await assertMode('cover');await dialog.locator('.close-button').click();await dialog.waitFor({state:'hidden'});
   });
   await check('No browser errors, viewport overflow or order/network writes occur',async()=>{
    assert.deepEqual(errors,[]);assert(calls.length>0&&calls.every(call=>['catalog','site_status'].includes(call.action)),'Only fixture catalog/site-status reads occurred');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page does not overflow horizontally');
   });
   results.push({width,touch,status:'PASS',checks,apiCalls:calls.map(call=>call.action)});
  }catch(error){await page.screenshot({path:join(out,'failure-'+width+'.png'),animations:'disabled'}).catch(()=>{});throw error;}
  finally{await context.close();}
 }
 await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));console.log('Inline shop photo checks complete: '+results.length+' widths, '+results.reduce((sum,result)=>sum+result.checks.length,0)+' checks.');
}finally{await browser.close();}
