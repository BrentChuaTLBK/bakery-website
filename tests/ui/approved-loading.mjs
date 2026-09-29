import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {join,resolve,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://loading.test',out=join(root,'test-results/approved-loading');await mkdir(out,{recursive:true});
const real=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=real.slice(real.indexOf('export function money('));
const catalog={products:[],categories:[],inventory:[],zones:[],settings:{paused:false,shop_name:'Loading fixture',production_weekdays:[0,1,2,3,4,5,6]}};
const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:null}}),onAuthStateChange(){}};export async function api(){await new Promise(r=>window.releaseCatalog=r);if(window.failCatalog)throw Error('Fixture connection failed');return ${JSON.stringify(catalog)}};export async function upload(){};${helpers}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});const results=[];
try{for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(u.pathname==='/assets/ordering/client.js')return route.fulfill({body:mock,contentType:'text/javascript'});if(/traffic.js|newsletter.js/.test(u.pathname))return route.fulfill({body:'',contentType:'text/javascript'});const path=resolve(root,'.'+u.pathname);if(!path.startsWith(root+sep))return route.abort();try{return route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/shop.html');await page.waitForFunction(()=>typeof window.releaseCatalog==='function');
 const skeleton=page.locator('[data-loading-state]');assert.ok((await skeleton.boundingBox()).height>=800);assert.equal(await skeleton.getByRole('button').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,`shop-loading-${width}.png`)});
 await page.evaluate(()=>{window.failCatalog=true;window.releaseCatalog()});await page.locator('#retry-menu').waitFor();assert.equal(await page.locator('[aria-busy=true]').count(),0);assert.equal(await skeleton.count(),0);
 await page.locator('#retry-menu').click();await skeleton.waitFor();await page.evaluate(()=>{window.failCatalog=false;window.releaseCatalog()});await page.locator('#fulfillment-date').waitFor();assert.equal(await page.locator('[aria-busy=true]').count(),0);assert.match(await page.locator('.customer-calendar-range').innerText(),/Bookings are open through/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 await page.screenshot({path:join(out,`shop-ready-${width}.png`)});results.push({width,loadingReserve:true,retry:true,emptyCatalog:true,noOverflow:true});await context.close();
}
await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));console.log('PASS loading reserve, failure/retry, empty catalog, calendar range and mobile/desktop overflow');}finally{await browser.close()}
