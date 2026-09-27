import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {galleryThumbnails} from '../../assets/ordering/gallery-thumbnail-map.js';
import {galleryPhoto} from '../../assets/ordering/gallery-thumbnail.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://thumbnail.test';
const paths=[Object.keys(galleryThumbnails).find(path=>path.startsWith('/assets/CustomOrders/')),'/assets/pastries/CookieBottle/IMG_4116.jpeg'];
const photos=paths.map((path,i)=>({id:`photo-${i}`,title:`Photo ${i}`,category:'Cakes',photo_url:'https://thelittlebakerkitchen.com'+path}));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH});
try{
 for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:900}}),requests=[],errors=[];let failThumbnail=false;
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/rest/v1/rpc/gallery_api')return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,total:2,items:photos,categories:['Cakes']})});
   if(url.pathname==='/rest/v1/rpc/newsletter_offer')return route.fulfill({contentType:'application/json',body:'{"enabled":false,"kind":"percent","value":5}'});
   if(![origin,'https://thelittlebakerkitchen.com'].includes(url.origin))return route.abort();
   if(/\/assets\/ordering\/(traffic|newsletter)\.js/.test(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   if(route.request().resourceType()==='image')requests.push(url.href);
   if(failThumbnail&&url.pathname===galleryThumbnails[paths[0]])return route.fulfill({status:404,body:''});
   const file=resolve(root,'.'+decodeURIComponent(url.pathname));assert(file.startsWith(root+sep));
   try{return route.fulfill({body:await readFile(file),contentType:{'.js':'text/javascript','.html':'text/html','.css':'text/css','.webp':'image/webp','.png':'image/png'}[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/customorders.html');await page.locator('.portfolio-card img').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('.portfolio-card img')].length===2&&[...document.querySelectorAll('.portfolio-card img')].every(i=>i.complete&&i.naturalWidth));
  assert(await page.locator('.portfolio-card img').evaluateAll(images=>images.every(i=>i.src.includes('/gallery-thumbnails/'))));
  assert(photos.every(p=>!requests.includes(p.photo_url)&&!requests.includes(galleryPhoto(p.photo_url))),'Tile loading must not fetch full-size originals');
  await page.locator('[data-photo="1"]').click();await page.waitForFunction(()=>{const i=document.querySelector('.portfolio-lightbox img');return i.complete&&i.naturalWidth>0;});
  assert.equal(await page.locator('.portfolio-lightbox img').getAttribute('src'),galleryPhoto(photos[1].photo_url));
  await page.keyboard.press('Escape');failThumbnail=true;await page.reload();
  await page.waitForFunction(original=>{const i=document.querySelector('.portfolio-card img');return i.src===original&&i.complete&&i.naturalWidth>0;},photos[0].photo_url);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);await ctx.close();
 }
 console.log('PASS desktop/mobile thumbnails only, click loads WebP original, failed thumbnail restores original, and no layout overflow.');
}finally{await browser.close();}
