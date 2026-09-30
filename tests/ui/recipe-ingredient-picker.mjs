async function saveAndView(page){
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#recipe-editor')?.inert===false&&document.querySelector('[data-save-status]')?.textContent.startsWith('Saved.'));
 await page.getByRole('button',{name:'View saved recipe',exact:true}).click();
 await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();
}
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const dbRequire=createRequire(join(resolve(process.env.PGLITE_PACKAGE_ROOT||'../newsletter-test-deps'),'package.json'));
const {PGlite}=dbRequire('@electric-sql/pglite'),{pgcrypto}=dbRequire('@electric-sql/pglite/contrib/pgcrypto');
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/artifacts/recipe-ingredient-picker'),origin='https://recipes.test';await mkdir(out,{recursive:true});
const db=new PGlite({extensions:{pgcrypto}});await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));
for(const file of(await readdir(join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(join(root,'supabase/migrations',file),'utf8'));
const h=await makeHarness(db);let queue=Promise.resolve();
function api(user,action,payload={}){const run=()=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);queue=queue.then(run,run);return queue;}
await api(h.ids.owner,'save_access',{user_id:h.ids.staff,permission:'kitchen'});
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.wasm':'application/wasm','.traineddata':'application/octet-stream'};
const errors=[],results=[],files=new Map();
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
async function pageFor(user,width=1440){
 const context=await browser.newContext({viewport:{width,height:1000}});await context.exposeFunction('recipeTestApi',(action,payload)=>api(user,action,payload));
 await context.exposeFunction('recipeTestBackup',(action,payload={})=>{const run=()=>h.as(user,async()=>(await db.query('select public.recipe_backup_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);queue=queue.then(run,run);return queue;});
 await context.exposeFunction('recipeTestUpload',async({name,type,bytes})=>{const buffer=Buffer.from(bytes),file=await api(user,'reserve_file',{filename:name,mime_type:type,size_bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')});await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:buffer.length,mimetype:type})]);files.set(file.path,{bytes:buffer,type});await api(user,'confirm_file',{id:file.id});return file;});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:`export const ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:${JSON.stringify(user)}}}}})};export const recipeApi=(action,payload={})=>window.recipeTestApi(action,payload);export const recipeFileUrl=async path=>'/__files/'+path;export const uploadRecipeFile=async file=>window.recipeTestUpload({name:file.name,type:file.type,bytes:[...new Uint8Array(await file.arrayBuffer())]});export const recipeBackupApi=(action,payload={})=>window.recipeTestBackup(action,payload);export const recipeBackupConnection=async()=>({});export const recipeBackupDownload=async()=>new Blob();`});
  if(u.pathname.startsWith('/__files/')){const file=files.get(u.pathname.slice(9));return file?route.fulfill({body:file.bytes,contentType:file.type}):route.fulfill({status:404});}
  const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(file),contentType:mime[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());return {page,context};
}
const fill=(page,path,value)=>page.locator(`[data-path="${path}"]`).fill(value);
const supplier=await api(h.ids.owner,'save_resource',{kind:'supplier',name:'QA ingredient supplier',data:{}});
let flour=await api(h.ids.owner,'save_resource',{kind:'ingredient',name:'QA Flour',data:{default_unit:'g',brand:'Pastry Brand'},price:{amount:'120',quantity:'1',unit:'kg',supplier_id:supplier.id}});
await api(h.ids.owner,'save_resource',{kind:'ingredient',name:'QA Flour',data:{default_unit:'g',brand:'Bread Brand'},price:{amount:'150',quantity:'1',unit:'kg'}});
await api(h.ids.owner,'save_resource',{kind:'ingredient',name:'QA Cream without price',data:{default_unit:'ml'}});
try{
 const {page,context}=await pageFor(h.ids.owner);await page.goto(origin+'/recipes.html');await page.getByRole('button',{name:'+ New recipe',exact:true}).click();await fill(page,'name','QA linked ingredient cake');await fill(page,'variants.0.methods.0.steps.0.instruction','Mix together.');
 const ingredient=page.locator('[data-ingredient-search]').first(),row=page.locator('[data-ingredient-row]').first(),amount=row.locator('[data-path$=".quantity"]'),unit=row.locator('[data-path$=".unit"]');
 await ingredient.fill('QA Flour');await page.getByRole('option').filter({hasText:'Pastry Brand'}).waitFor();assert.equal(await page.locator('[data-ingredient-choice]').count(),2);await page.getByRole('option').filter({hasText:'Pastry Brand'}).click();assert.equal(await ingredient.inputValue(),'QA Flour');assert.equal(await unit.inputValue(),'g');assert.equal(await amount.evaluate(el=>el===document.activeElement),true);assert.match(await row.locator('[data-ingredient-link]').innerText(),/Pastry Brand.*Linked.*0\.12/);
 assert.equal(await page.locator('[data-path$=".percentage"],[data-path$=".rounding_step"],[data-path*=".cost_snapshot."]').count(),0);await amount.fill('500');
 await page.locator('#recipe-save-status').selectOption('production');await saveAndView(page);await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();
 const saved=(await api(h.ids.owner,'list',{query:'QA linked ingredient cake'})).rows[0],first=await api(h.ids.owner,'get',{id:saved.id});assert.equal(first.document.variants[0].groups[0].ingredients[0].ingredient_id,flour.id);assert.equal(Number(first.cost_snapshot.variants[0].total),60);results.push('Explicit ingredient selection distinguishes brands, fills the unit, links costing and saves the correct supplier price');
 flour=await api(h.ids.owner,'save_resource',{id:flour.id,revision:flour.revision,kind:'ingredient',name:flour.name,data:flour.data,price:{amount:'200',quantity:'1',unit:'kg',supplier_id:supplier.id}});
 await page.getByRole('button',{name:'Edit recipe',exact:true}).click();await page.locator('#recipe-save-status').selectOption('draft');await saveAndView(page);await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();
 assert.equal(Number((await api(h.ids.owner,'get',{id:saved.id})).cost_snapshot.variants[0].total),100);assert.equal(Number((await api(h.ids.owner,'get',{id:saved.id,version_id:first.version_id})).cost_snapshot.variants[0].total),60);results.push('Saving refreshes linked ingredient prices while historical recipe costs remain unchanged');
 await page.getByRole('button',{name:'Edit recipe',exact:true}).click();await ingredient.fill('QA Cream');await page.getByRole('option',{name:/QA Cream without price/}).waitFor();assert.match(await row.locator('[data-ingredient-link]').innerText(),/Select from Ingredients/);await ingredient.press('ArrowDown');await ingredient.press('Enter');assert.match(await row.locator('[data-ingredient-link]').innerText(),/Price not set/);assert.equal(await unit.inputValue(),'g');assert.equal(await amount.inputValue(),'500');
 await page.getByRole('button',{name:'View cost summary',exact:true}).click();assert.match(await page.locator('#recipe-dialog-body').innerText(),/Partial cost/);assert.match(await page.locator('#recipe-dialog-body').innerText(),/Price not entered/);await page.locator('[data-dialog-close]').click();results.push('Typing clears the old link; keyboard selection of an unpriced ingredient never reuses the previous ingredient price');
 await unit.fill('kg');await amount.fill('½');await ingredient.fill('QA Flour');await page.getByRole('option').filter({hasText:'Pastry Brand'}).click();assert.equal(await amount.inputValue(),'500');assert.equal(await unit.inputValue(),'g');results.push('Linking imported fractions converts kg to g without changing the amount');
 for(const width of [1440,820,390]){await page.setViewportSize({width,height:1000});await ingredient.fill('QA Flour');await page.getByRole('option').filter({hasText:'Pastry Brand'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>document.querySelector('[data-ingredient-row]').scrollIntoView({block:'start'}));await page.screenshot({path:join(out,`picker-${width}.png`)});await page.getByRole('option').filter({hasText:'Pastry Brand'}).click();}
 results.push('Search, selection and compact ingredient rows fit desktop, tablet and phone');
 await ingredient.fill('No ingredient with this name');await page.getByText('No matching ingredients. Add it in Ingredients to link its cost.',{exact:true}).waitFor();await amount.click();assert.equal(await ingredient.getAttribute('aria-expanded'),'false');await context.close();
 // Exercise response ordering and network errors against the real picker module.
 const race=await pageFor(h.ids.owner);await race.page.goto(origin+'/recipes.html');await race.page.getByRole('button',{name:'+ New recipe',exact:true}).waitFor();
 await race.page.evaluate(async()=>{const {ingredientPickerMarkup,mountIngredientPicker}=await import('/assets/ordering/recipe-ingredient-picker.js?v=components-2');const row={id:'race',name:'',quantity:'',unit:'g'},host=document.createElement('div');host.id='picker-race';host.className='recipe-ingredient-editor';host.dataset.ingredientRow='0';host.innerHTML=ingredientPickerMarkup(row,'race')+'<input data-path="race.quantity"><input data-path="race.unit">';document.body.append(host);window.pickerCalls=[];mountIngredientPicker(host,{getRow:()=>row,onChange:()=>{},api:async(action,{query})=>{window.pickerCalls.push(query);await new Promise(r=>setTimeout(r,query==='slow'?600:20));if(query==='offline')throw Error('Offline');return {rows:[{id:query,name:query,data:{default_unit:'g'}}]};}});});
 const raceInput=race.page.locator('#picker-race [data-ingredient-search]');await raceInput.fill('slow');await race.page.waitForFunction(()=>window.pickerCalls.includes('slow'));await raceInput.fill('current');await race.page.getByRole('option',{name:/current/}).waitFor();await race.page.waitForTimeout(650);assert.equal(await race.page.getByRole('option',{name:/slow/}).count(),0);await raceInput.fill('offline');await race.page.getByText('Ingredient list could not load. Type again to retry.',{exact:true}).waitFor();await raceInput.fill('retry');await race.page.getByRole('option',{name:/retry/}).waitFor();await race.context.close();results.push('Late search responses cannot replace current suggestions, and a failed search can be retried');
 assert.deepEqual(errors,[]);console.log(results.map(r=>'PASS '+r).join('\n'));
}finally{await browser.close();await db.close();await writeFile(join(out,'results.json'),JSON.stringify({results,errors},null,2));}
