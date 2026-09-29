import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {join,resolve,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://assets.test',out=join(root,'test-results/public-loading-assets');await mkdir(out,{recursive:true});
const hero=JSON.parse(await readFile(join(root,'tests/homepage-seed.json'),'utf8')),photos=JSON.parse(await readFile(join(root,'tests/party-cart-photos-seed.json'),'utf8')).slice(0,2);
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined}),results=[];
try{for(const [width,dpr] of [[390,1],[390,2],[1440,1]]){
 let managed=false,releasePhotos,releasePackages,failPackages=false;
 const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:dpr,serviceWorkers:'block',reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const u=new URL(route.request().url());
  if(u.pathname.endsWith('/homepage_api'))return route.fulfill({json:{revision:managed?2:1,content:hero}});
  if(u.pathname.endsWith('/party_cart_photos_api')){await new Promise(r=>releasePhotos=r);return route.fulfill({json:{items:photos}})}
  if(u.pathname.endsWith('/party_packages_api')){await new Promise(r=>releasePackages=r);return route.fulfill(failPackages?{status:503,body:'{}'}:{json:{items:[],categories:[],settings:{inclusions:[]}}})}
  if(u.pathname.endsWith('/party_cart_items_api'))return route.fulfill({json:{items:[]}});
  if(/traffic.js|newsletter.js/.test(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
  if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes('bootstrap'))return route.continue();
  if(u.origin!==origin)return route.abort();const path=resolve(root,'.'+decodeURIComponent(u.pathname));if(!path.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const live of [false,true]){managed=live;await page.goto(origin+'/index.html');if(live)await page.waitForFunction(()=>document.documentElement.dataset.homepageRevision==='2');
  const first=page.locator('#carousel-1 .carousel-item').first().locator('img');await first.evaluate(img=>img.decode());
  const details=await first.evaluate(img=>({src:img.currentSrc,width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height,fit:getComputedStyle(img).objectFit}));
  assert.match(details.src,width===390&&dpr===1?/-900w.webp$/:/-1600w.webp$/);assert.equal(details.fit,'cover');assert.equal(details.width,width);
  await page.locator('#carousel-1').screenshot({path:join(out,`banner-${width}-${dpr}-${live?'managed':'fallback'}.png`)});results.push({width,dpr,managed:live,...details});
 }
 if(dpr===1){await page.goto(origin+'/partycarts.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('[data-party-results]')?.getAttribute('aria-busy')==='true');
  while(!releasePhotos||!releasePackages)await new Promise(r=>setTimeout(r,20));
  const gallery=page.locator('[data-cart-gallery]'),before=await gallery.boundingBox();assert.ok(before.height>500);assert.ok(await page.locator('[data-loading-state]').count());
  await page.screenshot({path:join(out,`packages-loading-${width}.png`)});releasePhotos();failPackages=true;releasePackages();await page.locator('[data-party-retry]').waitFor();await page.locator('[data-cart-viewer]').waitFor();await page.waitForFunction(()=>{const img=document.querySelector('[data-cart-featured]');return img?.complete&&img.naturalWidth>0});
  const after=await gallery.boundingBox();assert.ok(Math.abs(after.height-before.height)<80,`gallery shift ${after.height-before.height}`);assert.equal(await page.locator('[data-loading-state]').count(),0);
  releasePackages=null;await page.locator('[data-party-retry]').click();while(!releasePackages)await new Promise(r=>setTimeout(r,20));failPackages=false;releasePackages();await page.waitForFunction(()=>!document.querySelector('[data-party-results]').hasAttribute('aria-busy'));assert.equal(await page.locator('[data-party-retry]').isHidden(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);results.push({width,galleryBefore:before.height,galleryAfter:after.height,packageFailureRetry:true});
 }
 assert.deepEqual(errors,[]);await context.close();
}await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));console.log('PASS responsive banner candidates, managed/fallback parity, gallery reserve, package retry and empty state');}finally{await browser.close()}
