import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
const t=await recipeBrowserHarness(),out=join(t.out,'refinement');await mkdir(out,{recursive:true});
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const api=(action,payload={})=>t.api(t.h.ids.owner,action,payload);
let page;
try{
 const supplier=await api('save_resource',{kind:'supplier',name:'Saved supplier',data:{}});
 const flour=await api('save_resource',{kind:'ingredient',name:'Test flour',data:{default_unit:'g'},suppliers:[{supplier_id:supplier.id,price:{amount:'600',quantity:'2000',unit:'g'}}]});
 await api('save_costing_settings',{percent:'20',revision:(await api('costing_settings')).revision});
 const doc=blankRecipe();doc.name='Coconut Chiffon & Mousse';const v=doc.variants[0];v.name='Six inch';v.yield={...v.yield,quantity:'1',unit:'cake'};
 const group=(name,amount)=>({id:randomUUID(),name,ingredients:[{id:randomUUID(),ingredient_id:flour.id,name:flour.name,quantity:amount,unit:'g',brand:''}]});
 v.groups=[group('Coconut Chiffon','100'),group('Coconut Mousse','50')];v.methods=v.groups.map(g=>({id:randomUUID(),name:g.name+' method',group_id:g.id,steps:[{id:randomUUID(),instruction:'Prepare '+g.name+'.'}]}));v.methods.push({id:randomUUID(),name:'Assembly',group_id:'',steps:[{id:randomUUID(),instruction:'Assemble and chill.'}]});
 const record=await api('create',{document:doc,status:'final'});
 ({page}=await t.pageFor(t.h.ids.owner));page.setDefaultTimeout(12000);await page.goto(t.origin+'/recipes.html');
 await check('library shows four main sections, current batch costs and yield',async()=>{
  await page.locator('[data-library-cost]').filter({hasText:'54.00'}).waitFor();assert.deepEqual(await page.locator('.recipe-tabs button').allTextContents(),['Recipes','Costing','Ingredients & supplies','Manage']);assert.match(await page.locator('[data-library-cost]').innerText(),/1 cake.*Six inch/);
 });
 await check('search retains the same focused input and caret across delayed result updates',async()=>{
  const search=page.locator('[data-filter=query]');await search.focus();await page.evaluate(()=>window.searchElement=document.activeElement);await search.pressSequentially('Coconut',{delay:120});await page.waitForFunction(()=>document.querySelector('.recipe-library h2')?.textContent.includes('Coconut')&&document.querySelector('#recipe-main')?.getAttribute('aria-busy')!=='true');
  assert.equal(await search.inputValue(),'Coconut');assert.equal(await page.evaluate(()=>document.activeElement===window.searchElement),true);assert.equal(await search.evaluate(e=>e.selectionStart),7);
 });
 await check('reader keeps each component method together, Packaging last, and checks across scaling',async()=>{
  await page.locator('[data-action=open]').click();await page.locator('[data-saved-cost-card]').filter({hasText:'54.00'}).waitFor();
  assert.equal(await page.locator('.recipe-component-view').count(),2);assert.match(await page.locator('.recipe-component-view').first().innerText(),/Coconut Chiffon method/);assert.match(await page.locator('.recipe-component-view').nth(1).innerText(),/Coconut Mousse method/);
  assert.equal(await page.locator('.recipe-workspace-body>section').last().getAttribute('data-kitchen-panel'),'packaging');
  const tick=page.locator('[data-check]').first();await tick.check();await page.locator('[data-scale=target]').fill('2');await page.locator('[data-scale=target]').press('Tab');await page.locator('[data-saved-cost-card]').filter({hasText:'108.00'}).waitFor();assert.equal(await page.locator('[data-check]').first().isChecked(),true);
  await page.screenshot({path:join(out,'reader-desktop.png'),fullPage:true});
 });
 await check('three editor sections retain values and update live costs without a modal',async()=>{
  await page.locator('[data-action=edit]').click();await page.locator('[data-live-cost]').filter({hasText:'54.00'}).waitFor();assert.deepEqual(await page.locator('.recipe-editor-sections button').allTextContents(),['Ingredients & method','Yield & pricing','Details & notes']);
  assert.equal(await page.locator('[data-component-editor]').count(),2);assert.equal(await page.locator('[data-editor-panel=ingredients]>section').last().getAttribute('class'),'recipe-card recipe-packaging-editor');
  await page.locator('[data-path="variants.0.groups.0.ingredients.0.quantity"]').fill('200');await page.locator('[data-live-cost]').filter({hasText:'90.00'}).waitFor();
  await page.locator('[data-editor-section=details]').click();await page.locator('[data-path=description]').fill('A saved two-component recipe.');await page.locator('[data-editor-section=yield]').click();assert.equal(await page.locator('[data-path="variants.0.costing.labor_percent"]').count(),0);
  await page.locator('[data-editor-section=ingredients]').click();assert.equal(await page.locator('[data-path="variants.0.groups.0.ingredients.0.quantity"]').inputValue(),'200');
  await page.locator('[data-action=save]').click();await page.waitForFunction(()=>document.querySelector('[data-save-status]')?.textContent.startsWith('Saved.'));assert.equal((await api('get',{id:record.id})).document.description,'A saved two-component recipe.');
  await page.screenshot({path:join(out,'editor-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,'editor-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 });
 await check('Manage saves custom units and makes them available in purchase forms',async()=>{
  await page.locator('[data-action=library]').click();await page.locator('[data-tab=manage]').click();await page.locator('[data-tab=units]').click();await page.locator('[data-add-unit] [name=name]').fill('Bag');await page.locator('[data-add-unit] [name=symbol]').fill('bag');await page.locator('[data-add-unit] button').click();await page.locator('.recipe-table tbody tr').filter({hasText:'Bag'}).waitFor();
  await page.locator('[data-action=record-purchase]').click();const form=page.locator('#recipe-purchase-form');await form.waitFor();assert.equal(await form.locator('[name=supplier_id]').evaluate(e=>e.tagName),'SELECT');assert.equal(await form.locator('[name=supplier_id] option').count(),2);assert.equal(await form.locator('[name=unit] option[value=bag]').count(),1);
 });
 await check('pack previews and unfinished purchases survive closing, navigation and reload',async()=>{
  let form=page.locator('#recipe-purchase-form');await form.locator('[name=name]').fill('Test flour');await form.locator('#purchase-items option[value="Test flour"]').waitFor({state:'attached'});await form.locator('[name=name]').press('Tab');await form.locator('[name=supplier_id]').selectOption(supplier.id);await form.locator('[name=unit]').selectOption('bag');await form.locator('[name=amount]').fill('800');await form.locator('[name=quantity]').fill('2');await form.locator('[name=contents_quantity]').fill('1000');await form.locator('[data-purchase-preview]').filter({hasText:'0.40'}).waitFor();await form.locator('[data-purchase-preview]').filter({hasText:'1 saved recipe'}).waitFor();
  await page.screenshot({path:join(out,'purchase.png')});await page.keyboard.press('Escape');await page.locator('[data-tab=library]').click();await page.getByRole('button',{name:'Resume purchase',exact:true}).click();assert.equal(await form.locator('[name=amount]').inputValue(),'800');await form.locator('[data-keep-purchase]').click();await page.reload();await page.getByRole('button',{name:'Resume purchase',exact:true}).click();assert.equal(await form.locator('[name=contents_quantity]').inputValue(),'1000');
  await form.getByRole('button',{name:'Save purchase',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#recipe-dialog').open);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(key=>key.startsWith('tlb-recipe-purchase-v1:'))),false);
  assert.equal(Number((await api('costing',{id:record.id})).snapshot.variants[0].adjusted_cost),120);
  assert.match(await page.locator(`[data-resource-id="${flour.id}"]`).innerText(),/Used in 1 recipe/);
 });
 await check('global allowance applies to all recipe cards and previews while snapshots remain fixed',async()=>{
  await page.locator('[data-tab=costing]').click();const form=page.locator('[data-shared-allowance]');await form.locator('[name=percent]').fill('0');await form.locator('button').click();await page.waitForFunction(()=>document.querySelector('[data-shared-allowance] [name=percent]')?.value==='0'&&document.querySelector('[data-shared-allowance] button')?.disabled===false);
  await page.locator('[data-tab=library]').click();await page.locator('[data-library-cost]').filter({hasText:'100.00'}).waitFor();assert.equal(Number((await api('costing',{id:record.id,source:'saved'})).snapshot.variants[0].adjusted_cost),90);
 });
 await check('Costing defaults to all recipes and returns from editing to the same search',async()=>{
  await page.locator('[data-tab=costing]').click();assert.equal(await page.locator('[data-cost-filter=mode]').inputValue(),'all');const search=page.locator('[data-cost-filter=query]');await search.fill('Coconut');await page.waitForFunction(()=>document.querySelector('#recipe-main').getAttribute('aria-busy')!=='true'&&document.querySelector('[data-cost-filter=query]').value==='Coconut');await page.locator('[data-cost-product] [data-action=edit-open]').click();await page.locator('[data-action=return-costing]').click();assert.equal(await page.locator('[data-cost-filter=query]').inputValue(),'Coconut');await page.locator('[data-tab=library]').click();
 });
 await check('an unfinished recipe resumes after keeping the draft and reloading',async()=>{
  await page.locator('[data-action=edit-open]').click();await page.locator('[data-editor-section=details]').click();await page.locator('[data-path=description]').fill('Unfinished changes to recover');await page.locator('[data-action=keep-draft]').click();await page.locator('.recipe-draft-banner').waitFor();await page.reload();await page.getByRole('button',{name:'Resume working draft',exact:true}).click();await page.locator('[data-editor-section=details]').click();assert.equal(await page.locator('[data-path=description]').inputValue(),'Unfinished changes to recover');assert.notEqual((await api('get',{id:record.id})).document.description,'Unfinished changes to recover');await page.locator('[data-action=keep-draft]').click();
 });
 await check('sign-out removes unfinished purchase data and private screens',async()=>{
  await page.locator('[data-action=record-purchase]').click();await page.locator('#recipe-purchase-form [name=amount]').fill('123');await page.evaluate(()=>window.auditAuthEvent('SIGNED_OUT'));await page.waitForFunction(()=>!document.querySelector('#recipe-dialog').open);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(key=>key.startsWith('tlb-recipe-purchase-v1:'))),false);assert.equal(await page.locator('[data-library-cost]').count(),0);
 });
 assert.deepEqual(t.errors,[]);await writeFile(join(out,'results.json'),JSON.stringify({checks},null,2));console.log('Recipe refinement browser checks passed: '+checks.length);
}catch(error){if(page){await page.screenshot({path:join(out,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-5000));}console.error(t.errors);throw error;}finally{await t.close();}
