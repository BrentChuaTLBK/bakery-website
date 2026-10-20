import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';

const t=await recipeBrowserHarness(),owner=t.h.ids.owner;
const api=(action,payload={})=>t.api(owner,action,payload);
const card=(page,id)=>page.locator('.recipe-library .recipe-card').filter({has:page.locator(`[data-action="open"][data-id="${id}"]`)});
try{
 const document=blankRecipe();document.name='Library duplicate reference';
 const size=document.variants[0];
 size.groups[0].ingredients=[{id:'vanilla',name:'Vanilla',quantity:'1 1/2',unit:'tsp'}];
 size.methods[0].steps[0].instruction='Mix gently.';
 size.baking=[{id:'bake',group_id:size.groups[0].id,name:'Stage 1 — Bake',top:'165',minutes:'11'}];
 size.packaging.description='Jar and lid';
 document.private_notes='Keep this private note with the copy.';
 const source=await api('create',{document,status:'production',visibility:'owner'});
 const shared=await api('create',{document:{...document,name:'Shared library reference'},status:'production'});
 const out=join(t.out,'library-duplicate');await mkdir(out,{recursive:true});
 for(const width of [1440,390]){
  const {page,context}=await t.pageFor(owner,width);
  await page.goto(t.origin+'/recipes.html');
  await card(page,source.id).getByRole('button',{name:'Duplicate',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await card(page,source.id).screenshot({path:join(out,`card-${width}.png`)});
  const before=t.requests.filter(r=>r.action==='duplicate').length;
  // A rapid second click must not create a second copy while the first is pending.
  await card(page,source.id).getByRole('button',{name:'Duplicate',exact:true}).evaluate(button=>{button.click();button.click();});
  await page.locator('#recipe-editor').waitFor();
  assert.equal(await page.locator('[data-path="name"]').inputValue(),document.name+' — copy');
  assert.equal(await page.locator('#recipe-save-status').inputValue(),'draft');
  assert.equal(await page.locator('[data-edit-visibility]').inputValue(),'owner');
  assert.equal(await page.locator('[data-baking-stage="0"] > summary strong').innerText(),'Stage 1 — Bake');
  const copies=t.requests.filter(r=>r.action==='duplicate');assert.equal(copies.length,before+1);
  const copy=copies.at(-1).result;
  assert.notEqual(copy.id,source.id);assert.notEqual(copy.version_id,source.version_id);assert.equal(copy.version,1);
  assert.deepEqual({...copy.document,name:document.name},source.document);
  await page.locator('[data-path="name"]').fill(`Independent copy ${width}`);
  await page.locator('[data-path="variants.0.groups.0.ingredients.0.quantity"]').fill('3');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#recipe-editor')?.inert===false&&document.querySelector('[data-save-status]')?.textContent.startsWith('Saved.'));
  assert.equal((await api('get',{id:copy.id})).document.variants[0].groups[0].ingredients[0].quantity,'3');
  const original=await api('get',{id:source.id});
  assert.equal(original.version_id,source.version_id);assert.deepEqual(original.document,source.document);
  await page.locator('[data-action="library"]').click();
  await card(page,copy.id).waitFor();
  assert.equal(await card(page,copy.id).getByRole('heading').innerText(),`Independent copy ${width}`);
  await context.close();
  console.log(`PASS ${width}px library duplication creates one independent editable draft, preserves formula and owner-only visibility, and refreshes the library.`);
 }
 await api('save_access',{user_id:t.h.ids.staff,permission:'kitchen'});
 const kitchen=await t.pageFor(t.h.ids.staff,390);
 await kitchen.page.goto(t.origin+'/recipes.html?view=kitchen');
 await card(kitchen.page,shared.id).waitFor();
 assert.equal(await kitchen.page.getByRole('button',{name:'Duplicate',exact:true}).count(),0);
 assert.equal(await card(kitchen.page,source.id).count(),0);
 await kitchen.context.close();
 console.log('PASS Kitchen staff do not receive the duplicate action or owner-only recipes.');
 assert.deepEqual(t.errors,[]);
}finally{await t.close();}
