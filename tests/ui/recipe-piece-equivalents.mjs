import assert from 'node:assert/strict';
import {join} from 'node:path';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
const t=await recipeBrowserHarness(),owner=t.h.ids.owner;
const api=(action,payload={})=>t.api(owner,action,payload);
try{
 const eggs=await api('save_resource',{kind:'ingredient',name:'Egg whites',data:{default_unit:'pcs'},price:{amount:'12',quantity:'1',unit:'pcs'}});
 const d=blankRecipe();d.name='Egg whites in grams';d.variants[0].groups[0].ingredients=[{id:'egg',ingredient_id:eggs.id,name:eggs.name,quantity:'60',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Whisk.';
 const recipe=await api('create',{document:d,status:'final'});
 const {page}=await t.pageFor(owner);page.setDefaultTimeout(15000);
 await page.goto(t.origin+'/recipes.html');await page.locator('[data-tab=ingredient]').click();
 await page.locator(`[data-resource-id="${eggs.id}"] [data-action=edit-resource]`).click();
 const form=page.locator('#recipe-resource-form');
 await form.getByRole('button',{name:'Add equivalent unit',exact:true}).click();
 const from=form.locator('[data-conversion-from]'),to=form.locator('[data-conversion-unit]');
 await from.selectOption('pcs');await form.locator('[data-conversion-quantity]').fill('30');await to.selectOption('g');
 assert.equal(await to.locator('option[value=pc]').count(),0,'Piece equivalents require a measured weight or volume');
 await form.locator('[name=default_unit]').selectOption('g');
 await form.locator('[data-cost-selection]').filter({hasText:'₱0.4 / g'}).waitFor();
 assert.equal(await form.locator('[name=price_unit]').inputValue(),'pcs');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`No form overflow at ${width}px`);
  if(width!==320)await form.locator('[data-unit-equivalents]').screenshot({path:join(t.out,`piece-equivalents-${width}.png`)});
 }
 await form.getByRole('button',{name:'Save ingredient',exact:true}).click();await form.waitFor({state:'hidden'});
 let saved=(await api('resources',{kind:'ingredient',query:'Egg whites'})).rows[0];
 assert.deepEqual(saved.data.unit_conversions,{pcs:{quantity:'30',unit:'g'}});
 assert.equal(Number((await api('costing',{id:recipe.id})).snapshot.variants[0].ingredient_cost),24);
 assert.equal((await api('costing',{id:recipe.id,source:'saved'})).snapshot.variants[0].complete,false);
 await page.locator(`[data-resource-id="${eggs.id}"] [data-action=edit-resource]`).click();
 assert.equal(await from.inputValue(),'pcs');assert.equal(await to.inputValue(),'g');assert.equal(await form.locator('[data-conversion-quantity]').inputValue(),'30');
 await form.locator('[data-cost-selection]').filter({hasText:'₱0.4 / g'}).waitFor();
 // Switching to a kitchen measure makes piece targets available again.
 await from.selectOption('tsp');assert.equal(await to.locator('option[value=pc]').count(),1);
 await to.selectOption('pc');await from.selectOption('pcs');assert.equal(await to.inputValue(),'g');
 await form.locator('[data-conversion-remove]').click();
 await form.getByRole('button',{name:'Save ingredient',exact:true}).click();await form.waitFor({state:'hidden'});
 saved=(await api('resources',{kind:'ingredient',query:'Egg whites'})).rows[0];assert.deepEqual(saved.data.unit_conversions,{});
 assert.equal((await api('costing',{id:recipe.id})).snapshot.variants[0].complete,false);
 assert.deepEqual(t.errors,[]);
 console.log('PASS Piece equivalent dropdown, live supplier price, save/reopen, gram recipe costing and removal at desktop/mobile widths.');
}finally{await t.close();}
