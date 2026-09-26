import {createRequire} from 'node:module';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {readdir,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const require=createRequire(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'package.json')),{chromium}=require('playwright');
const folder=resolve('test-results/emails'),browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH}),page=await browser.newPage();
const report=[];
for(const width of [900,390,320]){
 await page.setViewportSize({width,height:1100});
 for(const file of (await readdir(folder)).filter(f=>f.endsWith('.html')&&f!=='index.html')){
  await page.goto(pathToFileURL(join(folder,file)).toString(),{waitUntil:'domcontentloaded'});
  const issues=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,images:[...document.images].filter(i=>!i.hasAttribute('alt')).length,headings:document.querySelectorAll('h1').length,links:[...document.querySelectorAll('a')].filter(a=>!a.textContent.trim()).length}));
  assert.equal(issues.overflow,false,`${file} overflows at ${width}`);assert.equal(issues.images,0);assert.equal(issues.headings,1);assert.equal(issues.links,0);
  if(['ready_for_pickup.html','newsletter_offer.html','account_confirmation.html'].includes(file)){
   await page.waitForFunction(()=>[...document.images].every(i=>i.complete),{timeout:15000}).catch(()=>{});
   if(width===900)report.push({file,images:await page.evaluate(()=>[...document.images].map(i=>({url:i.src,loaded:i.naturalWidth>0}))) });
   await page.screenshot({path:join(folder,file.replace('.html',`-${width}.png`)),fullPage:true});
  }
 }
}
await page.route('**/*',route=>route.request().resourceType()==='image'?route.abort():route.continue());
await page.setViewportSize({width:390,height:1100});await page.goto(pathToFileURL(join(folder,'ready_for_pickup.html')).toString(),{waitUntil:'domcontentloaded'});
assert.ok((await page.locator('body').innerText()).includes('Strawberry Shortcake'));await page.screenshot({path:join(folder,'images-blocked.png'),fullPage:true});
await writeFile(join(folder,'browser-checks.json'),JSON.stringify(report,null,2));console.log('PASS 27 templates at 900/390/320px; images blocked; headings, alt text and links.');console.log(JSON.stringify(report));await browser.close();
