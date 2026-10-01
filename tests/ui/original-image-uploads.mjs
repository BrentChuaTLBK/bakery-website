import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
import {selectDashboardSection} from '../helpers/dashboard-nav.mjs';
import {inspectImage} from '../../assets/ordering/image-format.js';
const engine=process.env.ORIGINAL_IMAGE_ENGINE||'chromium';
const t=await recipeBrowserHarness({engine}),{db,h,origin}=t,checks=[],objects=new Map(),uploads=[];
const out='work/approved-audit/original-images-'+engine;await mkdir(out,{recursive:true});
const source=await readFile('assets/ordering/client.js','utf8'),heic=await readFile('assets/CustomOrders/DripCakes/Drip14.HEIC');
let handler,hold=null,failUpload=false,saves=0,currentPage;
const oldFetch=globalThis.fetch;
globalThis.Deno={env:{get:n=>({SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:'private-fixture',ALLOWED_ORIGINS:origin}[n]||'')},serve:fn=>handler=fn};
await import('../../supabase/functions/proof-upload/index.ts');
globalThis.fetch=async(url,options={})=>{
 if(String(url).includes('/auth/v1/user'))return Response.json({id:h.ids.owner});
 if(String(url).includes('/rpc/shop_service')){const p=JSON.parse(options.body);try{return Response.json(await t.run(()=>h.service(p.p_action,p.p_payload)));}catch(e){console.log('RPC failure',p.p_action,e.message);throw e;}}
 if(String(url).includes('/storage/v1/object/')&&options.method==='POST'){
  const path=new URL(url).pathname.split('/object/')[1],bytes=Buffer.from(options.body),info=inspectImage(bytes),headers=new Headers(options.headers);
  assert.equal(info.mime,headers.get('content-type'));assert(path.endsWith('.'+info.extension));
  objects.set(path,{bytes,mime:info.mime});uploads.push({...info,path,bytes});
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',[path.split('/')[0],path.split('/').slice(1).join('/'),JSON.stringify({size:bytes.length,mimetype:info.mime})]);return Response.json({});
 }throw Error('Unexpected endpoint fetch '+url);
};
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',engine,name)};
try{
 const product=await h.product({name:'Photo fallback cake'}),p=await t.pageFor(h.ids.owner,390,{isMobile:true,hasTouch:true});const {page,context}=p;currentPage=page;page.setDefaultTimeout(12000);
 await context.exposeFunction('imageFixtureRpc',async(name,payload)=>t.run(async()=>{assert.equal(name,'shop_api');if(payload.p_action==='save_product')saves++;return {data:await h.api(payload.p_action,payload.p_payload,h.ids.owner,payload.p_token),error:null};}));
 await context.route('**/assets/ordering/heic-preview.js*',async r=>r.fulfill({contentType:'text/javascript',body:(await readFile('assets/ordering/heic-preview.js','utf8')).replace('}catch{/*', '}catch(error){window.heicPreviewError=String(error);/*')}));
 await context.route('**/assets/ordering/client.js*',r=>r.fulfill({contentType:'text/javascript',body:source}));
 await context.route('**/assets/ordering/config.js*',r=>r.fulfill({contentType:'text/javascript',body:`export const config={supabaseUrl:${JSON.stringify(origin)},supabasePublishableKey:'sb_publishable_fixture'};`}));
 await context.exposeFunction('imageFixtureEdge',async(name,entries)=>{
  if(name!=='proof-upload')return {status:200,data:{}};
  if(hold){hold.started();await hold.promise;hold=null;}
  if(failUpload){failUpload=false;return {status:503,data:{error:'Temporary test upload failure'}};}
  const form=new FormData();for(const [key,value] of entries)form.append(key,typeof value==='string'?value:new File([Buffer.from(value.base64,'base64')],value.name,{type:value.type}));
  const response=await handler(new Request(origin+'/functions/v1/proof-upload',{method:'POST',headers:{authorization:'Bearer fixture-user',origin},body:form}));const data=await response.json();if(!response.ok)console.log('Upload endpoint failure',response.status,data);return {status:response.status,data};
 });
 await context.route('https://esm.sh/**',r=>r.fulfill({contentType:'text/javascript',body:`export function createClient(){return {auth:{initialize:async()=>({error:null}),getSession:async()=>({data:{session:{user:{id:${JSON.stringify(h.ids.owner)}},access_token:'fixture-user'}}}),onAuthStateChange:()=>{}},rpc:(name,p)=>window.imageFixtureRpc(name,p),functions:{invoke:async(name,options)=>{const entries=[];for(const [key,value]of options.body?.entries?.()||[]){if(value instanceof File){const bytes=new Uint8Array(await value.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));entries.push([key,{name:value.name,type:value.type,base64:btoa(binary)}]);}else entries.push([key,value]);}const {status,data}=await window.imageFixtureEdge(name,entries);return status<300?{data}:{error:{message:data.error,context:new Response(JSON.stringify(data),{status})}};}}};}`}));
 await context.route('**/storage/v1/object/public/**',async r=>{const path=new URL(r.request().url()).pathname.split('/public/')[1],value=objects.get(path);assert(value);return r.fulfill({contentType:value.mime,body:value.bytes});});
 await page.goto(origin+'/manage.html');await selectDashboardSection(page,'products');
 await page.locator(`[data-action=edit-product][data-id="${product.id}"]`).click();
 const files=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=360;c.height=240;c.getContext('2d').fillRect(0,0,180,240);return ['png','jpeg'].map(t=>c.toDataURL('image/'+t).split(',')[1]);});
 const png=Buffer.from(files[0],'base64'),jpeg=Buffer.from(files[1],'base64');
 await check('Browser runtime is active and native encoder behavior is recorded',async()=>{const type=await page.evaluate(()=>new Promise(resolve=>document.createElement('canvas').toBlob(b=>resolve(b?.type),'image/webp')));console.log('Native WebP result:',type);assert(type==='image/webp'||type==='image/png');});
 // Exercise failure regardless of platform updates to native WebP support.
 await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){return original.call(this,callback,type==='image/webp'?'image/png':type,quality);};});
 await check('Pending photo locks implicit submit, editor actions and closing; draft edits survive',async()=>{
  let start,release;const started=new Promise(r=>start=r);hold={started:start,promise:new Promise(r=>release=r)};
  await page.locator('[name=description]').fill('Original photo fallback draft');await page.locator('#product-photos').setInputFiles({name:'phone.png',mimeType:'image/png',buffer:png});await started;
  assert(await page.locator('[data-form=product] [type=submit]').isDisabled());assert(await page.locator('[data-action=add-group]').isDisabled());assert(await page.locator('#dialog-close').isDisabled());
  await page.evaluate(()=>document.querySelector('[data-form=product]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(saves,0);
  await page.locator('[name=description]').fill('Draft changed during upload');release();await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===1||document.querySelector('#product-photo-status')?.textContent.includes('was not uploaded'));assert.equal(await page.locator('#product-photo-status').innerText(),'');assert.equal(await page.locator('[name=description]').inputValue(),'Draft changed during upload');
  assert.equal(uploads[0].mime,'image/png');assert.deepEqual(uploads[0].bytes,png);
 });
 await check('PNG, JPEG and real HEIC originals reach storage byte-for-byte with correct types and extensions',async()=>{
  await page.locator('#product-photos').setInputFiles([{name:'phone.jpeg',mimeType:'image/jpeg',buffer:jpeg},{name:'phone.HEIC',mimeType:'application/octet-stream',buffer:heic}]);await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===3,null,{timeout:90000});
  assert.deepEqual(uploads.map(x=>x.mime),['image/png','image/jpeg','image/heic']);assert.deepEqual(uploads[1].bytes,jpeg);assert.deepEqual(uploads[2].bytes,heic);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.photo-tile img')).every(img=>img.complete&&img.naturalWidth>0),null,{timeout:90000});
 });
 await check('Network failure is visible beside photos and cannot silently save; retry succeeds',async()=>{
  failUpload=true;await page.locator('#product-photos').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:png});await page.locator('#product-photo-status').filter({hasText:/was not uploaded/}).waitFor();
  await page.locator('[data-form=product] [type=submit]').click();assert.equal(saves,0);await page.locator('[data-form=product]>.form-error').filter({hasText:/A photo has not uploaded/}).waitFor();
  await page.locator('#product-photos').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>document.querySelectorAll('.photo-tile').length===4);assert.equal(await page.locator('#product-photo-status').innerText(),'');
 });
 await check('Saved photo references survive reopening and a full browser refresh',async()=>{
  await page.locator('[data-form=product] [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#admin-dialog').open);assert.equal(saves,1);
  await page.reload();await selectDashboardSection(page,'products');await page.locator(`[data-action=edit-product][data-id="${product.id}"]`).click();assert.equal(await page.locator('.photo-tile').count(),4);assert.equal(await page.locator('[name=description]').inputValue(),'Draft changed during upload');
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.photo-tile img')).every(img=>img.complete&&img.naturalWidth>0),null,{timeout:90000});await page.locator('#product-photo-order').screenshot({path:out+'/saved-original-photos.png'});
 });
 await check('Corrupt and renamed image files are still rejected and can be explicitly skipped',async()=>{
  await page.locator('#product-photos').setInputFiles({name:'bad.heic',mimeType:'image/heic',buffer:Buffer.from('<svg/>')});await page.locator('#product-photo-status').filter({hasText:/was not uploaded/}).waitFor({timeout:30000});assert.equal(uploads.length,4);await page.getByRole('button',{name:'Continue without the failed photo',exact:true}).click();assert.equal(await page.locator('#product-photo-status').innerText(),'');
 });
 await check('HEIC payment receipt keeps its private order-owned path and authorized proof status',async()=>{
  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){return original.call(this,callback,type==='image/webp'?'image/png':type,quality);};});
  const initial=await h.api('admin_bootstrap',{},h.ids.owner);await h.api('save_settings',{settings:{...initial.settings,paused:false,pickup_address:'Fixture',payment_instructions:'Fixture only',owner_email:'owner@example.test',contact_email:'owner@example.test',site_url:origin}},h.ids.owner);
  const fixture=await h.fixture(),order=await h.api('create_order',h.checkout(fixture.product,fixture.date));
  const result=await page.evaluate(async({bytes,id,token})=>{const {upload}=await import('/assets/ordering/client.js');return upload(new File([Uint8Array.from(bytes)],'receipt.heic',{type:'image/heic'}),{kind:'proof',order_id:id,token});},{bytes:[...heic],id:order.id,token:order.access_token});
  assert.equal(result.order.payment_status,'under_review');assert.match((await db.query('select proof_path from tlb.orders where id=$1',[order.id])).rows[0].proof_path,/\.heic$/);assert(uploads.at(-1).path.startsWith('payment-proofs/'+order.id+'/'));assert.deepEqual(uploads.at(-1).bytes,heic);
 });
 assert.deepEqual(t.errors,[]);await context.close();
}catch(error){console.log(await currentPage?.evaluate(()=>({photoStatus:document.querySelector('#product-photo-status')?.textContent,previewError:window.heicPreviewError,photos:Array.from(document.querySelectorAll('.photo-tile img')).map(i=>({src:i.src,loaded:i.complete,width:i.naturalWidth}))})));throw error;}finally{globalThis.fetch=oldFetch;await writeFile(out+'/results.json',JSON.stringify({engine,checks,errors:t.errors},null,2));await t.close();}
