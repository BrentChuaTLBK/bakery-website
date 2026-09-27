// Local browser fixtures only. No owner session, live uploads or publishing.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {emptyClass} from '../../assets/ordering/academy-model.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://admin-loading.test',out=join(root,'test-results/academy-admin-loading');
await mkdir(out,{recursive:true});
const ref=i=>({id:'photo-'+i,asset_id:'asset-'+i,alt:'Camp photo '+i,caption:'',focal_x:50,focal_y:50,kind:'activity',batch_id:''});
const assets=Array.from({length:2600},(_,i)=>({id:'asset-'+i,original_name:'Camp photo '+i,width:800,height:600,url:'/photo/'+i+'.svg'}));
const content={...emptyClass('2nd Summer Baking Camp'),hero:ref(0),thumbnail:ref(1),batches:Array.from({length:13},(_,i)=>({id:'batch-'+i,label:'Batch '+(i+1),description:'',start_date:'',end_date:'',student_count:null,cover:ref(i*200),photos:Array.from({length:200},(_,j)=>ref(i*200+j))}))};
const data={settings:{revision:1,draft:{heading:'Class albums',description:'',class_order:['camp'],featured_id:'camp',enquiry_url:'https://www.instagram.com/tlbacademy/',enquiry_heading:'Classes',enquiry_text:''}},classes:[{id:'camp',revision:1,draft:content,published:content}],assets};
const mock=`import {assetIds} from './academy-model.js';
 const data=${JSON.stringify(data)};
 window.photoCalls=[];window.photoFail=false;window.photoDelay=650;window.photoVersion=1;window.adminCalls=[];
 export const galleryImageAccept='image/webp';export function bindAcademyImageRefresh(){};
 export async function academyImages(content){const ids=assetIds(content),map={};for(let i=0;i<ids.length;i+=500){const group=ids.slice(i,i+500);window.photoCalls.push(group);await new Promise(r=>setTimeout(r,window.photoDelay));if(window.photoFail)throw Error('Offline');for(const id of group){const asset=data.assets.find(a=>a.id===id);if(asset)map[id]={...asset,url:asset.url+'?v='+window.photoVersion};}}return map;}
 export async function uploadAcademyPhoto(){const a={id:'upload',original_name:'Uploaded photo',width:800,height:600,url:'/photo/upload.svg'};data.assets.unshift(a);return a;}
 export async function academyApi(action,payload={}){window.adminCalls.push(action);if(action==='admin'){await new Promise(r=>setTimeout(r,100));return structuredClone(data);}if(action==='save_class'){window.savedDraft=structuredClone(payload.content);data.classes[0].draft=payload.content;data.classes[0].revision++;return structuredClone(data.classes[0]);}throw Error('Unexpected mutation '+action);}`;
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/ordering.css"><link rel="stylesheet" href="/assets/ordering/manage.css"><link rel="stylesheet" href="/assets/ordering/accounting.css"><link rel="stylesheet" href="/assets/ordering/academy-manager.css"><style>#academy-manager{max-width:1180px;margin:auto;padding:20px}</style><body class="manage-page"><main id="academy-manager"></main><script type="module">import {mountAcademy} from '/assets/ordering/academy-manager.js';const start=performance.now();await mountAcademy(document.querySelector('main'),{role:'owner',connected:true});window.mountMs=performance.now()-start;</script>`;
const mime={'.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
const results=[];
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/assets/ordering/academy-client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(u.pathname==='/assets/ordering/academy-manager.js'&&process.env.ACADEMY_ADMIN_BASELINE)return route.fulfill({contentType:'text/javascript',body:await readFile(process.env.ACADEMY_ADMIN_BASELINE)});
   if(u.pathname.startsWith('/photo/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#dce8d9"/><circle cx="400" cy="240" r="120" fill="#b98963"/></svg>'});
   const file=resolve(root,'.'+u.pathname);if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)})}catch{return route.fulfill({status:404,body:''})}
  });
  await page.goto(origin);await page.waitForFunction(()=>window.mountMs!==undefined);
  const initial=await page.evaluate(()=>({mountMs:Math.round(window.mountMs),signedPhotos:window.photoCalls.flat().length}));
  results.push({width,...initial});
  if(process.env.ACADEMY_ADMIN_BASELINE){await context.close();continue;}
  assert.ok(initial.mountMs<550,'Editor renders before the first delayed photo response');
  assert.ok(initial.signedPhotos<10,'Dashboard does not sign the whole library');
  await page.locator('[data-ac=edit]').click();await page.waitForTimeout(750);
  assert.ok((await page.evaluate(()=>window.photoCalls.flat())).every(id=>['asset-0','asset-1'].includes(id)),'Collapsed albums stay unloaded');
  await page.locator('[data-section=batches]>summary').click();
  const grid=page.locator('.ac-album-grid');
  assert.equal(await grid.locator('.ac-album-photo').count(),48,'Large albums render 48 cards at a time');
  await page.locator('[data-ac-field="batches.0.description"]').fill('Keep these unsaved notes');
  await grid.locator('img').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>!document.querySelector('.ac-album-grid img').hasAttribute('data-academy-pending'));
  const signed=await page.evaluate(()=>window.photoCalls.flat());
  assert.ok(signed.length<70,'Only visible photos and nearby batch covers are fetched');
  assert.ok(!signed.includes('asset-250'),'Unselected batch photos are untouched');
  // Moving beyond the last rendered card reveals its new position and keeps focus.
  await grid.getByRole('button',{name:'Move photo 48 later',exact:true}).click();
  assert.equal(await grid.locator('.ac-album-photo').count(),49);
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.index),'48');
  await page.locator('[data-ac=more-photos]').click();assert.equal(await grid.locator('.ac-album-photo').count(),97);
  assert.equal(await page.locator('[data-ac-field="batches.0.description"]').inputValue(),'Keep these unsaved notes');
  await page.locator('[data-ac=select-batch][data-id="batch-1"]').click();
  assert.equal(await grid.locator('.ac-album-photo').count(),48,'Each batch has an independent page limit');
  await page.locator('[data-ac-field="batches.1.description"]').fill('Batch two notes');
  // Picker opens immediately, even with 2,600 stored photos and slow signing.
  await page.locator('[data-ac=media][data-path="batches.1.photos"]').click();
  const dialog=page.getByRole('dialog',{name:'Choose Academy photos'});
  assert.equal(await dialog.locator('[data-asset]').count(),48);
  await dialog.locator('[data-ac=more-library]').click();assert.equal(await dialog.locator('[data-asset]').count(),96);
  await dialog.locator('[data-asset="asset-95"]').click();
  await dialog.locator('[type=file]').setInputFiles({name:'new.webp',mimeType:'image/webp',buffer:Buffer.from('mock upload')});
  await dialog.waitFor({state:'hidden'});
  await page.locator('[data-ac=save]').click();await page.waitForFunction(()=>window.savedDraft);
  const saved=await page.evaluate(()=>window.savedDraft);
  assert.equal(saved.batches[0].description,'Keep these unsaved notes');
  assert.equal(saved.batches[0].photos[48].asset_id,'asset-47');
  assert.equal(saved.batches[0].photos.length,200,'Pagination never trims saved photos');
  assert.equal(saved.batches[1].photos.length,202);
  assert.equal(saved.batches[1].photos.at(-2).asset_id,'asset-95');
  assert.equal(saved.batches[1].photos.at(-1).asset_id,'upload','Upload is assigned to the selected batch');
  assert.equal(saved.batches[12].photos.length,200,'Unopened batches remain intact');
  // Failed background metadata can be retried without clearing unsaved fields.
  await page.evaluate(()=>{window.photoFail=true;window.photoDelay=50;});
  await page.locator('[data-ac=select-batch][data-id="batch-12"]').click();
  await grid.locator('img').first().scrollIntoViewIfNeeded();
  await page.locator('#academy-manager>.academy-photo-status:not([hidden])').waitFor();
  await page.locator('[data-ac-field="batches.12.description"]').fill('Offline draft');
  await page.evaluate(()=>window.photoFail=false);
  await page.locator('#academy-manager>.academy-photo-status button').click();
  await grid.locator('img').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>!document.querySelector('.ac-album-grid img').hasAttribute('data-academy-pending'));
  assert.equal(await page.locator('[data-ac-field="batches.12.description"]').inputValue(),'Offline draft');
  // Signed URL recovery does not rerender the form or disturb focus.
  await page.locator('[data-ac-field="batches.12.description"]').focus();
  await page.evaluate(()=>{window.photoVersion=2;document.querySelector('.ac-album-grid img').dispatchEvent(new Event('error'));});
  await page.waitForFunction(()=>document.querySelector('.ac-album-grid img').src.endsWith('?v=2'));
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.acField),'batches.12.description');
  await grid.locator('img').first().scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'admin-'+width+'.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  // Navigation tears down observers while a slow photo response is in flight.
  await page.evaluate(()=>{window.photoDelay=400;document.querySelector('.ac-album-grid img').dispatchEvent(new Event('error'));document.querySelector('main').remove();});
  await page.waitForTimeout(500);assert.deepEqual(errors,[]);
  await context.close();
 }
 const name=process.env.ACADEMY_ADMIN_BASELINE?'before':'after';await writeFile(join(out,name+'.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({mode:name,results}));
 if(!process.env.ACADEMY_ADMIN_BASELINE)console.log('PASS admin: nonblocking dashboard, visible photos only, paged album/library, boundary reorder, complete draft saves, correct upload batch, offline retry, URL renewal, detached editor and mobile layout.');
}finally{await browser.close();}
