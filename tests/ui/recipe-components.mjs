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
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/artifacts',process.env.RECIPE_COMPONENT_ARTIFACTS||'recipe-components'),origin='https://recipes.test';await mkdir(out,{recursive:true});
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
const fill=async(page,path,value)=>{const el=page.locator(`[data-path="${path}"]`);return await el.evaluate(n=>n.tagName)==='SELECT'?el.selectOption(value):el.fill(value);};
const synthetic='QA Layer Cake\nSponge\nFlour 100 g\nSugar 25 g\nProcedure\n1. Mix and bake the sponge.\nMousse\nCream 200 g\nSugar 10 g\nProcedure\n1. Whip the cream.\nGlaze\nWater 50 ml\nGelatin 1 g\nProcedure\n1. Bloom and dissolve.\nAssembly\n1. Layer and glaze the cake.';
const sample=process.env.RECIPE_COMPONENT_SAMPLE_PDF;
try{
 const {page,context}=await pageFor(h.ids.owner);await page.goto(origin+'/recipes.html');await page.getByRole('button',{name:'Import recipe',exact:true}).click();
 if(sample){await page.locator('#recipe-import-form [name=source]').setInputFiles(sample);await page.getByText('Text extracted. Check it before creating the review draft.',{exact:true}).waitFor();}
 else await page.locator('#recipe-import-form [name=source_text]').fill(synthetic);
 const extracted=await page.locator('#recipe-import-form [name=source_text]').inputValue();
 await page.getByRole('button',{name:'Review draft',exact:true}).click();await page.locator('#recipe-editor').waitFor();
 const cards=page.locator('[data-component-editor]');assert.equal(await cards.count(),3);assert.equal(await page.locator('[data-ingredient-row]').count(),sample?22:6);
 const names=await cards.locator('[data-path$=".name"]').evaluateAll(nodes=>nodes.filter(n=>/groups\.\d+\.name$/.test(n.dataset.path)).map(n=>n.value));
 const instructions=await cards.locator('.recipe-procedure-editor textarea').evaluateAll(nodes=>nodes.map(n=>n.value));
 assert.deepEqual(await cards.evaluateAll(nodes=>nodes.map(n=>n.querySelectorAll('.recipe-step-editor').length)),sample?[8,6,5]:[1,1,1]);
 assert.equal(await page.locator('.recipe-assembly-editor .recipe-step-editor').count(),sample?14:1);
 assert.equal(await page.locator('[data-path$=".timer_minutes"],[data-path$=".temperature"],[data-path$=".warning"],[data-path$=".equipment"]').count(),0);
 results.push('Import through the review screen: three ingredient/procedure pairs, assembly last, simple step inputs');
 await fill(page,'variants.0.groups.0.name','QA renamed sponge');assert.equal(await cards.first().locator('[data-component-heading]').innerText(),'QA renamed sponge');
 await cards.first().getByRole('button',{name:'Move component down',exact:true}).click();
 assert.equal(await cards.nth(1).locator('textarea').first().inputValue(),instructions[0]);
 await cards.nth(1).getByRole('button',{name:'Move component up',exact:true}).click();await fill(page,'variants.0.groups.0.name',names[0]);
 await page.getByRole('button',{name:'+ Component',exact:true}).first().click();assert.equal(await cards.count(),4);
 assert.match(await page.evaluate(()=>document.activeElement.dataset.path),/groups\.3\.name$/);assert.equal(await cards.last().locator('.recipe-step-editor').count(),1);
 await cards.last().getByRole('button',{name:/Remove component/}).click();await page.getByRole('button',{name:'Remove component',exact:true}).click();assert.equal(await cards.count(),3);assert.equal(await page.locator('.recipe-assembly-editor .recipe-step-editor').count(),sample?14:1);
 results.push('Rename, move, add and remove components while retaining their own procedures and final assembly');
 for(const width of [1440,820,390]){await page.setViewportSize({width,height:1000});await cards.first().locator('.recipe-procedure-options summary').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await cards.first().locator('.recipe-procedure-options summary').click();await cards.first().scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`editor-${width}.png`)});}
 results.push('Component editor and expanded procedure options fit desktop, tablet and phone');
 await page.setViewportSize({width:1440,height:1000});await fill(page,'name','QA browser component cake');await fill(page,'variants.0.yield.quantity','1');await fill(page,'variants.0.yield.unit','cake');
 await page.locator('[data-import-reviewed]').check();await page.locator('#recipe-save-status').selectOption('production');await saveAndView(page);await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();
 const saved=(await api(h.ids.owner,'list',{query:'QA browser component cake'})).rows[0],record=await api(h.ids.owner,'get',{id:saved.id});
 assert.equal(record.document.variants[0].groups.length,3);assert.equal(record.document.variants[0].methods[0].group_id,record.document.variants[0].groups[0].id);
 results.push('Reviewed import saves and publishes all component links through the real database API');
 for(const [layout,paper]of [['kitchen','A4'],['presentation','Letter']]){
  await page.evaluate(()=>{window.print=()=>{window.printReady=true;};window.printReady=false;});await page.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.locator('[name=layout]').selectOption(layout);await page.locator('[name=paper]').selectOption(paper);await page.locator('[name=notes]').uncheck();await page.getByRole('button',{name:'Prepare printable recipe',exact:true}).click();await page.waitForFunction(()=>window.printReady===true);
  const printed=page.locator('.recipe-print-root');assert.equal(await printed.locator('.recipe-print-group').count(),3);assert.equal(await printed.locator('.recipe-print-group').first().locator('li').count(),sample?8:1);assert.equal(await printed.locator('.recipe-print-method li').count(),sample?14:1);
  assert.deepEqual(await printed.locator('.recipe-print-group').evaluateAll(nodes=>nodes.map(n=>[...n.children].map(c=>c.tagName))),[['H3','TABLE','H4','OL'],['H3','TABLE','H4','OL'],['H3','TABLE','H4','OL']]);
  await page.emulateMedia({media:'print'});await page.pdf({path:join(out,`${layout}-${paper}.pdf`),preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});
  results.push(`${layout} ${paper} export has paired components followed by assembly`);
 }
 await page.getByRole('button',{name:'Edit recipe',exact:true}).click();await page.getByRole('button',{name:'Duplicate size',exact:true}).click();assert.equal(await page.locator('[data-editor-variant] option').count(),2);assert.equal(await cards.count(),3);
 await page.locator('#recipe-save-status').selectOption('draft');await saveAndView(page);await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();
 const copied=await api(h.ids.owner,'get',{id:saved.id}),v=copied.document.variants[1];assert.notEqual(v.groups[0].id,record.document.variants[0].groups[0].id);for(const m of v.methods)if(m.group_id)assert(v.groups.some(g=>g.id===m.group_id));assert.equal((await api(h.ids.staff,'get',{id:saved.id})).version_id,record.version_id);
 results.push('Duplicating a size remaps component links and leaves the approved version intact');
 await context.close();
 for(const width of [390,820,1440]){
  const {page,context}=await pageFor(h.ids.staff,width);await page.goto(origin+'/recipes.html?view=kitchen');await page.getByRole('button',{name:'Open recipe',exact:true}).click();await page.locator('[data-component-view]').first().waitFor();assert.equal(await page.locator('[data-component-view]').count(),3);
  assert.equal(await page.locator('[data-component-view]').first().locator('.recipe-method-step').count(),sample?8:1);assert.equal(await page.locator('.recipe-overall-procedure .recipe-method-step').count(),sample?14:1);
  assert.equal(await page.getByRole('button',{name:'Edit recipe',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'Private source files',exact:true}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.recipe-kitchen-production>summary').click();const firstQuantity=await page.locator('[data-component-view] tbody tr').first().locator('td').last().innerText();await page.locator('[data-scale=target]').fill('2');await page.locator('[data-scale=target]').press('Tab');assert.notEqual(await page.locator('[data-component-view] tbody tr').first().locator('td').last().innerText(),firstQuantity);
  await page.screenshot({path:join(out,`kitchen-${width}.png`),fullPage:true});await context.close();results.push(`Kitchen ${width}px: paired sections, final assembly, scaling, no overflow or private source`);
 }
 assert.deepEqual((await api(h.ids.owner,'get',{id:saved.id,version_id:record.version_id})).document,record.document);
 const {parseRecipeText}=await import('../../assets/ordering/recipe-import.js');const older=parseRecipeText(extracted).document;older.name='QA older import';older.import_review.reviewed=true;older.private_notes='Keep this owner note';older.variants[0].yield.quantity='3';older.variants[0].groups.splice(1);older.variants[0].methods=[{id:'old-method',name:'Combined procedure',steps:[{id:'old-step',instruction:'Older imported procedure.'}]}];
 const old=await api(h.ids.owner,'create',{document:older,status:'production'}),recovery=await pageFor(h.ids.owner);await recovery.page.goto(origin+'/recipes.html');await recovery.page.locator('.recipe-card').filter({has:recovery.page.getByRole('heading',{name:'QA older import',exact:true})}).getByRole('button',{name:'Open recipe',exact:true}).click();await recovery.page.getByRole('button',{name:'Edit recipe',exact:true}).click();
 await recovery.page.getByRole('button',{name:'Rebuild components from original import',exact:true}).click();await recovery.page.getByRole('button',{name:'Rebuild draft',exact:true}).click();await recovery.page.locator('[data-component-editor]').nth(2).waitFor();assert.equal(await recovery.page.locator('[data-component-editor]').count(),3);assert.equal(await recovery.page.locator('[data-import-reviewed]').isChecked(),false);assert.equal((await api(h.ids.owner,'get',{id:old.id})).document.variants[0].groups.length,1);assert.equal(await recovery.page.locator('[data-path="variants.0.yield.quantity"]').inputValue(),'3');
 await recovery.page.locator('[data-import-reviewed]').check();await recovery.page.locator('#recipe-save-status').selectOption('draft');await saveAndView(recovery.page);await recovery.page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();assert.equal((await api(h.ids.owner,'get',{id:old.id})).document.variants[0].groups.length,3);assert.equal((await api(h.ids.staff,'get',{id:old.id})).document.variants[0].groups.length,1);assert.equal((await api(h.ids.owner,'get',{id:old.id})).document.private_notes,'Keep this owner note');await recovery.context.close();
 results.push('Older-import rebuild requires explicit review/save and preserves yield, notes and the approved recipe');
 const legacy=parseRecipeText(synthetic).document;legacy.name='QA legacy names';legacy.import_review.reviewed=true;legacy.variants[0].methods.forEach((m,i)=>{delete m.group_id;if(i<3)m.name=legacy.variants[0].groups[i].name+' procedure';});
 const legacySaved=await api(h.ids.owner,'create',{document:legacy,status:'production'}),legacyEditor=await pageFor(h.ids.owner);await legacyEditor.page.goto(origin+'/recipes.html');await legacyEditor.page.locator('.recipe-card').filter({has:legacyEditor.page.getByRole('heading',{name:'QA legacy names',exact:true})}).getByRole('button',{name:'Open recipe',exact:true}).click();await legacyEditor.page.getByRole('button',{name:'Edit recipe',exact:true}).click();await fill(legacyEditor.page,'variants.0.groups.0.name','Renamed legacy sponge');await legacyEditor.page.locator('[data-component-editor]').first().getByRole('button',{name:'Move component down',exact:true}).click();assert.equal(await legacyEditor.page.locator('[data-component-editor]').nth(1).locator('textarea').inputValue(),'Mix and bake the sponge.');assert.deepEqual((await api(h.ids.owner,'get',{id:legacySaved.id})).document,legacySaved.document);await legacyEditor.context.close();
 results.push('Renaming a legacy component retains its matched procedure in the working draft without rewriting the saved recipe');
 assert.deepEqual(errors,[]);console.log(results.map(r=>'PASS '+r).join('\n'));
}finally{await browser.close();await db.close();await writeFile(join(out,'results.json'),JSON.stringify({results,errors},null,2));}
