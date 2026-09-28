// Browser fixtures exercise the real editor, upload conversion, RPC client and public renderer.
// No live customer data, uploads or website changes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { completeClientFixture } from '../helpers/client-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://homepage.test',out=join(root,'tests/artifacts/homepage');
const seed=JSON.parse(await readFile(join(root,'tests/homepage-seed.json'),'utf8'));
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const base={products:[],categories:[],orders:[],inventory:[],promos:[],zones:[],staff:[],email_status:[],settings:{paused:false}};
const uploadUrl='https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000001.webp';
const mock=completeClientFixture(client,`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{access_token:'owner-fixture',user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
export async function api(action){if(action==='admin_bootstrap')return {...${JSON.stringify(base)},role:window.fixtureRole};throw Error('Unexpected action '+action);}
export async function websiteVisitorStats(){return {}};
export async function upload(file,options){window.uploads??=[];window.uploads.push({type:file.type,name:file.name,size:file.size,kind:options.kind});return {url:${JSON.stringify(uploadUrl)}};}
${helpers}`);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});await mkdir(out,{recursive:true});
const results=[];
try{
 for(const [width,role] of [[1440,'owner'],[390,'owner'],[390,'staff']]){
  let data={content:structuredClone(seed),revision:1},failSave=false,offline=false,calls=[];
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
  await context.addInitScript(role=>window.fixtureRole=role,role);
  await context.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url());
   if(u.pathname.endsWith('/rpc/homepage_api')){
    if(offline)return route.fulfill({status:503,body:'{}'});
    const {p_action,p_payload}=request.postDataJSON();calls.push(p_action);
    if(p_action!=='browse')assert.equal(request.headers().authorization,'Bearer owner-fixture');
    if(p_action==='save'){
     if(failSave){failSave=false;return route.fulfill({status:409,json:{message:'The home page changed in another window.'}});}
     assert.equal(p_payload.revision,data.revision);data={content:p_payload.content,revision:data.revision+1};
    }
    return route.fulfill({json:data});
   }
   if(u.pathname.startsWith('/storage/v1/object/public/product-images/'))return route.fulfill({contentType:'image/webp',body:await readFile(join(root,'assets/img/baking-classes.webp'))});
   if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes('bootstrap'))return route.continue();
   if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(u.pathname.endsWith('traffic.js')||u.pathname.endsWith('newsletter.js'))return route.fulfill({contentType:'text/javascript',body:''});
   const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({body:await readFile(file),contentType:mime[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/manage.html');await page.locator('#shop-status').filter({hasText:'Shop accepting orders'}).waitFor({state:'attached'});
  const nav=await page.locator('#admin-nav [data-view]').evaluateAll(els=>els.map(el=>el.dataset.view));assert.equal(nav.indexOf('homepage')+1,nav.indexOf('academy'));
  if(role==='staff'){assert.equal(await page.locator('[data-view=homepage]').isVisible(),false);assert.deepEqual(errors,[]);await context.close();results.push({width,role,passed:true});continue;}
  await page.locator('[data-view=homepage]').click();await page.locator('.home-photo').first().waitFor();
  assert.equal(await page.locator('.home-photo').count(),4);assert.equal(await page.locator('[data-home-save]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#homepage-manager').screenshot({path:join(out,`editor-${width}.png`)});
  await page.locator('[data-home-field=title]').fill('Baking classes <summer>');
  await page.locator('[data-home-field="button.0.label"]').fill('See classes');await page.locator('[data-home-field="button.0.href"]').fill('academy.html');
  await page.locator('[data-home-move="0,1"]').click();assert.equal(await page.locator('[data-home-field=title]').inputValue(),'Baking classes <summer>');
  await page.locator('[data-home-section]').selectOption('academy');assert.equal(await page.locator('.home-photo').count(),1);
  await page.locator('[data-home-upload]').setInputFiles(join(root,'assets/img/brands/Hat.png'));
  await page.waitForFunction(()=>document.querySelectorAll('.home-photo').length===2&&document.querySelector('#homepage-manager').dataset.busy==='false');
  const uploads=await page.evaluate(()=>window.uploads);assert.equal(uploads[0].type,'image/webp');assert.equal(uploads[0].kind,'product');assert.ok(uploads[0].size>0);
  await page.locator('[data-home-replace]').setInputFiles(join(root,'assets/img/brands/Hat.png'));await page.waitForFunction(()=>window.uploads.length===2&&document.querySelector('#homepage-manager').dataset.busy==='false');
  await page.locator('[data-home-remove="1"]').click();await page.getByRole('button',{name:'Keep photo',exact:true}).click();assert.equal(await page.locator('.home-photo').count(),2);
  await page.locator('[data-view=orders]').click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await page.locator('#homepage-manager').count(),1);
  failSave=true;await page.locator('[data-home-save]').click();await page.locator('[data-home-message]').filter({hasText:'another window'}).waitFor();assert.equal(await page.locator('#homepage-manager').getAttribute('data-dirty'),'true');
  await page.locator('[data-home-save]').click();await page.locator('[data-home-message]').filter({hasText:'Saved.'}).waitFor();
  assert.equal(data.content.specialties[3].photos.length,2);assert.equal(data.content.hero[1].title,'Baking classes <summer>');assert.equal(data.content.hero[1].buttons.length,1);
  await page.reload();await page.locator('[data-view=homepage]').click();await page.locator('[data-home-select="1"]').click();assert.equal(await page.locator('[data-home-field=title]').inputValue(),'Baking classes <summer>');
  await page.locator('[data-home-section]').selectOption('academy');await page.locator('[data-home-remove="1"]').click();await page.getByRole('button',{name:'Remove photo',exact:true}).click();assert.equal(await page.locator('.home-photo').count(),1);
  await page.locator('[data-home-reset]').click();await page.getByRole('button',{name:'Discard changes',exact:true}).last().click();assert.equal(await page.locator('.home-photo').count(),2);
  await page.locator('[data-home-section]').selectOption('hero');await page.locator('[data-home-field="button.0.href"]').fill('javascript:alert(1)');await page.locator('[data-home-save]').click();await page.locator('[data-home-message]').filter({hasText:'valid website page'}).waitFor();
  await page.locator('[data-home-reset]').click();await page.getByRole('button',{name:'Discard changes',exact:true}).last().click();
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>document.documentElement.dataset.homepageRevision==='2');
  assert.equal(await page.locator('#carousel-1 .carousel-item').count(),4);assert.equal(await page.locator('#home-specialty-3 .carousel-item').count(),2);
  assert.equal(await page.locator('#carousel-1 summer').count(),0);assert.equal(await page.locator('#carousel-1 .carousel-item').nth(1).locator('h1').innerText(),'Baking classes <summer>');
  await page.waitForFunction(()=>document.querySelector('#carousel-1 .carousel-item.active')!==document.querySelector('#carousel-1 .carousel-item'),{},{timeout:7500});
  await page.locator('#carousel-1 .home-carousel-pause').click();
  await page.evaluate(()=>document.querySelectorAll('.carousel').forEach(el=>window.bootstrap.Carousel.getInstance(el)?.pause()));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#carousel-1').screenshot({path:join(out,`banner-${width}.png`)});
  await page.locator('.home-specialties').scrollIntoViewIfNeeded();await page.locator('.home-specialties').screenshot({path:join(out,`categories-${width}.png`)});
  offline=true;await page.reload();await page.waitForFunction(()=>document.querySelector('#carousel-1 .home-carousel-pause'));
  assert.equal(await page.locator('#carousel-1 .carousel-item').count(),4);assert.equal(await page.locator('.specialty-grid>.col').count(),4);assert.equal(await page.locator('.home-managed-banner').count(),0);
  assert.deepEqual(errors,[]);results.push({width,role,passed:true,uploads:uploads.length,calls});await context.close();console.log('PASS Home page editor, navigation, upload, save, carousel and outage fallback: '+width);
 }
}finally{await browser.close();await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));}
