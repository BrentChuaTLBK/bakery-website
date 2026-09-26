// Local browser fixtures only; no live APIs or customer photos.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {emptyClass} from '../../assets/ordering/academy-model.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://public-album.test',out=join(root,'test-results/academy-public-albums');
await mkdir(out,{recursive:true});
const photo=i=>({id:`photo-${i}`,asset_id:`asset-${i}`,alt:`Baking photo ${i+1}`,caption:'',focal_x:50,focal_y:50});
function fixture(count){return {settings:{featured_id:'camp',class_order:['camp']},classes:[{id:'camp',content:{...emptyClass('2nd Summer Baking Camp'),short_description:'Little bakers and proud moments in our kitchen.',hero:photo(0),thumbnail:photo(1),creations:[{id:'cookies',name:'Cookies & brownies',description:'Made by our students.',photos:[{...photo(2),caption:'Student creations'}]}],batches:[{id:'batch-1',label:'Batch 1',description:'',photos:Array.from({length:count},(_,i)=>photo(i))},{id:'batch-2',label:'Batch 2',description:'',photos:[photo(0),photo(1)]}]}}]};}
const mock=count=>`export async function academyApi(action){if(action!=='catalog')throw Error('Unexpected API '+action);return ${JSON.stringify(fixture(count))}};export async function academyImages(){return Object.fromEntries(Array.from({length:${count}},(_,i)=>['asset-'+i,{url:'/fixture-photo/'+i+'.svg',width:800,height:600}]))}`;
const original=await readFile(join(root,'academy.html'),'utf8');
const html=original.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<script type="module" src="/assets/ordering/academy-browser.js?v=compact-albums-1"></script></body>');
const mime={'.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
async function setup(width,count){
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[],loaded=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(u.pathname==='/'||u.pathname==='/academy.html')return route.fulfill({contentType:'text/html',body:html});if(u.pathname==='/assets/ordering/academy-client.js')return route.fulfill({contentType:'text/javascript',body:mock(count)});if(u.pathname.startsWith('/fixture-photo/')){const n=Number(u.pathname.split('/').pop().split('.')[0]);loaded.push(n);return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${['#f3dacb','#dce8d9','#dde9ed'][n%3]}"/><circle cx="400" cy="240" r="95" fill="#c99e7d"/><text x="400" y="440" fill="#583e2d" font-size="42" text-anchor="middle">Photo ${n+1}</text></svg>`})}const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)})}catch{return route.fulfill({status:404,body:''})}});
 await page.goto(origin+'/academy.html');await page.locator('.academy-thumbnail-grid').waitFor();
 return {context,page,errors,loaded,grid:page.locator('.academy-thumbnail-grid')};
}
async function swipe(page,dx,dy=0){
 const box=await page.locator('.academy-light-stage img').boundingBox(),start={x:box.x+box.width/2-dx/2,y:box.y+box.height/2-dy/2};
 const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
 for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+dx*i/6,y:start.y+dy*i/6}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
try{
 for(const width of [1440,768,390,320]){
  const {context,page,errors,loaded,grid}=await setup(width,77),dialog=page.locator('.academy-lightbox'),count=dialog.locator('[data-light-count]');
  assert.equal(await grid.locator('figure:visible').count(),24);
  await page.locator('#bakers-in-action').scrollIntoViewIfNeeded();
  assert.equal(await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width>=900?6:width>600?5:4);
  assert.ok((await grid.locator('button').first().boundingBox()).width<180,'Compact thumbnails');
  assert.equal(await grid.locator('figcaption').count(),0);
  assert.equal(await page.locator('#student-creations figcaption').textContent(),'Student creations');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No horizontal overflow');
  assert.ok(loaded.every(i=>i<24),'Hidden thumbnails do not load on opening');
  await page.screenshot({path:join(out,`compact-${width}.png`)});
  const first=grid.locator('button').first();await first.click();await dialog.waitFor({state:'visible'});
  assert.equal(await count.textContent(),'1 of 77');await dialog.getByRole('button',{name:'Previous photo',exact:true}).click();assert.equal(await count.textContent(),'77 of 77');
  await page.keyboard.press('ArrowRight');assert.equal(await count.textContent(),'1 of 77');
  if(width<500){await swipe(page,-90);assert.equal(await count.textContent(),'2 of 77','Swipe advances');await swipe(page,90);assert.equal(await count.textContent(),'1 of 77','Swipe goes back');await swipe(page,0,70);assert.equal(await count.textContent(),'1 of 77','Vertical scroll does not advance');}
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await first.evaluate(el=>el===document.activeElement),true,'Focus restored');
  await grid.locator('button').nth(23).click();await dialog.getByRole('button',{name:'Next photo',exact:true}).click();assert.equal(await count.textContent(),'25 of 77','All photos accessible before showing more thumbnails');
  await dialog.getByRole('button',{name:'Close photo gallery',exact:true}).click();
  for(const visible of [48,72,77]){await page.getByRole('button',{name:'Show more photos',exact:true}).click();assert.equal(await grid.locator('figure:visible').count(),visible);assert.equal(await page.locator('[data-academy-visible-count]').textContent(),`Showing ${visible} of 77`)}
  assert.equal(await page.getByRole('button',{name:'Show more photos',exact:true}).count(),0,'No more button when all photos shown');
  assert.equal(await grid.locator('button').last().evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:/Batch 2/}).click();assert.equal(await grid.locator('figure:visible').count(),2);assert.equal(await page.locator('[data-academy-more]').count(),0);
  assert.ok(page.url().includes('batch=batch-2'));await page.reload();await grid.waitFor();assert.equal(await grid.locator('figure:visible').count(),2,'Selected batch survives refresh');
  await page.goBack();await grid.locator('figure').nth(76).waitFor({state:'attached'});assert.equal(await grid.locator('figure:visible').count(),24,'Back restores Batch 1');
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: compact grid, progressive thumbnails, full album viewer, keyboard/touch, batch URL and navigation`);
 }
}finally{await browser.close()}
