import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {emptyClass} from '../../assets/ordering/academy-model.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://lazy-academy.test';
const photo=id=>({id,asset_id:id,alt:id,caption:'',focal_x:50,focal_y:50});
const batches=Array.from({length:13},(_,n)=>({id:'b'+(n+1),label:'Batch '+(n+1),cover:photo('cover-'+(n+1)),photos:Array.from({length:200},(_,i)=>photo('b'+(n+1)+'-'+i))}));
const data={settings:{featured_id:'camp',class_order:['camp']},classes:[{id:'camp',content:{...emptyClass('Summer Camp'),hero:photo('hero'),thumbnail:photo('thumb'),batches}}]};
const mock=`window.imageRequests=[];window.imageDelay=700;window.imageFail=false;window.imageVersion=1;
export async function academyApi(action){if(action!=='catalog')throw Error('Unexpected mutation');return ${JSON.stringify(data)};}
export async function academyImages(value){const ids=value.map(p=>p.asset_id);window.imageRequests.push(ids);const version=window.imageVersion;await new Promise(r=>setTimeout(r,window.imageDelay));if(window.imageFail)throw Error('Offline');return Object.fromEntries(ids.map(id=>[id,{url:'/photo/'+id+'.svg?v='+version,width:800,height:600}]));}`;
const original=await readFile(join(root,'academy.html'),'utf8');
const html=original.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<script type="module" src="/assets/ordering/academy-browser.js"></script></body>');
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
try{
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
 if(u.pathname==='/academy.html')return route.fulfill({contentType:'text/html',body:html});
 if(u.pathname==='/assets/ordering/academy-client.js')return route.fulfill({contentType:'text/javascript',body:mock});
 if(u.pathname.startsWith('/photo/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#d6b9a2"/></svg>'});
 const path=resolve(root,'.'+u.pathname);if(!path.startsWith(root+sep))return route.abort();
 try{return route.fulfill({contentType:extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'application/octet-stream',body:await readFile(path)});}catch{return route.fulfill({status:404,body:''});}
});
await page.goto(origin+'/academy.html');await page.locator('.academy-active-batch').waitFor();
const heading=()=>page.locator('.academy-active-batch h3'),gallery=page.locator('#bakers-in-action');
await page.evaluate(()=>{window.originalHero=document.querySelector('.academy-hero');window.originalSelector=document.querySelector('#class-albums');});
await gallery.scrollIntoViewIfNeeded();
await page.waitForFunction(()=>[...document.querySelectorAll('#bakers-in-action figure:not([hidden]) img')].every(i=>!i.hasAttribute('data-academy-pending')&&i.naturalWidth>1));
let requested=await page.evaluate(()=>window.imageRequests.flat());
assert.ok(requested.filter(id=>/^b\d+-/.test(id)).every(id=>/^b1-/.test(id)&&Number(id.split('-')[1])<24),'Only the selected visible batch photos are resolved');
assert.ok(requested.length<60,'Initial image work does not grow with all 2,600 camp photos');
await page.evaluate(()=>{window.imageDelay=1000;document.querySelector('[data-academy-batch="b2"]').click();});
assert.equal(await heading().textContent(),'Batch 2','Batch UI changes before the delayed image request');
assert.equal(await page.evaluate(()=>document.querySelector('.academy-hero')===window.originalHero&&document.querySelector('#class-albums')===window.originalSelector),true,'Class content and selector stay mounted');
await page.waitForFunction(()=>window.imageRequests.some(ids=>ids.includes('b2-0')));
await page.locator('[data-academy-batch="b3"]').evaluate(b=>b.click());assert.equal(await heading().textContent(),'Batch 3');
await page.waitForFunction(()=>{const i=document.querySelector('#bakers-in-action img');return i?.src.includes('b3-0.svg')&&i.naturalWidth>1;});
assert.ok((await gallery.locator('img').first().getAttribute('src')).includes('b3-0.svg'),'A late Batch 2 request never replaces Batch 3');
await page.locator('[data-academy-batch="b1"]').evaluate(b=>b.click());await page.waitForFunction(()=>document.querySelector('#bakers-in-action img')?.src.includes('b1-0.svg'));
const b1Requests=await page.evaluate(()=>window.imageRequests.flat().filter(id=>id==='b1-0').length);assert.equal(b1Requests,1,'Revisiting Batch 1 reuses its cached link');
await gallery.locator('.academy-photo-open').first().click();await page.locator('[data-light-step="-1"]').click();
await page.waitForFunction(()=>document.querySelector('.academy-lightbox img')?.src.includes('b1-199.svg'));
assert.equal(await page.locator('[data-light-count]').textContent(),'200 of 200','Lightbox loads photos beyond the thumbnail page on demand');
await page.keyboard.press('Escape');
await page.locator('[data-academy-more]').click();await gallery.locator('figure').nth(30).scrollIntoViewIfNeeded();
await page.waitForFunction(()=>window.imageRequests.flat().includes('b1-30'));assert.equal(await gallery.locator('figure:visible').count(),48);
// Long visits renew links only as requested, rather than refreshing the whole camp.
await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+241000;window.imageVersion=2;window.imageDelay=100;});
await page.locator('[data-academy-batch="b3"]').evaluate(b=>b.click());
await page.waitForFunction(()=>document.querySelector('#bakers-in-action img')?.src.includes('v=2'));
await page.goBack();await page.waitForFunction(()=>document.querySelector('.academy-active-batch h3')?.textContent==='Batch 1');
await page.goForward();await page.waitForFunction(()=>document.querySelector('.academy-active-batch h3')?.textContent==='Batch 3');
await page.reload();await page.waitForFunction(()=>document.querySelector('.academy-active-batch h3')?.textContent==='Batch 3');
await page.evaluate(()=>{window.imageFail=true;window.imageDelay=100;document.querySelector('[data-academy-batch="b4"]').click();});
await page.locator('.academy-photo-status').waitFor({state:'visible'});assert.equal(await heading().textContent(),'Batch 4','A failed photo request does not block navigation');
await page.evaluate(()=>window.imageFail=false);await page.locator('.academy-photo-retry').click();
await page.waitForFunction(()=>{const i=document.querySelector('#bakers-in-action img');return i?.src.includes('b4-0.svg')&&i.naturalWidth>1;});
assert.deepEqual(errors,[]);await context.close();
console.log('PASS mobile lazy loading: 2,600-photo fixture, immediate batch UI, viewport-only requests, cache reuse, unchanged class DOM, stale-response safety, on-demand lightbox, Show more, expiry, history, refresh and offline retry');
}finally{await browser.close();}
