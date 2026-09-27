// Browser conversion and upload fixtures only. No files or emails leave this test.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://newsletter-upload.test',out=join(root,'test-results/newsletter-uploads');
await mkdir(out,{recursive:true});
const previewPhoto=await readFile(join(root,'assets/pastries/Tiramisu/Classic_Tiramisu.webp'));
const admin=`let rows=[];window.calls=[];export async function newsletterAdmin(action,p={}){window.calls.push({action,payload:structuredClone(p)});if(action==='load')return {subscriber_count:42,campaigns:structuredClone(rows)};if(action==='save'){const row={...p,status:'draft',revision:p.revision+1};rows=[row];return structuredClone(row)}if(action==='test')return {queued:1,email:'owner@example.test'};if(action==='queue')return {...rows[0],status:'queued',queued:42};throw Error(action)}`;
const upload=`window.uploaded=[];export async function upload(file,options){
 if(window.failUpload)throw Error('Photo upload failed. Try again.');
 if(window.holdUpload)await new Promise(resolve=>window.finishUpload=resolve);
 const bytes=new Uint8Array(await file.arrayBuffer()),image=await createImageBitmap(file);
 const url='https://newsletter-upload.test/uploads/'+crypto.randomUUID()+'.jpg';
 window.uploaded.push({url,name:file.name,type:file.type,size:file.size,kind:options.kind,width:image.width,height:image.height,header:Array.from(bytes.slice(0,3))});image.close();return {url};
}`;
const html=`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/ordering.css"><link rel="stylesheet" href="/assets/ordering/manage.css"><link rel="stylesheet" href="/assets/ordering/newsletter-manager.css"><body class="manage-page"><main style="padding:20px;max-width:1400px;margin:auto"><div id="newsletters"></div></main><script type="module">import {mountNewsletters} from '/assets/ordering/newsletter-manager.js';mountNewsletters(document.querySelector('#newsletters'),{settings:{pickup_address:'Test shop address'},products:[]});</script></body></html>`;
// Keep srcdoc image requests in the test's intercepted browser process. This
// affects this fixture only; the application's iframe sandbox is unchanged.
const browser=await chromium.launch({headless:true,args:['--disable-features=IsolateSandboxedIframes'],executablePath:process.env.BROWSER_EXECUTABLE_PATH});
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/assets/ordering/newsletter-admin-client.js')return route.fulfill({contentType:'text/javascript',body:admin});
  if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:upload});
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
  if(u.origin!==origin||u.pathname.startsWith('/uploads/'))return route.fulfill({contentType:'image/webp',body:previewPhoto});
  const path=resolve(root,'.'+u.pathname);if(!path.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(path),contentType:{'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'}[extname(path)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}
 });
 await page.goto(origin);await page.locator('[data-template=showcase]').click();
 await page.locator('[name=subject]').fill('Keep this newsletter subject');
 await page.locator('[name="item.0.description"]').fill('Keep this product description');
 const fixtures=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=3000;canvas.height=1800;
  canvas.getContext('2d').fillRect(500,0,2500,1800);
  return Object.fromEntries(['png','jpeg','webp'].map(format=>[format,canvas.toDataURL('image/'+format).split(',')[1]]));
 });
 const file=(format='png')=>({name:'newsletter.'+(format==='jpeg'?'jpg':format),mimeType:'image/'+format,buffer:Buffer.from(fixtures[format],'base64')});
 const hero=page.locator('[data-nl-photo="hero_url"]'),product=page.locator('[data-nl-photo="item.0.image_url"]');
 await page.evaluate(()=>window.holdUpload=true);
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload main photo',exact:true}).click();await(await chooser).setFiles(file());
 await page.waitForFunction(()=>typeof window.finishUpload==='function');
 assert.equal(await page.locator('[data-nl=send]').isDisabled(),true,'Sending is blocked during upload');
 assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
 assert.equal(await page.locator('[data-nl=back]').isDisabled(),true);
 assert.equal(await page.locator('#newsletters').getAttribute('aria-busy'),'true');
 await page.evaluate(()=>{window.holdUpload=false;window.finishUpload()});
 await hero.getByText('Photo uploaded. Save your draft to keep this change.',{exact:true}).waitFor();
 const first=await page.evaluate(()=>window.uploaded[0]);
 assert.equal(first.type,'image/jpeg');assert.equal(first.name,'newsletter.jpg');assert.equal(first.kind,'product');assert.equal(first.width,1600);assert.equal(first.height,960);assert.deepEqual(first.header,[255,216,255]);assert(first.size>0&&first.size<=5*1024*1024);
 assert.equal(await page.locator('[name=hero_url]').inputValue(),first.url);
 assert((await page.locator('iframe').getAttribute('srcdoc')).includes(first.url));
 assert.equal(await page.locator('[name=subject]').inputValue(),'Keep this newsletter subject');
 assert.equal(await page.locator('[name="item.0.description"]').inputValue(),'Keep this product description');
 assert.equal(await page.locator('#newsletters').getAttribute('data-dirty'),'true');
 await product.locator('input[type=file]').setInputFiles(file('webp'));
 await product.getByText('Photo uploaded. Save your draft to keep this change.',{exact:true}).waitFor();
 const second=await page.evaluate(()=>window.uploaded[1]);
 assert.equal(await page.locator('[name="item.0.image_url"]').inputValue(),second.url);assert.notEqual(first.url,second.url);
 assert.equal(await page.locator('[name=hero_url]').inputValue(),first.url,'Product upload only changes its own photo');
 await page.evaluate(()=>window.failUpload=true);
 await hero.locator('input[type=file]').setInputFiles(file('jpeg'));
 await hero.getByText('Photo upload failed. Try again.',{exact:true}).waitFor();
 assert.equal(await page.locator('[name=hero_url]').inputValue(),first.url,'Failure retains previous photo');
 assert.equal(await page.locator('[name=subject]').inputValue(),'Keep this newsletter subject');
 assert.equal(await page.locator('[data-nl=send]').isDisabled(),false);
 await page.evaluate(()=>window.failUpload=false);
 await hero.locator('input[type=file]').setInputFiles(file('jpeg'));
 await hero.getByText('Photo uploaded. Save your draft to keep this change.',{exact:true}).waitFor();
 const replacement=await page.locator('[name=hero_url]').inputValue();assert.notEqual(first.url,replacement);
 await hero.locator('input[type=file]').setInputFiles({name:'forged.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not an image')});
 await hero.getByText('This image could not be opened. Try another image file.',{exact:true}).waitFor();
 await hero.locator('input[type=file]').setInputFiles({name:'too-large.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(25*1024*1024+1)});
 await hero.getByText('Choose an image up to 25 MB.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.uploaded.length),3);
 if(process.env.HEIC_TEST_FILE&&width===1440){
  await hero.locator('input[type=file]').setInputFiles({name:'iPhone.heic',mimeType:'image/heic',buffer:await readFile(process.env.HEIC_TEST_FILE)});
  await hero.getByText('Photo uploaded. Save your draft to keep this change.',{exact:true}).waitFor({timeout:60000});
  const heic=await page.evaluate(()=>window.uploaded.at(-1));assert.equal(heic.type,'image/jpeg');assert.equal(heic.name,'iPhone.jpg');assert(Math.max(heic.width,heic.height)<=1600);
 }
 // Existing gallery/Academy uploads keep their original WebP default.
 const originalFormat=await page.evaluate(async(base64)=>{const {prepareGalleryImage}=await import('/assets/ordering/gallery-image.js?v=newsletter-photos-1');const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));return(await prepareGalleryImage(new File([bytes],'original.png',{type:'image/png'}))).file.type;},fixtures.png);
 assert.equal(originalFormat,'image/webp');
 const savedHero=await page.locator('[name=hero_url]').inputValue();
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Newsletter draft saved.',{exact:true}).waitFor();
 const saved=await page.evaluate(()=>window.calls.filter(c=>c.action==='save').at(-1).payload.content);
 assert.equal(saved.hero_url,savedHero);assert.equal(saved.items[0].image_url,second.url);
 await page.locator('[data-nl=back]').click();await page.getByRole('button',{name:'Edit',exact:true}).click();
 assert.equal(await page.locator('[name=hero_url]').inputValue(),savedHero);assert.equal(await page.locator('[name="item.0.image_url"]').inputValue(),second.url);
 await page.locator('[data-nl=test]').click();await page.getByText('Test queued for owner@example.test.',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='queue').length),0,'Uploading and testing never sends to subscribers');
 await page.frameLocator('iframe').locator('img').first().waitFor();
 await page.frameLocator('iframe').locator('img').first().evaluate(img=>img.decode());
 assert.equal(await page.frameLocator('iframe').locator('img').first().getAttribute('src'),savedHero,'Uploaded hero renders inside the email preview');
 await hero.scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`uploads-${width}.png`)});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: main/product uploads, JPEG conversion, retained edits, failure/retry, validation, save/reopen and email preview`);
}}finally{await browser.close()}
