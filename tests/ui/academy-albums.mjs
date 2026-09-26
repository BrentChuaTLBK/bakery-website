// Browser fixtures only: no live APIs, uploads, customer data, or publishing.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {emptyClass} from '../../assets/ordering/academy-model.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://album.test',out=join(root,'test-results/academy-albums');await mkdir(out,{recursive:true});
const id='a0000000-0000-4000-8000-000000000001',batch='a0000000-0000-4000-8000-000000000002';
const assets=Array.from({length:12},(_,i)=>({id:`asset-${i}`,original_name:`QA photo ${i+1}`,width:800,height:600,url:`/fixture-photo/${i}.svg`}));
const photo=i=>({id:`photo-${i}`,asset_id:assets[i%assets.length].id,alt:`Existing alt ${i}`,caption:`Existing caption ${i}`,focal_x:30,focal_y:70,batch_id:'',kind:i%2?'group':'activity'});
function fixture(count){return {settings:{revision:1,draft:{heading:'Class albums',description:'',featured_id:id,class_order:[id],enquiry_url:'https://www.instagram.com/tlbacademy/',enquiry_heading:'Classes',enquiry_text:''}},classes:[{id,revision:1,published:null,draft:{...emptyClass('Album QA class'),allow_photo_placeholders:true,hero:photo(0),thumbnail:photo(1),creations:[{id:'creation',name:'Cookies',description:'QA creation',photos:[photo(2)]}],batches:[{id:batch,label:'Batch 1',description:'',start_date:'',end_date:'',student_count:null,cover:photo(3),photos:Array.from({length:count},(_,i)=>photo(i))}]}}],assets};}
const mock=count=>`const initial=${JSON.stringify(fixture(count))};let data=JSON.parse(sessionStorage.getItem('album-fixture-'+initial.classes[0].draft.batches[0].photos.length)||'null')||initial;window.albumCalls=[];window.uploadCalls=0;
export const galleryImageAccept='image/webp';export function bindAcademyImageRefresh(){};export async function academyImages(){return Object.fromEntries(initial.assets.map(a=>[a.id,a]))};export async function uploadAcademyPhoto(){window.uploadCalls++;throw Error('Unexpected upload')};
export async function academyApi(action,payload={}){window.albumCalls.push(action);if(action==='admin')return structuredClone(data);if(action==='save_class'){const row=data.classes[0];if(payload.revision!==row.revision)throw Error('Changed revision');row.draft=structuredClone(payload.content);row.revision++;sessionStorage.setItem('album-fixture-'+initial.classes[0].draft.batches[0].photos.length,JSON.stringify(data));window.savedAlbum=structuredClone(row.draft);return structuredClone(row)}throw Error('Unexpected API '+action)}`;
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/ordering.css"><link rel="stylesheet" href="/assets/ordering/manage.css"><link rel="stylesheet" href="/assets/ordering/accounting.css"><link rel="stylesheet" href="/assets/ordering/academy-manager.css"><style>#academy-manager{max-width:1180px;margin:auto;padding:20px}</style><body class="manage-page"><main id="academy-manager"></main><script type="module">import {mountAcademy} from '/assets/ordering/academy-manager.js';mountAcademy(document.getElementById('academy-manager'),{role:'owner',connected:true});</script>`;
const mime={'.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
async function setup(width,count){
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('Native dialog: '+d.message());return d.dismiss()});
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(u.pathname==='/assets/ordering/academy-client.js')return route.fulfill({contentType:'text/javascript',body:mock(count)});if(u.pathname.startsWith('/fixture-photo/')){const n=Number(u.pathname.split('/').pop().split('.')[0]),colors=['#f3dacb','#dce8d9','#dde9ed'];return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${colors[n%3]}"/><circle cx="400" cy="240" r="95" fill="#c99e7d"/><text x="400" y="440" fill="#583e2d" font-size="42" text-anchor="middle">QA photo ${n+1}</text></svg>`})}const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)})}catch{return route.fulfill({status:404,body:''})}});
 await page.goto(origin);await page.locator('[data-ac=edit]').click();await page.locator('[data-section=batches]>summary').click();
 return {context,page,errors,grid:page.locator('.ac-album-grid').first()};
}
const albumIds=grid=>grid.locator('.academy-photo').evaluateAll(nodes=>nodes.map(node=>node.dataset.academyAsset));
async function touchReorder(page,grid,from,to){
 const a=grid.locator('[data-ac-drag]').nth(from),b=grid.locator('[data-ac-drag]').nth(to);await a.scrollIntoViewIfNeeded();await b.scrollIntoViewIfNeeded();const ab=await a.boundingBox(),bb=await b.boundingBox(),start={x:ab.x+ab.width/2,y:ab.y+ab.height/2},end={x:bb.x+bb.width/2,y:bb.y+bb.height/2};
 const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/6,y:start.y+(end.y-start.y)*i/6}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
try{
 for(const width of [1440,390,320]){
  const {context,page,errors,grid}=await setup(width,552);
  assert.equal(await grid.locator('.ac-album-photo').count(),552,'Large album renders as a compact grid');
  assert.equal(await grid.locator('input,textarea,select,[data-ac=media]').count(),0,'No individual photo editing controls');
  assert.equal(await page.locator('[data-ac-field="hero.caption"],[data-ac-field="batches.0.cover.focal_x"],[data-ac-field="creations.0.photos.0.alt"]').count(),3,'Hero, cover, and creation editing remains available');
  const original=await albumIds(grid);
  await grid.getByRole('button',{name:'Move photo 1 later',exact:true}).click();
  let expected=[original[1],original[0],...original.slice(2)];assert.deepEqual(await albumIds(grid),expected,'Arrow reordering changes only order');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.index),'1','Focus follows the moved photo');
  if(width===1440){await grid.locator('[data-ac-drag]').nth(2).dragTo(grid.locator('.ac-album-photo').first());expected.splice(0,0,...expected.splice(2,1));}
  else{await touchReorder(page,grid,0,1);expected.splice(1,0,...expected.splice(0,1));}
  assert.deepEqual(await albumIds(grid),expected,'Mouse or horizontal touch reordering works');
  await grid.locator('.ac-album-photo').first().scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`album-grid-${width}.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Grid fits '+width+'px');
  const columns=await grid.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);assert.ok(columns>1,'Photos sit beside each other');
  const remove=grid.getByRole('button',{name:'Remove photo 2',exact:true}),prompt=page.getByRole('dialog',{name:'Remove photo?',exact:true});
  await remove.click();await prompt.getByRole('button',{name:'Cancel',exact:true}).click();await prompt.waitFor({state:'hidden'});assert.deepEqual(await albumIds(grid),expected);
  await remove.click();await prompt.getByRole('button',{name:'Remove photo',exact:true}).click();await prompt.waitFor({state:'hidden'});expected.splice(1,1);assert.deepEqual(await albumIds(grid),expected);
  assert.deepEqual(await page.evaluate(()=>window.albumCalls),['admin'],'Reorder/remove stays local until save');
  await page.locator('[data-ac=media][data-path="batches.0.photos"]').click();await page.locator('.ac-media-dialog [data-asset]').first().click();await page.locator('[data-ac=close-media]').click();expected.push(assets[0].id);assert.deepEqual(await albumIds(grid),expected,'Library reuse appends to the album');
  await page.locator('[data-ac=save]').click();await page.getByText('Class draft saved. Published content is unchanged.',{exact:true}).waitFor();
  const saved=await page.evaluate(()=>window.savedAlbum);assert.equal(saved.batches[0].photos.length,552);assert.deepEqual(saved.batches[0].photos.map(p=>p.asset_id),expected);
  const retained=saved.batches[0].photos.find(p=>p.id==='photo-20');assert.deepEqual(retained,photo(20),'Existing captions, alt, crop, and type metadata are preserved');
  await page.reload();await page.locator('[data-ac=edit]').click();await page.locator('[data-section=batches]>summary').click();assert.deepEqual(await albumIds(grid),expected,'Saved photo order survives reload');
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS Academy album ${width}px: 552-photo compact grid, rich cover controls retained, mouse/touch/arrows, remove cancellation, reuse, draft save/reload`);
 }
 const {context,page,errors,grid}=await setup(390,2000);
 await page.locator('[data-ac=media][data-path="batches.0.photos"]').click();await page.locator('.ac-media-dialog [data-asset]').first().click();await page.getByText('This album can hold 2,000 photos. Remove a photo before adding another.',{exact:true}).waitFor();
 await page.locator('.ac-media-dialog input[type=file]').setInputFiles({name:'extra.webp',mimeType:'image/webp',buffer:Buffer.from('fixture blocked before decode')});assert.equal(await page.evaluate(()=>window.uploadCalls),0,'Capacity rejection happens before upload');await page.locator('[data-ac=close-media]').click();assert.equal(await grid.locator('.ac-album-photo').count(),2000);assert.deepEqual(errors,[]);await context.close();console.log('PASS 2,000-photo capacity blocks extra uploads and library additions without losing the draft');
}finally{await browser.close()}
