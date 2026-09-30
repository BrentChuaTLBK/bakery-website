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
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/artifacts/recipe-workflow'),origin='https://recipes.test';await mkdir(out,{recursive:true});
const db=new PGlite({extensions:{pgcrypto}});await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));
for(const file of(await readdir(join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(join(root,'supabase/migrations',file),'utf8'));
const h=await makeHarness(db);let queue=Promise.resolve();
let rejectSave=false;
function api(user,action,payload={}){if(rejectSave&&action==='save'){rejectSave=false;return Promise.reject(Error('QA save interrupted'));}const run=()=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);queue=queue.then(run,run);return queue;}
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
const {blankRecipe,freshVariant}=await import('../../assets/ordering/recipe-model.js');
const doc=blankRecipe();doc.name='QA compact celebration cake';doc.description='A multi-component kitchen recipe.';doc.allergens=['Milk','Eggs'];doc.critical_notes='Keep mousse chilled until assembly.';doc.private_notes='OWNER ONLY';
const v=doc.variants[0];v.yield={quantity:'2',unit:'cakes',portions:'16',portion_weight:'90',pan_size:'7 inch'};
v.groups=['Sponge','Mousse','Glaze'].map((name,g)=>({id:`group-${g}`,name,ingredients:['Flour','Sugar','Egg yolks','Milk','Butter','Salt','Vanilla','Water'].map((name,i)=>({id:`g${g}-i${i}`,name,quantity:String(100+i*10+g),unit:'g'}))}));
v.methods=v.groups.map((g,gi)=>({id:`method-${gi}`,group_id:g.id,name:g.name+' method',steps:Array.from({length:8},(_,i)=>({id:`m${gi}-s${i}`,instruction:`Step ${i+1}: combine the ingredients gently, checking the texture before continuing.`,timer_minutes:i===3?'5':''}))}));
v.methods.push({id:'assembly',group_id:'',name:'Assembly',steps:[{id:'assemble',instruction:'Layer sponge and mousse, chill, then glaze.'}]});v.baking=[{name:'Bake sponge',top:'180',minutes:'25'}];v.packaging.description='Use a 7 inch cake box';
doc.variants.push(freshVariant(v));doc.variants[1].name='Small';
let saved=await api(h.ids.owner,'create',{document:doc,status:'draft'});
await api(h.ids.owner,'save_access',{user_id:h.ids.customer,permission:'chef'});
async function save(page){await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#recipe-editor')?.inert===false&&document.querySelector('[data-save-status]')?.textContent.startsWith('Saved.'));}
async function open(page){await page.goto(origin+'/recipes.html');await page.getByRole('button',{name:'Open recipe',exact:true}).click();}
async function status(page,value){await page.locator('[data-recipe-status]').selectOption(value);await page.getByRole('button',{name:'Set status',exact:true}).click();await page.waitForFunction(value=>document.querySelector('.recipe-toolbar .recipe-badge')?.classList.contains(value),value);}
try{
 const {page,context}=await pageFor(h.ids.owner);await page.goto(origin+'/recipes.html');await page.locator('[data-filter=status]').waitFor();
 assert.deepEqual(await page.locator('[data-filter=status] option').allTextContents(),['Active recipes','Draft','Final','Hidden','Archive']);
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('[data-editor-variant]').selectOption('1');
 assert.deepEqual(await page.locator('#recipe-save-status option').allTextContents(),['Draft','Final','Hidden','Archive']);
 await fill(page,'variants.1.groups.0.ingredients.0.quantity','201');await save(page);
 assert.equal(await page.locator('#recipe-dialog').isVisible(),false);assert.equal(await page.locator('[data-editor-variant]').inputValue(),'1');
 assert.equal(await page.locator('#recipe-editor').isVisible(),true);assert.equal(await page.getByRole('button',{name:'Edit recipe',exact:true}).count(),0);
 await fill(page,'variants.1.groups.0.ingredients.0.quantity','202');await save(page);
 saved=await api(h.ids.owner,'get',{id:saved.id});assert.equal(saved.version,3);assert.equal(saved.document.variants[1].groups[0].ingredients[0].quantity,'202');
 results.push('One-click Save keeps the editor and selected size open across repeated saves; library Edit skips the reader');
 await fill(page,'variants.1.groups.0.ingredients.0.quantity','203');rejectSave=true;await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('QA save interrupted',{exact:true}).waitFor();
 assert.equal(await page.locator('#recipe-editor').evaluate(el=>el.inert),false);assert.equal(await page.locator('[data-path="variants.1.groups.0.ingredients.0.quantity"]').inputValue(),'203');assert.equal((await api(h.ids.owner,'get',{id:saved.id})).version,3);await save(page);
 results.push('A failed save leaves entered changes available for an immediate retry');
 await page.getByRole('button',{name:'View saved recipe',exact:true}).click();await status(page,'production');saved=await api(h.ids.owner,'get',{id:saved.id});assert.equal(saved.status,'production');assert.equal((await api(h.ids.staff,'get',{id:saved.id})).version_id,saved.version_id);
 assert.equal(await page.locator('#recipe-editor').count(),0);assert.equal(await page.locator('#recipe-dialog').isVisible(),false);
 results.push('Draft becomes Final directly from the reader without reopening the editor or a confirmation dialog');
 await page.locator('[data-scale=target]').fill('3');await page.locator('[data-scale=target]').press('Tab');
 assert.deepEqual(await page.locator('.recipe-component-view').first().locator('thead th').allTextContents(),['Ingredient','Quantity needed']);assert.equal(await page.locator('.recipe-component-view').first().locator('tbody td.numeric').first().innerText(),'609 g');assert.doesNotMatch(await page.locator('.recipe-yield').innerText(),/Base|base portions/);
 await page.locator('[data-scale=target]').fill('bad');await page.locator('[data-scale=target]').press('Tab');assert.equal(await page.locator('.recipe-component-view:visible').count(),0);assert.equal(await page.getByRole('button',{name:'Print / PDF',exact:true}).isDisabled(),true);
 results.push('The reader shows a single scaled quantity; invalid input hides quantities instead of reverting to base amounts');
 await page.locator('[data-scale=target]').fill('1');await page.locator('[data-scale=target]').press('Tab');
 await status(page,'hidden');assert.equal((await api(h.ids.staff,'list')).total,0);await status(page,'archived');await page.getByRole('button',{name:'Library',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Open recipe',exact:true}).count(),0);await page.locator('[data-filter=status]').selectOption('archived');await page.getByRole('button',{name:'Open recipe',exact:true}).click();await status(page,'production');
 results.push('Hidden removes kitchen access, Archive leaves the active library, and Final restores access from the Archive filter');
 await page.goto(origin+'/recipes.html?view=kitchen');await page.getByRole('button',{name:'Open recipe',exact:true}).click();
 assert.equal(await page.getByRole('link',{name:'Back to recipe admin',exact:true}).getAttribute('href'),'recipes.html');assert.equal(await page.getByRole('link',{name:'Admin dashboard',exact:true}).getAttribute('href'),'manage.html');
 await page.getByRole('link',{name:'Back to recipe admin',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).waitFor();await context.close();
 results.push('Owner kitchen view has working recipe-admin and dashboard navigation');
 for(const width of [1440,820,390,320]){
  const {page,context}=await pageFor(h.ids.staff,width);await page.goto(origin+'/recipes.html?view=kitchen');await page.getByRole('button',{name:'Open recipe',exact:true}).click();await page.locator('[data-kitchen-section]').waitFor();
  assert.equal(await page.getByRole('link',{name:/admin/i}).count(),0);assert.equal(await page.locator('[data-recipe-status]').count(),0);assert.equal(await page.getByRole('button',{name:'Edit recipe',exact:true}).count(),0);
  assert.equal(await page.locator('[data-kitchen-panel]:visible').count(),1);assert.equal(await page.locator('[data-kitchen-section] option').count(),6);
  assert.equal(await page.locator('.recipe-allergens').isVisible(),true);assert.equal(await page.getByText('Keep mousse chilled until assembly.',{exact:true}).isVisible(),true);
  assert.equal(await page.locator('body').innerText().then(t=>t.includes('OWNER ONLY')),false);
  const first=page.locator('[data-check="g0-i0"]');await first.check();
  await page.locator('[data-kitchen-section]').selectOption('component:group-1');await page.locator('.recipe-kitchen-production>summary').click();assert.equal(await page.locator('[data-kitchen-panel]:visible').count(),1);
  await page.locator('[data-scale=target]').fill('2');await page.locator('[data-scale=target]').press('Tab');assert.equal(await page.locator('[data-kitchen-section]').inputValue(),'component:group-1');assert.equal(await page.locator('[data-kitchen-panel]:visible tbody td.numeric').first().innerText(),'202 g');
  await page.locator('[data-scale=target]').fill('1');await page.locator('[data-scale=target]').press('Tab');await page.locator('[data-kitchen-section]').selectOption('component:group-0');assert.equal(await page.locator('[data-check="g0-i0"]').isChecked(),true);
  if(width<=700){assert.equal(await page.locator('.recipe-kitchen-methods:visible').count(),0);await page.getByRole('button',{name:'Method',exact:true}).click();assert.equal(await page.locator('.recipe-kitchen-ingredients:visible').count(),0);assert.equal(await page.locator('.recipe-kitchen-methods:visible').count(),1);await page.getByRole('button',{name:'Ingredients',exact:true}).click();}
  else assert.equal(await page.locator('.recipe-kitchen-methods:visible').count(),1);
  await page.locator('.recipe-kitchen-production>summary').click();if(width<=700){await page.setViewportSize({width,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(out,`compact-diagnostic-${width}.png`),fullPage:true});assert.ok((await page.locator('[data-kitchen-panel]:visible tbody tr').first().boundingBox()).y<800);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('#recipe-notice').textContent='';});await page.screenshot({path:join(out,`kitchen-${width}.png`),fullPage:true});
  if(width===390){await page.getByRole('button',{name:'Method',exact:true}).click();await page.screenshot({path:join(out,'kitchen-method-390.png'),fullPage:true});}
  await page.locator('[data-kitchen-section]').selectOption('method:assembly');assert.equal(await page.getByText('Layer sponge and mousse, chill, then glaze.',{exact:false}).isVisible(),true);
  await page.locator('[data-kitchen-section]').selectOption('baking');assert.match(await page.locator('[data-kitchen-panel]:visible').innerText(),/180/);await page.locator('[data-kitchen-section]').selectOption('packaging');assert.match(await page.locator('[data-kitchen-panel]:visible').innerText(),/7 inch cake box/);
  if(width===820){await page.evaluate(()=>{window.print=()=>window.printReady=true;});await page.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.getByRole('button',{name:'Prepare printable recipe',exact:true}).click();await page.waitForFunction(()=>window.printReady===true);assert.equal(await page.locator('.recipe-print-root [data-print-component]').count(),6);assert.match(await page.locator('.recipe-print-root').innerText(),/Assembly/);await page.emulateMedia({media:'print'});await page.pdf({path:join(out,'full-kitchen-recipe.pdf'),preferCSSPageSize:true,printBackground:true});}
  await context.close();results.push(`Kitchen ${width}px: one section, scaled quantities, retained checkoffs, reachable method/assembly/packaging, no overflow or admin access`);
 }
 const childDoc=blankRecipe();childDoc.name='QA linked filling';childDoc.variants[0].yield={quantity:'1000',unit:'g'};childDoc.variants[0].groups[0].ingredients=[{id:'filling-sugar',name:'Filling sugar',quantity:'200',unit:'g'}];childDoc.variants[0].methods[0].steps[0].instruction='Whisk the filling.';
 const child=await api(h.ids.owner,'create',{document:childDoc,status:'final'}),parentDoc=blankRecipe();parentDoc.name='QA linked quantity';parentDoc.variants[0].groups=[];parentDoc.variants[0].methods=[];parentDoc.variants[0].components=[{id:'filling-link',name:childDoc.name,version_id:child.version_id,variant_id:childDoc.variants[0].id,quantity:'250',unit:'g',mode:'pinned'}];
 await api(h.ids.owner,'create',{document:parentDoc,status:'final'});const linked=await pageFor(h.ids.staff);await linked.page.goto(origin+'/recipes.html?view=kitchen');await linked.page.locator('.recipe-card').filter({has:linked.page.getByRole('heading',{name:'QA linked quantity',exact:true})}).getByRole('button',{name:'Open recipe',exact:true}).click();await linked.page.locator('.recipe-kitchen-production>summary').click();await linked.page.locator('[data-scale=target]').fill('2');await linked.page.locator('[data-scale=target]').press('Tab');await linked.page.getByRole('button',{name:'View',exact:true}).click();assert.match(await linked.page.locator('#recipe-dialog-body').innerText(),/Prepare 500 g/);assert.equal(await linked.page.locator('#recipe-dialog-body td.numeric').innerText(),'100 g');assert.match(await linked.page.locator('#recipe-dialog-body').innerText(),/Whisk the filling/);await linked.context.close();results.push('Linked component detail uses the selected size and production amount instead of its base formula');
 const chef=await pageFor(h.ids.customer);await chef.page.goto(origin+'/recipes.html?view=kitchen');await chef.page.getByRole('link',{name:'Back to recipe admin',exact:true}).waitFor();assert.equal(await chef.page.getByRole('link',{name:'Admin dashboard',exact:true}).count(),0);await chef.page.getByRole('link',{name:'Back to recipe admin',exact:true}).click();await chef.page.getByRole('button',{name:'Edit',exact:true}).first().click();assert.deepEqual(await chef.page.locator('#recipe-save-status option').allTextContents(),['Draft']);await chef.context.close();results.push('Chef can return to recipe editing while owner-only status controls stay protected');
 assert.deepEqual(errors,[]);console.log(results.map(r=>'PASS '+r).join('\n'));
}finally{await browser.close();await db.close();await writeFile(join(out,'results.json'),JSON.stringify({results,errors},null,2));}
