import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve, extname, sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://homepage-sync.test';
const out=join(root,'tests/artifacts/homepage-sync'),seed=JSON.parse(await readFile(join(root,'tests/homepage-seed.json'),'utf8'));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});
const results=[];
await mkdir(out,{recursive:true});
try {
 for(const [width,lengths,offline] of [[1440,[4,4,4,4],false],[390,[4,3,2,1],false],[390,[4,4,4],true]]) {
  const content=structuredClone(seed);
  content.specialties.forEach((card,i)=>{card.photos=Array.from({length:lengths[i]||1},(_,n)=>({...card.photos[n%card.photos.length]}));});
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<500,serviceWorkers:'block'});
  await context.addInitScript(()=>{
   window.slideEvents=[];
   document.addEventListener('slide.bs.carousel',event=>{
    if(event.target.closest('.specialty-grid')&&!event.defaultPrevented)window.slideEvents.push({id:event.target.id,to:event.to,time:performance.now()});
   });
  });
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/rpc/homepage_api'))return route.fulfill({status:offline?503:200,json:{content,revision:2}});
   if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('bootstrap'))return route.continue();
   if(url.origin!==origin)return route.abort();
   if(/\/(traffic|newsletter)\.js$/.test(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   const path=resolve(root,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(root+sep))return route.abort();
   try{return route.fulfill({contentType:mime[extname(path)]||'application/octet-stream',body:await readFile(path)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/index.html');
  const cards=page.locator('.specialty-grid .carousel');
  await cards.first().waitFor();
  const animated=lengths.filter(length=>length>1).length;
  const indices=()=>cards.evaluateAll(elements=>elements.map(el=>[...el.querySelectorAll('.carousel-item')].findIndex(slide=>slide.classList.contains('active'))));
  async function settled(){await page.waitForFunction(()=>!document.querySelector('.specialty-grid .carousel-item-next,.specialty-grid .carousel-item-prev'));}
  async function checkTick(count,expected){
   await page.waitForFunction(count=>window.slideEvents.length>=count,count,{timeout:7500});await settled();
   const tick=await page.evaluate(count=>window.slideEvents.slice(count-1*window.expectedMembers,count),count);
   assert.equal(new Set(tick.map(e=>e.id)).size,animated,'One change per animated card');
   assert.ok(Math.max(...tick.map(e=>e.time))-Math.min(...tick.map(e=>e.time))<120,'All transitions start together');
   assert.deepEqual(await indices(),expected);
  }
  await page.evaluate(count=>window.expectedMembers=count,animated);
  await checkTick(animated,lengths.map(n=>1%n));
  await checkTick(animated*2,lengths.map(n=>2%n));
  assert.equal(await page.locator('.specialty-grid [data-bs-ride=carousel]').count(),0,'No competing Bootstrap timers');
  assert.equal(await page.getByRole('button',{name:/^(pause|play) slideshow$/i}).count(),0);
  if(!offline){
   await page.emulateMedia({reducedMotion:'reduce'});
   const count=await page.evaluate(()=>window.slideEvents.length);
   await page.waitForTimeout(4400);assert.equal(await page.evaluate(()=>window.slideEvents.length),count,'Reduced motion stops the group');
   await cards.first().locator('[data-bs-slide-to="1"]').click();await settled();
   assert.deepEqual(await indices(),lengths.map(n=>1%n),'Selecting a dot updates every card');
   await cards.first().locator('[data-bs-slide=next]').focus();await page.keyboard.press('ArrowRight');await settled();
   assert.deepEqual(await indices(),lengths.map(n=>2%n),'Keyboard updates every card');
   if(width<500){
    await cards.first().dispatchEvent('pointerdown',{pointerType:'touch',clientX:260});
    await cards.first().dispatchEvent('pointerup',{pointerType:'touch',clientX:70});await settled();
    assert.deepEqual(await indices(),lengths.map(n=>3%n),'Touch swipe updates every card, including those offscreen');
   }
   await page.emulateMedia({reducedMotion:'no-preference'});
   if(width>500){
    await page.evaluate(()=>document.activeElement.blur());await cards.first().hover();
    const count=await page.evaluate(()=>window.slideEvents.length);
    await page.waitForTimeout(4400);assert.equal(await page.evaluate(()=>window.slideEvents.length),count,'Hovering one card stops the whole group');
   }
   await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement.blur());
   const resumedCount=await page.evaluate(()=>window.slideEvents.length);
   await checkTick(resumedCount+animated,lengths.map(n=>(width<500?4:3)%n));
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.locator('.home-specialties').screenshot({path:join(out,`synced-${width}.png`)});
  }
  assert.deepEqual(errors,[]);results.push({width,lengths,offline,passed:true});await context.close();
  console.log('PASS synchronized homepage cards '+JSON.stringify(results.at(-1)));
 }
} finally {await browser.close();await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));}
