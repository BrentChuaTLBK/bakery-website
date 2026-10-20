import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {blankRecipe,freshVariant} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
const t=await recipeBrowserHarness(),owner=t.h.ids.owner,staff=t.h.ids.staff;
const api=(action,payload={})=>t.api(owner,action,payload),out=join(t.out,'staff-updates');
await mkdir(out,{recursive:true});
const card=(page,id)=>page.locator('.recipe-card').filter({has:page.locator(`[data-action=open][data-id="${id}"]`)});
function document(name){
 const d=blankRecipe();d.name=name;const v=d.variants[0];v.name='880ml';v.yield={...v.yield,quantity:'1',unit:'Jar'};
 v.groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100.12345',unit:'g'}];v.methods[0].steps[0].instruction='Mix and bake.';
 return d;
}
try{
 const salt=await api('save_resource',{kind:'ingredient',name:'Salt reference',data:{default_unit:'g'},price:{amount:'100',quantity:'1',unit:'kg'}});
 const d=document('Cookie reference');d.variants[0].groups[0].ingredients.push({id:'salt',ingredient_id:salt.id,name:salt.name,quantity:'1/8',unit:'tsp'});
 d.variants.push(freshVariant(d.variants[0],'440ml'));
 const recipe=await api('create',{document:d,status:'production'});
 const session=await t.pageFor(owner),page=session.page;page.setDefaultTimeout(15000);
 await page.goto(t.origin+'/recipes.html');await card(page,recipe.id).waitFor();
 assert.equal(await page.getByRole('button',{name:'Delete all',exact:true}).count(),0);
 await page.locator('[data-tab=ingredient]').click();
 await page.locator(`[data-resource-id="${salt.id}"] [data-action=edit-resource]`).click();
 const form=page.locator('#recipe-resource-form');
 await form.getByRole('button',{name:'Add equivalent unit',exact:true}).click();
 await form.locator('[data-conversion-from]').fill('tsp');
 await form.locator('[data-conversion-quantity]').fill('6');
 await form.locator('[name=default_unit]').selectOption('tsp');
 await form.locator('[data-cost-selection]').filter({hasText:'₱0.6 / tsp'}).waitFor();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await form.locator('[data-unit-equivalents]').screenshot({style:'#recipe-notice{visibility:hidden}',path:join(out,`equivalents-${width}.png`)});
 }
 await form.getByRole('button',{name:'Save ingredient',exact:true}).click();await form.waitFor({state:'hidden'});
 const updated=(await api('resources',{kind:'ingredient',query:salt.name})).rows[0];
 assert.deepEqual(updated.data.unit_conversions,{tsp:{quantity:'6',unit:'g'}});
 const cost=(await api('costing',{id:recipe.id})).snapshot.variants[0];
 assert.ok(Math.abs(Number(cost.ingredient_cost)-.075)<1e-9);
 await page.locator(`[data-resource-id="${salt.id}"] [data-action=edit-resource]`).click();
 assert.equal(await form.locator('[data-conversion-quantity]').inputValue(),'6');
 await page.locator('[data-dialog-close]').click();
 console.log('PASS Ingredient equivalents save, reload and cost 1/8 tsp from the kg purchase, including a live supplier comparison.');
 await page.locator('[data-tab=costing]').click();
 await page.locator(`[data-cost-group="${recipe.id}"]`).waitFor();
 const group=page.locator(`[data-cost-group="${recipe.id}"]`);
 assert.equal(await group.getByText(recipe.document.name,{exact:true}).count(),1);
 assert.equal(await group.locator('[data-cost-variant]').count(),2);
 assert.equal(await group.locator('[data-action=edit-open]').count(),1);
 assert.equal(await group.getByRole('button',{name:'Review prices',exact:true}).count(),1);
 for(const width of [1440,820,390]){
  await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await group.screenshot({style:'#recipe-notice{visibility:hidden}',path:join(out,`grouped-costing-${width}.png`)});
 }
 await page.locator('[data-action=overview-basis][data-basis=unit]').click();
 await group.locator(`[data-cost-variant="${d.variants[1].id}"]`).locator('summary').click();
 await group.locator(`[data-cost-variant="${d.variants[1].id}"]`).getByRole('button',{name:'Open costing',exact:true}).click();
 await page.locator('#recipe-dialog [data-cost-results]').filter({hasText:'440ml'}).waitFor();
 await page.locator('[data-dialog-close]').click();
 await page.locator('[data-action=edit]').click();
 for(const width of [1440,820,390,320]){
  await page.setViewportSize({width,height:1000});const footer=page.locator('.recipe-sticky-save');await footer.scrollIntoViewIfNeeded();
  const controls=await footer.locator('select,button').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {y:r.y,height:r.height,bottom:r.bottom};}));
  assert.ok(Math.abs(controls[1].y-controls[2].y)<=1);
  if(width>420)assert.ok(Math.abs(controls[0].y-controls[1].y)<=1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await footer.screenshot({style:'#recipe-notice{visibility:hidden}',path:join(out,`save-alignment-${width}.png`)});
 }
 console.log('PASS Costing groups sizes under one name, opens the right size, and save controls align at desktop/tablet/phone widths.');
 await session.context.close();
 await api('save_access',{user_id:staff,permission:'kitchen'});
 for(const width of [1440,820,390,320]){
  const k=await t.pageFor(staff,width);await k.page.goto(t.origin+'/recipes.html');await card(k.page,recipe.id).locator('[data-action=open]').click();
  const controls=k.page.locator('.recipe-kitchen-production');
  assert.equal(await controls.locator('[data-view-variant],[data-scale=rounding],[data-scale=step]').count(),0);
  assert.equal(await controls.locator('[data-scale=target]').isVisible(),true);
  assert.equal(await controls.locator('[data-action=view-size]').count(),2);
  await controls.locator('[data-action=view-size]').nth(1).click();assert.equal(await controls.locator('[data-action=view-size]').nth(1).getAttribute('aria-pressed'),'true');
  assert.deepEqual(await k.page.locator('.recipe-component-view td.numeric').allTextContents(),['≈ 100.12 g','1/8 tsp']);
  await controls.getByRole('button',{name:'×2',exact:true}).click();
  assert.deepEqual(await k.page.locator('.recipe-component-view td.numeric').allTextContents(),['≈ 200.25 g','1/4 tsp']);
  await controls.locator('[data-scale=target]').fill('12');await controls.locator('[data-scale=target]').press('Tab');
  assert.deepEqual(await k.page.locator('.recipe-component-view td.numeric').allTextContents(),['≈ 1201.48 g','1 1/2 tsp']);
  await k.page.locator('.recipe-kitchen-adjustments>summary').click();await k.page.getByRole('button',{name:'Ingredient totals',exact:true}).click();
  await k.page.locator('#recipe-dialog .numeric').filter({hasText:'1201.48 g'}).waitFor();await k.page.locator('[data-dialog-close]').click();
  assert.equal(await k.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await controls.screenshot({style:'#recipe-notice{visibility:hidden}',path:join(out,`staff-controls-${width}.png`)});
  await k.context.close();
 }
 assert.deepEqual((await api('get',{id:recipe.id})).document,recipe.document);
 console.log('PASS Always-visible size buttons, direct scaling, two-decimal quantities and teaspoon fractions work at four screen widths without editing the recipe.');
 const trash=[];
 for(const name of ['Discard one','Other hidden trash']){const r=await api('create',{document:document(name),status:'draft'});await api('delete',{id:r.id,revision:r.revision});trash.push(r);}
 const client=await t.pageFor(owner,390),p=client.page;
 await p.goto(t.origin+'/recipes.html');await p.locator('[data-filter=collection]').selectOption('deleted');await card(p,trash[0].id).waitFor();
 await card(p,trash[0].id).getByRole('button',{name:'Delete permanently',exact:true}).click();
 await p.locator('.site-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(t.requests.filter(r=>r.action==='purge').length,0);
 await card(p,trash[0].id).getByRole('button',{name:'Delete permanently',exact:true}).click();
 await p.locator('.site-dialog').getByRole('button',{name:'Delete permanently',exact:true}).click();
 await card(p,trash[0].id).waitFor({state:'detached'});
 assert.equal((await api('purge_preview',{scope:'all_deleted'})).count,1);
 await p.locator('[data-filter=query]').fill('No visible matches');await p.getByText('No recipes here yet',{exact:true}).waitFor();
 await p.getByRole('button',{name:'Delete all',exact:true}).click();
 assert.match(await p.locator('.site-dialog').innerText(),/all 1 recipes in Recently deleted/);
 assert.match(await p.locator('.site-dialog').innerText(),/Active recipes will be kept/);
 await p.locator('.site-dialog').getByRole('button',{name:'Delete all permanently',exact:true}).click();
 await p.locator('#recipe-notice').filter({hasText:'Permanently deleted 1 recipe'}).waitFor();
 assert.equal((await api('purge_preview',{scope:'all_deleted'})).count,0);
 assert.equal((await api('get',{id:recipe.id})).deleted_at,null);
 await client.context.close();assert.deepEqual(t.errors,[]);
 console.log('PASS Trash-only permanent deletion supports cancel, one recipe, and all hidden results while retaining active recipes.');
}finally{await t.close();}
