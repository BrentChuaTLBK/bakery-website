// Real shop and viewer UI; all catalog/photos are local fixtures and external
// requests are blocked. Adding to the basket never creates an order.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {completeClientFixture} from '../helpers/client-fixture.mjs';

const require=createRequire(import.meta.url),dependencies=process.env.PLAYWRIGHT_PACKAGE_ROOT;
const {chromium}=require(dependencies?join(dependencies,'playwright'):'playwright');
const sharp=require(dependencies?join(dependencies,'sharp'):'sharp');
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/artifacts/shop-photo-viewer'),origin='https://shop-photo-viewer.test';
const now=Date.now(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const future=new Date(today+'T12:00:00Z');future.setUTCDate(future.getUTCDate()+7);const date=future.toISOString().slice(0,10);
const corners=[[225,25,25],[25,180,25],[25,92,225],[225,189,25]];
const photo=(width,height,title)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#efe3d2"/><path d="M0 0L${width} ${height}M${width} 0L0 ${height}" stroke="#baa88c" stroke-width="4"/><rect width="80" height="80" fill="rgb(${corners[0]})"/><rect x="${width-80}" width="80" height="80" fill="rgb(${corners[1]})"/><rect y="${height-80}" width="80" height="80" fill="rgb(${corners[2]})"/><rect x="${width-80}" y="${height-80}" width="80" height="80" fill="rgb(${corners[3]})"/><rect x="6" y="6" width="${width-12}" height="${height-12}" fill="none" stroke="#493527" stroke-width="12"/><text x="${width/2}" y="${height/2}" text-anchor="middle" font-size="40" font-family="Arial" fill="#493527">${title}</text><text x="${width/2}" y="${height/2+55}" text-anchor="middle" font-size="24" font-family="Arial" fill="#493527">All four corners must remain visible</text></svg>`;
const portrait=origin+'/fixtures/portrait.svg',landscape=origin+'/fixtures/landscape.svg',broken=origin+'/fixtures/broken.jpg';
const product=(id,photos)=>({id,name:'Fixture '+id,description:'Local photo viewer regression fixture.',price_cents:10000,min_quantity:1,lead_days:1,active:true,photos,option_groups:[],sort_order:0});
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
 for(const width of (process.argv.includes('--touch-only')?[390,320]:[1440,820,390,320])){
  const touch=width<=390,errors=[],calls=[],checks=[];
  const context=await browser.newContext({viewport:{width,height:width<=390?844:1000},hasTouch:touch,isMobile:touch,deviceScaleFactor:1,serviceWorkers:'block'});
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
  const viewer=page.locator('#product-photo-viewer'),dialog=page.locator('#product-dialog');
  const image=()=>viewer.locator('.product-photo-viewer-image');
  const trigger=()=>dialog.locator('.product-photo-open');
  const previous=()=>viewer.locator('[data-photo-previous]'),next=()=>viewer.locator('[data-photo-next]');
  const openProduct=async id=>{await page.locator('[data-product="'+id+'"]').click();await dialog.locator('#product-title').waitFor();assert.equal(await dialog.evaluate(el=>el.open),true);};
  const tapOrClick=async locator=>touch?locator.tap():locator.click();
  const count=async value=>page.waitForFunction(value=>document.querySelector('#product-photo-viewer-count')?.textContent===value,value);
  const state=()=>dialog.evaluate(el=>({quantity:el.querySelector('#product-quantity').value,premium:el.querySelector('[data-group="finish"][data-choice="premium"]').checked,vanilla:el.querySelector('#choice-flavors-vanilla').value,cocoa:el.querySelector('#choice-flavors-cocoa').value,price:el.querySelector('#detail-price').textContent,add:el.querySelector('#add-to-cart').textContent}));
  const assertCorners=async(locator,name)=>{
   await locator.evaluate(img=>img.decode());
   await locator.waitFor({state:'visible'});
   const rect=await locator.evaluate(img=>{
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
   return rect;
  };
  const assertClosedToProduct=async()=>{
   await viewer.waitFor({state:'hidden'});assert.equal(await dialog.evaluate(el=>el.open),true,'Closing the viewer leaves the product dialog open');
   assert.equal(await trigger().evaluate(el=>el===document.activeElement),true,'Focus returns to the full-photo trigger');
  };
  const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+width+'px '+name);};
  try{
   await page.goto(origin+'/shop.html');await page.locator('[data-product="gallery"]').waitFor();
   await check('Main portrait is fully visible and selected thumbnail opens the full viewer',async()=>{
    await openProduct('gallery');await assertCorners(dialog.locator('#detail-photo'),'detail-portrait');
    await dialog.locator('[data-group="finish"][data-choice="premium"]').check();
    await dialog.locator('#choice-flavors-vanilla').fill('2');await dialog.locator('#choice-flavors-cocoa').fill('1');await dialog.locator('#product-quantity').fill('3');
    await dialog.locator('[data-photo="1"]').click();assert.equal(await dialog.locator('[data-photo="1"]').getAttribute('aria-pressed'),'true');assert.equal(await dialog.locator('[data-photo="0"]').getAttribute('aria-pressed'),'false');
    assert.equal(await trigger().getAttribute('aria-label'),'View full photo of Fixture gallery');
    await tapOrClick(trigger());await viewer.waitFor({state:'visible'});await count('Photo 2 of 3');assert.equal(await dialog.evaluate(el=>el.open),true);
    assert.equal(await image().getAttribute('src'),landscape);await assertCorners(image(),'viewer-landscape');
   });
   const preserved=await state();
   await check('Previous/next and keyboard navigation preserve all image corners and recover from a broken photo',async()=>{
    await tapOrClick(previous());await count('Photo 1 of 3');await assertCorners(image(),'viewer-portrait');
    await page.keyboard.press('ArrowRight');await count('Photo 2 of 3');await page.keyboard.press('ArrowLeft');await count('Photo 1 of 3');
    await tapOrClick(previous());await count('Photo 3 of 3');await viewer.locator('.product-photo-viewer-status').filter({hasText:'This photo could not be loaded. Try another photo.'}).waitFor();
    await tapOrClick(next());await count('Photo 1 of 3');await image().evaluate(img=>img.decode());
    await viewer.locator('.product-photo-viewer-status').waitFor({state:'hidden'});
    assert.equal(await viewer.locator('.product-photo-viewer-status').isVisible(),false,'A valid next image clears the visible loading error');
    await tapOrClick(next());await count('Photo 2 of 3');
   });
   await check('Keyboard cannot reach underlying controls and Escape restores the untouched product form',async()=>{
    // Chrome may report BODY at the native dialog's browser-chrome boundary;
    // underlying product/page buttons and inputs must never receive focus.
    for(const key of [...Array(8).fill('Tab'),'Shift+Tab']){
     await page.keyboard.press(key);const focus=await viewer.evaluate(el=>({within:el.contains(document.activeElement),tag:document.activeElement.tagName,id:document.activeElement.id}));
     assert(focus.within||focus.tag==='BODY','Native modal focus stays away from underlying controls: '+JSON.stringify(focus));
    }
    await page.keyboard.press('Escape');await assertClosedToProduct();assert.deepEqual(await state(),preserved);
    assert.equal(await dialog.locator('[data-photo="1"]').getAttribute('aria-pressed'),'true','Viewer navigation synchronizes the selected product thumbnail');
    assert.equal(await dialog.locator('#detail-photo').getAttribute('src'),landscape);
   });
   await check('Retained options and quantity are submitted unchanged to the local basket',async()=>{
    await dialog.locator('#add-to-cart').click();await dialog.waitFor({state:'hidden'});
    const basket=await page.evaluate(()=>JSON.parse(localStorage.getItem('tlb-checkout-v1')).items);
    assert.equal(basket.length,1);assert.equal(basket[0].product_id,'gallery');assert.equal(basket[0].quantity,3);
    assert.deepEqual(basket[0].selections,{finish:{premium:1},flavors:{vanilla:2,cocoa:1}});assert.equal(basket[0].unit_price_cents,11500);
    assert.equal(await page.locator('#checkout-dialog').evaluate(el=>el.open),false);
   });
   await check('Single photos have no navigation and the close button returns to the product',async()=>{
    await openProduct('single');assert.equal(await dialog.locator('[data-photo]').count(),0);
    await tapOrClick(trigger());await count('Photo 1 of 1');assert.equal(await previous().isVisible(),false);assert.equal(await next().isVisible(),false);
    await page.keyboard.press('ArrowRight');await count('Photo 1 of 1');await tapOrClick(viewer.locator('[data-photo-close]'));await assertClosedToProduct();await dialog.locator('.close-button').click();
   });
   await check('Missing and unsafe photos show no viewer trigger; broken single photos remain dismissible',async()=>{
    for(const id of ['missing','unsafe']){await openProduct(id);assert.equal(await trigger().count(),0);assert.equal(await dialog.locator('#detail-photo').count(),0);await dialog.locator('.close-button').click();}
    await openProduct('broken');await tapOrClick(trigger());await count('Photo 1 of 1');
    await viewer.locator('.product-photo-viewer-status').filter({hasText:'This photo could not be loaded. Please close and try again.'}).waitFor();
    await page.keyboard.press('Escape');await assertClosedToProduct();await dialog.locator('.close-button').click();
   });
   // Raw CDP gestures can suppress the next Playwright-generated click in
   // Chrome. Run this separately after semantic touch-button checks above.
   if(touch)await check('One-finger touch swipe navigates while the basket edit stays intact',async()=>{
    await page.locator('[data-edit="0"]').click();await dialog.locator('#product-title').waitFor();const editState=await state();assert.deepEqual({...editState,add:preserved.add},preserved);
    await dialog.locator('[data-photo="1"]').click();await trigger().tap();await count('Photo 2 of 3');
    const stage=await viewer.locator('.product-photo-viewer-stage').boundingBox(),cdp=await context.newCDPSession(page);
    const x=stage.x+stage.width*.75,y=stage.y+stage.height*.5,distance=Math.min(140,stage.width*.5);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=5;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-distance*i/5,y}]});await page.evaluate(()=>new Promise(requestAnimationFrame));}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await count('Photo 3 of 3');
    await page.keyboard.press('ArrowLeft');await count('Photo 2 of 3');await page.keyboard.press('Escape');await assertClosedToProduct();assert.deepEqual(await state(),editState);
    await cdp.detach();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
   });
   await check('No browser errors, viewport overflow or order/network writes occur',async()=>{
    assert.deepEqual(errors,[]);assert(calls.length>0&&calls.every(call=>['catalog','site_status'].includes(call.action)),'Only fixture catalog/site-status reads occurred');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page does not overflow horizontally');
   });
   results.push({width,touch,status:'PASS',checks,apiCalls:calls.map(call=>call.action)});
  }catch(error){await page.screenshot({path:join(out,'failure-'+width+'.png'),animations:'disabled'}).catch(()=>{});throw error;}
  finally{await context.close();}
 }
 await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));console.log('Shop photo viewer complete: '+results.length+' widths, '+results.reduce((sum,result)=>sum+result.checks.length,0)+' checks.');
}finally{await browser.close();}
