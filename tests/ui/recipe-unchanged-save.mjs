import assert from 'node:assert/strict';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
const t=await recipeBrowserHarness(),owner=t.h.ids.owner;
const api=(action,payload={})=>t.api(owner,action,payload);
try{
 const d=blankRecipe();d.name='Repeated Save fixture';d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Mix and bake.';
 delete d.variants[0].methods[0].group_id;delete d.variants[0].packaging;
 const recipe=await api('create',{document:d,status:'final'}),{page}=await t.pageFor(owner);page.setDefaultTimeout(15000);
 await page.goto(t.origin+'/recipes.html');await page.locator(`[data-action=edit-open][data-id="${recipe.id}"]`).click();
 const save=page.getByRole('button',{name:'Save',exact:true}),instruction=page.locator('[data-step-input]').first();
 const saved=()=>page.waitForFunction(()=>document.querySelector('#recipe-editor')?.inert===false&&document.querySelector('[data-save-status]')?.textContent.startsWith('Saved.'));
 for(let i=0;i<3;i++){await save.click();await page.locator('#recipe-notice').filter({hasText:'No changes to save.'}).waitFor();await saved();}
 assert.equal(t.requests.filter(r=>r.action==='save').length,0);assert.equal((await api('versions',{id:recipe.id})).length,1);
 // Let an edited working copy autosave, then undo it. No stale recovery copy
 // should remain, and an undo is not a saved recipe change.
 await instruction.fill('Temporary change');
 await page.waitForFunction(()=>document.querySelector('[data-save-status]')?.textContent.startsWith('Working copy backed up.'));
 await instruction.fill('Mix and bake.');await save.click();await saved();
 assert.equal((await api('drafts')).length,0);assert.equal((await api('versions',{id:recipe.id})).length,1);
 await instruction.fill('Mix and bake gently.');await save.click();await saved();
 assert.equal((await api('versions',{id:recipe.id})).length,2);
 for(let i=0;i<3;i++){await save.click();await saved();}
 assert.equal(t.requests.filter(r=>r.action==='save').length,1);assert.equal((await api('versions',{id:recipe.id})).length,2);
 await page.getByRole('button',{name:'View saved recipe',exact:true}).click();await page.getByRole('button',{name:'Edit recipe',exact:true}).click();
 await save.click();await saved();assert.equal((await api('versions',{id:recipe.id})).length,2);
 await page.locator('#recipe-save-status').selectOption('draft');await save.click();await saved();
 let record=await api('get',{id:recipe.id});assert.equal(record.version,3);assert.equal(record.status,'draft');
 await page.setViewportSize({width:390,height:900});await save.click();await saved();
 record=await api('get',{id:recipe.id});assert.equal(record.version,3);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(t.errors,[]);
 console.log('PASS Repeated Save, edit/undo after autosave, genuine edits, reopen and status changes keep the correct version counts on desktop and mobile.');
}finally{await t.close();}
