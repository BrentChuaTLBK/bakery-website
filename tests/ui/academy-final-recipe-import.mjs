import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {auditHarness} from './academy-audit-harness.mjs';

const s=await auditHarness(),{db,h,origin}=s,out='work/academy-final-recipe-import',results=[];
const api=(action,p={})=>s.serial(()=>s.api(h.ids.owner,action,p));
await mkdir(out,{recursive:true});
const check=async(name,fn)=>{
 try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}
 catch(error){results.push({name,status:'FAIL',error:error.stack});throw error;}
 finally{for(const context of s.browser.contexts())await context.close();}
};
const documentFor=(name,number)=>({name,description:`Teaching source version ${number}`,variants:[{name:'Main',groups:[{name:'Ingredients',ingredients:[{name:'Flour',quantity:String(number*100),unit:'g'}]}],methods:[{name:'Method',steps:[{instruction:`Follow version ${number}.`}]}]}]});
const version=async(recipeId,name,number,status)=>{
 const id=randomUUID();await s.serial(()=>db.query("insert into tlb.recipe_versions(id,recipe_id,number,status,document) values($1,$2,$3,$4,$5::jsonb)",[id,recipeId,number,status,JSON.stringify(documentFor(name,number))]));return id;
};
const source=async(name,statuses,{deleted=false}={})=>{
 const id=randomUUID();await s.serial(()=>db.query('insert into tlb.recipes(id,code,name) values($1,$2,$3)',[id,'FINAL-'+id.slice(0,8),name]));
 const versions=[];for(const [index,status] of statuses.entries())versions.push(await version(id,name,index+1,status));
 const current=versions.at(-1),production=versions[statuses.lastIndexOf('production')]||null;
 await s.serial(()=>db.query('update tlb.recipes set current_version_id=$2,production_version_id=$3,deleted_at=case when $4 then now() else null end where id=$1',[id,current,production,deleted]));
 return {id,name,versions,current,production};
};
const open=async(width=1440)=>{const p=await s.pageFor(h.ids.owner,width);await p.page.goto(origin+'/academy/admin#recipes');await p.page.getByRole('button',{name:'Import from Recipe System',exact:true}).waitFor();return p;};
const showImport=async page=>{await page.getByRole('button',{name:'Import from Recipe System',exact:true}).click();await page.locator('#ap-source-recipes[aria-busy]').waitFor({state:'detached'});return page.getByRole('dialog');};
const search=async(dialog,query)=>{await dialog.getByLabel('Recipe name',{exact:true}).fill(query);await dialog.getByRole('button',{name:'Search Final recipes',exact:true}).click();await dialog.locator('#ap-source-recipes[aria-busy]').waitFor({state:'detached'});};
const count=async()=>Number((await s.serial(()=>db.query('select count(*) n from tlb.academy_student_recipes'))).rows[0].n);

try{
 const final=await source('QA Final cookies',['production','draft','production']);
 const second=await source('QA Final bread',['production']);
 await source('QA Draft recipe',['production','draft']);await source('QA R&D recipe',['production','testing']);
 await source('QA Hidden recipe',['production','hidden']);await source('QA Archived recipe',['production','archived']);
 await source('QA Deleted Final recipe',['production'],{deleted:true});

 await check('The import picker shows each eligible current Final once and excludes Draft, R&D, hidden, archived, deleted and historical versions',async()=>{
  const {page}=await open(),dialog=await showImport(page);
  await dialog.getByText(/Only the current Final version of each recipe is available/).waitFor();
  assert.deepEqual((await dialog.locator('[data-import]').evaluateAll(buttons=>buttons.map(button=>button.dataset.import))).sort(),[final.current,second.current].sort());
  assert.equal(await dialog.getByRole('button',{name:'QA Final cookies · v3 · Final',exact:true}).count(),1);
  assert.equal(await dialog.getByRole('button',{name:/· production$/}).count(),0);
  await page.screenshot({path:out+'/final-picker-desktop.jpg',type:'jpeg',quality:82});
  await search(dialog,'QA Draft');await dialog.getByText('No matching Final recipes.',{exact:true}).waitFor();assert.equal(await dialog.locator('[data-import]').count(),0);
  await page.setViewportSize({width:390,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:out+'/final-picker-empty-phone.jpg',type:'jpeg',quality:82});
 });

 await check('A stale Final selection fails visibly without creating a copy; a new search imports the exact replacement Final version',async()=>{
  const {page}=await open(),dialog=await showImport(page),before=await count();
  const draft=await version(final.id,final.name,4,'draft');await s.serial(()=>db.query('update tlb.recipes set current_version_id=$2 where id=$1',[final.id,draft]));
  await dialog.locator(`[data-import="${final.current}"]`).click();
  await dialog.getByRole('alert').filter({hasText:'This recipe is no longer the current Final version. Search Final recipes again.'}).waitFor();
  assert.equal(await count(),before);assert(await dialog.getByRole('button',{name:'Search Final recipes',exact:true}).isEnabled());
  await search(dialog,'QA Final cookies');await dialog.getByText('No matching Final recipes.',{exact:true}).waitFor();
  const replacement=await version(final.id,final.name,5,'production');await s.serial(()=>db.query('update tlb.recipes set current_version_id=$2,production_version_id=$2 where id=$1',[final.id,replacement]));
  await search(dialog,'QA Final cookies');assert.equal(await dialog.locator('[data-import]').count(),1);
  await dialog.getByRole('button',{name:'QA Final cookies · v5 · Final',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[name=title]')?.value==='QA Final cookies');
  const importedId=new URL(page.url()).hash.split('/')[1],imported=await api('admin_recipe',{id:importedId});
  assert.equal(await count(),before+1);assert.equal(imported.source_version_id,replacement);assert.equal(imported.source.number,5);
  assert.equal(imported.document.description,'Teaching source version 5');assert.equal(imported.document.variants[0].groups[0].ingredients[0].quantity,'500');
  assert.match(await page.locator('.ap-recipe-source-strip').textContent(),/QA Final cookies · v5/);
 });

 await check('A delayed initial search cannot replace newer filtered Final results',async()=>{
  const p=await open(),{page}=p;await page.evaluate(()=>{const rpc=window.auditRpc;window.completedFinalSearches=0;window.auditRpc=async(action,payload)=>{try{return await rpc(action,payload);}finally{if(action==='final_recipes')window.completedFinalSearches++;}};});
  const delayed=p.delayNext('final_recipes');await page.getByRole('button',{name:'Import from Recipe System',exact:true}).click();await delayed.pending;
  const dialog=page.getByRole('dialog');await search(dialog,'QA Final bread');assert.equal(await dialog.locator('[data-import]').count(),1);
  delayed.release();await page.waitForFunction(()=>window.completedFinalSearches===2);
  assert.deepEqual(await dialog.locator('[data-import]').evaluateAll(buttons=>buttons.map(button=>button.dataset.import)),[second.current]);
 });

 await check('The dialog prevents a second import while the selected Final import is pending',async()=>{
  const p=await open(),{page}=p,dialog=await showImport(page),before=await count(),pending=p.delayNext('import_recipe');
  await dialog.locator(`[data-import="${second.current}"]`).click();await pending.pending;
  assert(await dialog.getByRole('button',{name:'Search Final recipes',exact:true}).isDisabled());
  assert(await dialog.locator('[data-import]').evaluateAll(buttons=>buttons.every(button=>button.disabled)));
  await dialog.locator('[data-import]').first().evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  pending.release();await page.waitForFunction(()=>document.querySelector('[name=title]')?.value==='QA Final bread');
  assert.equal(p.calls.filter(call=>call.action==='import_recipe').length,1);assert.equal(await count(),before+1);
 });

 await check('An interrupted Final import retries after a new search using the same idempotency key and one student copy',async()=>{
  const p=await open(),{page}=p,dialog=await showImport(page),before=await count();p.failNext('import_recipe','after');
  await dialog.locator(`[data-import="${second.current}"]`).click();await dialog.getByRole('alert').filter({hasText:'Connection interrupted. Please retry.'}).waitFor();assert.equal(await count(),before+1);
  await search(dialog,'QA Final bread');await dialog.getByRole('button',{name:'QA Final bread · v1 · Final',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[name=title]')?.value==='QA Final bread');
  const calls=p.calls.filter(call=>call.action==='import_recipe');assert.equal(calls.length,2);assert.equal(calls[0].p.idempotency_key,calls[1].p.idempotency_key);assert.equal(await count(),before+1);
 });
 assert.deepEqual(s.errors,[],'No browser page errors');
}finally{await writeFile(out+'/results.json',JSON.stringify({results,errors:s.errors,scope:'Actual Academy Admin UI and isolated PGlite database. No live database changes.'},null,2));await s.close();}
