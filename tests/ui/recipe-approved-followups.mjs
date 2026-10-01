import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
import {staffFixture} from '../backend/recipe-staff-fixture.mjs';
import {blankRecipe,scaledCopy} from '../../assets/ordering/recipe-model.js';
import {scaleFactor,exact,initialScale,scalingOptions} from '../../assets/ordering/recipe-math.js';
const t=await recipeBrowserHarness(),out=join(t.out,'approved-followups');await mkdir(out,{recursive:true});
const checks=[];let page;
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const api=(action,payload={},user=t.h.ids.owner)=>t.api(user,action,payload);
try{
 await t.db.query("insert into tlb.recipe_resources(kind,name,data) select 'ingredient','Paging '||lpad(n::text,3,'0'),jsonb_build_object('default_unit','g','brand','Test brand') from generate_series(1,201)n");
 await t.db.query("insert into tlb.recipe_prices(resource_id,amount,quantity,unit) select id,202-right(name,3)::integer,1,'kg' from tlb.recipe_resources where name like 'Paging %'");
 await check('catalog pages include every match once, sort globally, and clamp past the final page',async()=>{
  const list=await Promise.all([0,100,200].map(offset=>api('resources',{kind:'ingredient',query:'Paging ',limit:100,offset,paginate:true,include_inactive:true})));
  assert.deepEqual(list.map(r=>r.total),[201,201,201]);assert.deepEqual(list.map(r=>r.rows.length),[100,100,1]);assert.equal(new Set(list.flatMap(r=>r.rows.map(x=>x.id))).size,201);
  const cost=await api('resources',{kind:'ingredient',query:'Paging ',limit:100,sort:'cost',paginate:true});assert.equal(cost.rows[0].name,'Paging 201');assert.equal(cost.rows[99].name,'Paging 102');
  assert.equal((await api('resources',{kind:'ingredient',query:'Paging ',offset:900,paginate:true})).offset,200);
  assert.equal((await api('resources',{kind:'ingredient',query:'no matching record',offset:100,paginate:true})).offset,0);
 });
 ({page}=await t.pageFor(t.h.ids.owner));await page.goto(t.origin+'/recipes.html');await page.locator('[data-tab=ingredient]').click();
 const count=page.locator('[data-resource-count]'),rows=page.locator('.recipe-resource-table tbody tr');
 await check('Next and Previous navigate real ingredient pages, including the last page',async()=>{
  await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('Page 1 of 3'));assert.equal(await rows.count(),100);
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('Page 2 of 3'));assert.match(await rows.first().innerText(),/Paging 101/);
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('Page 3 of 3'));assert.equal(await rows.count(),1);assert.ok(await page.getByRole('button',{name:'Next',exact:true}).isDisabled());
  await page.getByRole('button',{name:'Previous',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('Page 2 of 3'));
 });
 await check('browser refresh, edit, and catalog navigation retain page and scroll position',async()=>{
  await page.evaluate(()=>scrollTo(0,1200));await page.reload();await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('Page 2 of 3')&&scrollY>1100);
  const edit=rows.filter({hasText:'Paging 115'}).getByRole('button',{name:'Edit',exact:true});await edit.click();const previous=await page.evaluate(()=>scrollY);
  await page.locator('#recipe-resource-form [name=brand]').fill('Updated brand');await page.getByRole('button',{name:'Save ingredient',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#recipe-dialog').open);
  assert.match(await count.innerText(),/Page 2 of 3/);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-previous)<60);assert.match(await rows.filter({hasText:'Paging 115'}).innerText(),/Updated brand/);
  await page.locator('[data-tab=supplier]').click();await page.locator('[data-resource-kind=supplier]').waitFor();await page.locator('[data-tab=ingredient]').click();await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('Page 2 of 3'));
  await page.screenshot({path:join(out,'ingredient-page-2.png'),animations:'disabled'});
 });
 await check('deleting the last item on the last page moves back one page, with deleted rows recoverable',async()=>{
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('Page 3 of 3'));
  await rows.first().getByRole('button',{name:'Delete',exact:true}).click();await page.locator('.site-dialog').getByRole('button',{name:'Delete record',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('Page 2 of 2'));assert.equal(await rows.count(),100);assert.ok(await page.getByRole('button',{name:'Next',exact:true}).isDisabled());
  await page.reload();await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('Page 2 of 2'));
  const deleted=await api('resources',{kind:'ingredient',deleted:true,paginate:true});assert.equal(deleted.total,1);assert.equal(deleted.rows[0].name,'Paging 201');
 });
 await check('search and global cost sort persist across refresh and fit phone screens',async()=>{
  await page.locator('[data-resource-search]').fill('Paging 1');await page.waitForFunction(()=>document.querySelector('[data-resource-count]')?.textContent.includes('of 100 ingredients'));
  await page.locator('[data-resource-sort]').selectOption('cost');await page.waitForFunction(()=>document.querySelector('.recipe-resource-table tbody tr')?.textContent.includes('Paging 199'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('.recipe-resource-table tbody tr')?.textContent.includes('Paging 199'));assert.equal(await page.locator('[data-resource-search]').inputValue(),'Paging 1');assert.equal(await page.locator('[data-resource-sort]').inputValue(),'cost');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('.recipe-resource-footer').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'ingredient-pagination-mobile.png')});await page.setViewportSize({width:1440,height:1000});
 });
 const supplierA=await api('save_resource',{kind:'supplier',name:'Supplier A',data:{}}),supplierB=await api('save_resource',{kind:'supplier',name:'Supplier B',data:{}});
 let flour=await api('save_resource',{kind:'ingredient',name:'Cake Flour',data:{default_unit:'g',brand:'Wooden Spoon'},suppliers:[{supplier_id:supplierA.id,price:{amount:'300',quantity:'1',unit:'kg'}},{supplier_id:supplierB.id,price:{amount:'170',quantity:'500',unit:'g'}}]});
 const doc=blankRecipe();doc.name='Linked labels and scaling';doc.variants[0].yield={...doc.variants[0].yield,quantity:'1',unit:'cake',scale_options:[{id:'by-yield',label:'Yield',quantity:'1',unit:'cake'},{id:'by-pcs',label:'Pcs',quantity:'12',unit:'pcs'}],scale_default:'custom:by-yield'};
 doc.variants[0].groups[0].ingredients=[{id:'linked-flour',ingredient_id:flour.id,name:'Cake Flour',brand:'Wooden Spoon',quantity:'100',unit:'g',notes:'Sift first'},{id:'manual',name:'Manual ingredient',brand:'Original brand',quantity:'10',unit:'g'}];doc.variants[0].methods[0].steps[0].instruction='Mix and bake.';
 const recipe=await api('create',{document:doc,status:'final'}),storedBefore=(await t.db.query('select document,cost_snapshot from tlb.recipe_versions where id=$1',[recipe.version_id])).rows[0];
 await check('unit dropdowns cover purchases, catalog and supplier prices; highest comparable supplier is selected',async()=>{
  await page.locator('[data-resource-search]').fill('Cake Flour');await rows.filter({hasText:'Cake Flour'}).waitFor();await rows.first().getByRole('button',{name:'Edit',exact:true}).click();
  assert.deepEqual(await page.locator('[name=default_unit] option').evaluateAll(a=>a.map(n=>n.value)),['','g','kg','ml','pcs']);
  assert.equal(await page.locator('[name=price_unit]').first().evaluate(e=>e.tagName),'SELECT');assert.match(await page.locator('[data-cost-selection]').innerText(),/Highest comparable cost: Supplier B/);
  await page.locator('[name=preferred_supplier_id]').selectOption(supplierA.id);assert.match(await page.locator('[data-cost-selection]').innerText(),/Preferred supplier: Supplier A/);await page.locator('[name=preferred_supplier_id]').selectOption('');
  await page.locator('#recipe-resource-form [name=name]').fill('C Flour');await page.locator('#recipe-resource-form [name=brand]').fill('WS');await page.getByRole('button',{name:'Save ingredient',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#recipe-dialog').open);
  await page.getByRole('button',{name:'Record purchase',exact:true}).click();await page.locator('#recipe-purchase-form').waitFor();assert.deepEqual(await page.locator('#recipe-purchase-form [name=unit] option').evaluateAll(a=>a.map(n=>n.value)),['','g','kg','ml','pcs']);await page.locator('#recipe-purchase-form [name=unit]').selectOption('kg');await page.locator('[data-dialog-close]').click();
 });
 await check('linked name and brand update in recipes without changing formulas, revisions or cost snapshots',async()=>{
  const updated=await api('get',{id:recipe.id}),ingredient=updated.document.variants[0].groups[0].ingredients[0];
  assert.equal(ingredient.name,'C Flour');assert.equal(ingredient.brand,'WS');assert.equal(ingredient.quantity,'100');assert.equal(ingredient.unit,'g');assert.equal(ingredient.notes,'Sift first');assert.equal(ingredient.ingredient_id,flour.id);
  assert.equal(updated.revision,recipe.revision);assert.deepEqual(updated.cost_snapshot,recipe.cost_snapshot);assert.deepEqual(updated.document.variants[0].groups[0].ingredients[1],doc.variants[0].groups[0].ingredients[1]);
  assert.deepEqual((await t.db.query('select document,cost_snapshot from tlb.recipe_versions where id=$1',[recipe.version_id])).rows[0],storedBefore);
  assert.equal((await api('list',{query:'C Flour'})).rows.some(r=>r.id===recipe.id),true);
 });
 await check('custom scaling uses exact ratios, preserves source recipes, and scales copy bases',async()=>{
  const y=doc.variants[0].yield;assert.equal(exact(scaleFactor(y,'custom:by-pcs','18')),'1.5');assert.equal(initialScale(y).target,'1');assert.deepEqual(scalingOptions(y).map(x=>x[1]),['Multiplier','Yield','Pcs']);
  for(const target of ['0','-1','bad'])assert.throws(()=>scaleFactor(y,'custom:by-pcs',target));assert.throws(()=>scaleFactor(y,'custom:missing','12'));
  const copy=scaledCopy(doc,doc.variants[0].id,'2');assert.equal(copy.variants[0].yield.scale_options[1].quantity,'24');assert.equal(doc.variants[0].yield.scale_options[1].quantity,'12');
  for(const patch of [{quantity:'0'},{label:''},{unit:''}]){const bad=structuredClone(doc);Object.assign(bad.variants[0].yield.scale_options[0],patch);await assert.rejects(api('cost_preview',{document:bad}),/scaling|positive|unit/i);}
  await assert.rejects(api('costing',{id:recipe.id,scaling_mode:'custom:missing'}),/no longer available/);
  const cost=await api('costing',{id:recipe.id,factor:'1.5',scaling_mode:'custom:by-pcs'});assert.equal(Number(cost.snapshot.variants[0].total),Number(recipe.cost_snapshot.variants[0].total)*1.5);
 });
 await page.locator('[data-tab=library]').click();await page.locator(`[data-action=open][data-id="${recipe.id}"]`).click();
 await check('recipe view and editor show current linked labels and configurable scaling choices',async()=>{
  await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();assert.deepEqual(await page.locator('[data-scale=mode] option').allTextContents(),['Multiplier','Yield','Pcs']);assert.equal(await page.locator('[data-scale=mode]').inputValue(),'custom:by-yield');
  await page.locator('[data-scale=mode]').selectOption('custom:by-pcs');assert.equal(await page.locator('[data-scale=target]').inputValue(),'12');await page.locator('[data-scale=target]').fill('24');await page.locator('[data-scale=target]').press('Tab');await page.getByText('200 g',{exact:true}).waitFor();assert.match(await page.locator('#recipe-main').innerText(),/C Flour/);assert.match(await page.locator('#recipe-main').innerText(),/WS/);
  await page.getByRole('button',{name:'Edit recipe',exact:true}).click();assert.equal(await page.locator('[data-ingredient-row] [data-path$=".unit"]').first().evaluate(e=>e.tagName),'SELECT');assert.equal(await page.locator('[data-ingredient-search]').first().inputValue(),'C Flour');
  await page.getByRole('button',{name:'+ Scaling option',exact:true}).click();const third='variants.0.yield.scale_options.2';await page.locator(`[data-path="${third}.label"]`).fill('Trays');await page.locator(`[data-path="${third}.quantity"]`).fill('2');await page.locator(`[data-path="${third}.unit"]`).fill('tray');
  const options=await page.locator('[data-path="variants.0.yield.scale_default"] option').evaluateAll(a=>a.map(n=>n.value));await page.locator('[data-path="variants.0.yield.scale_default"]').selectOption(options.at(-1));
  await page.screenshot({path:join(out,'recipe-custom-scaling.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#recipe-editor')?.inert===false&&document.querySelector('[data-save-status]')?.textContent.startsWith('Saved.'));await page.getByRole('button',{name:'View saved recipe',exact:true}).click();
  await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();assert.equal(await page.locator('[data-scale=target]').inputValue(),'2');assert.equal(await page.locator('[data-scale=mode] option:checked').textContent(),'Trays');
  await page.locator('[data-scale=target]').fill('3');await page.locator('[data-scale=target]').press('Tab');await page.getByText('150 g',{exact:true}).waitFor();assert.equal(await page.locator('[data-saved-cost-card] .recipe-error').count(),0);
 });
 await check('Kitchen Staff receive current linked labels and safe custom scaling while hidden brands stay hidden',async()=>{
  const f=await staffFixture(t.db,{h:t.h,serialize:t.run,dispatch:async(a,p,u)=>(await t.api(u,a,p,true)).result});
  const y=doc.variants[0].yield;const safe=await t.db.query('select tlb.recipe_staff_detail($1,$2,false) result',[recipe.id,recipe.version_id]);
  const text=JSON.stringify(safe.rows[0].result);assert.match(text,/C Flour/);assert.doesNotMatch(text,/Wooden Spoon|"WS"|cost_snapshot|Supplier A/);assert.deepEqual(safe.rows[0].result.document.variants[0].yield.scale_options,y.scale_options);
  await assert.rejects(api('resources',{kind:'ingredient',paginate:true},f.angie),/not permitted|not available|access|Kitchen|permission/i);
 });
 assert.deepEqual(t.errors,[]);console.log(`${checks.length} Recipe Maker acceptance checks passed.`);
}catch(error){if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(join(out,'results.json'),JSON.stringify({checks,errors:t.errors},null,2));await t.close();}
