import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';

export function bakingFixture({advanced=false,multiple=false}={}){
 const document=blankRecipe();document.name=advanced?'Advanced Baking Reference':'Vanilla Celebration Cake';
 document.description='A saved synthetic recipe for local kitchen layout checks.';
 document.private_notes='PRIVATE_COST_NOTE';
 const size=document.variants[0];size.name='7-inch';size.yield={...size.yield,quantity:'1',unit:'cake',portions:'8',pan_size:'7 inch'};
 size.groups=[{id:'original-batter',name:'Original Batter',ingredients:[
  {id:'flour',name:'Cake flour',quantity:'180',unit:'g',cost_snapshot:{amount:'90',quantity:'1000',unit:'g'},supplier_name:'PRIVATE_SUPPLIER'},
  {id:'sugar',name:'Caster sugar',quantity:'160',unit:'g'},
  {id:'eggs',name:'Eggs',quantity:'3',unit:'pcs'},
  {id:'vanilla',name:'Vanilla',quantity:'1 1/2',unit:'tsp'}
 ]}];
 size.methods=[{id:'original-method',group_id:'original-batter',name:'Procedure',steps:[
  {id:'step-1',instruction:'Sift the cake flour and prepare the lined cake pan.'},
  {id:'step-2',instruction:'Whisk the eggs and sugar until pale and thick.'},
  {id:'step-3',instruction:'Fold in the dry ingredients gently, then add the vanilla.'},
  {id:'step-4',instruction:'Pour into the prepared pan and level the batter.'}
 ]}];
 size.baking=[{id:'initial-bake',name:'Bake',top:'165',bottom:'160',minutes:'11'}];
 if(advanced)size.baking=[{...size.baking[0],actual_bottom:'155',fan:'Low',core:'55',ingredient_temperature:'20',batter_temperature:'23',resting_temperature:'24',cooling_minutes:'15',freezing_minutes:'30',notes:'Rotate the pan once. Cool completely before filling.'},{id:'browning',name:'Browning',top:'180',minutes:'3',notes:'Watch the surface colour closely.'}];
 if(multiple){size.groups.push({id:'filling',name:'Vanilla Filling',ingredients:[{id:'cream',name:'Whipping cream',quantity:'250',unit:'g'}]});size.methods.push({id:'filling-method',group_id:'filling',name:'Filling procedure',steps:[{id:'whip',instruction:'Whip the cream until soft peaks form.'}]});}
 size.packaging.description='7-inch cake board and cake box';size.equipment=[{name:'7-inch round cake pan',notes:'Line the base with baking paper.'}];
 return document;
}

const harness=await recipeBrowserHarness(),{api,h,pageFor,origin,errors}=harness;
const out=resolve(import.meta.dirname,'../artifacts/component-baking');await mkdir(out,{recursive:true});
const phase=process.argv.includes('--before')?'before':'after',results=[];
let activePage=null;
async function open(page,name,{edit=false,kitchen=false}={}){
 activePage=page;
 await page.goto(origin+'/recipes.html'+(kitchen?'?view=kitchen':''));
 await page.locator('.recipe-card').filter({has:page.getByRole('heading',{name,exact:true})}).getByRole('button',{name:edit?'Edit':'Open recipe',exact:true}).click();
}
const stageField=(page,index,key)=>page.locator(`[data-path="variants.0.baking.${index}.${key}"]`);
const stageEditor=(page,index)=>page.locator(`[data-baking-stage="${index}"]`);
async function save(page,status='production'){
 await page.locator('#recipe-save-status').selectOption(status);
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#recipe-editor')?.inert===false&&document.querySelector('[data-save-status]')?.textContent.startsWith('Saved.'));
}
async function addField(page,index,key,value){
 const picker=stageEditor(page,index).locator('.recipe-baking-field-picker');
 if(!await picker.evaluate(element=>element.open))await picker.locator('summary').click();
 await picker.locator(`[data-action="add-baking-field"][data-field="${key}"]`).click();
 if(value!==undefined)await stageField(page,index,key).fill(value);
}
async function verifyLayout(page,width){
 const panel=page.locator('[data-component-view="original-batter"]');
 const ingredients=await panel.locator('.recipe-kitchen-ingredients').boundingBox(),procedure=await panel.locator('.recipe-kitchen-methods').boundingBox(),baking=await panel.locator('.recipe-baking-details').boundingBox();
 assert.ok(ingredients&&procedure&&baking,'Ingredients, procedure, and baking must all be visible.');
 if(width>700){
  assert.ok(procedure.x>=ingredients.x+ingredients.width-2,'Desktop procedure must be to the right of ingredients.');
  assert.ok(baking.y>=Math.max(ingredients.y+ingredients.height,procedure.y+procedure.height)-2,'Baking must be below both columns.');
  assert.ok(baking.width>=ingredients.width+procedure.width,'Baking must span both columns.');
 }else{
  assert.ok(procedure.y>=ingredients.y+ingredients.height-2,'Mobile procedure must follow ingredients.');
  assert.ok(baking.y>=procedure.y+procedure.height-2,'Mobile baking must follow procedure.');
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
}
async function afterChecks(basic,advancedDocument){
 const owner=await pageFor(h.ids.owner,1440),page=owner.page;
 await open(page,basic.document.name,{edit:true});
 const basicEditor=page.locator('[data-baking-editor-group="original-batter"]');
 assert.equal(await stageEditor(page,0).locator('input,textarea').count(),4);
 assert.deepEqual(await stageEditor(page,0).locator('.recipe-baking-default-fields input').evaluateAll(inputs=>inputs.map(input=>input.value)),['Bake','165','160','11']);
 await basicEditor.screenshot({path:join(out,'after-editor-desktop.png')});
 await stageEditor(page,0).locator('.recipe-baking-field-picker>summary').click();
 assert.equal(await stageEditor(page,0).locator('[data-action="add-baking-field"]').count(),9);
 await basicEditor.screenshot({path:join(out,'after-editor-add-field.png')});
 await stageEditor(page,0).locator('.recipe-baking-field-picker>summary').click();
 await page.setViewportSize({width:1440,height:2200});
 const fullComponent=page.locator('[data-component-editor="original-batter"]');
 await fullComponent.evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+window.scrollY-120));
 await fullComponent.screenshot({path:join(out,'after-editor-component-1440.png')});
 await page.setViewportSize({width:390,height:1000});
 await basicEditor.screenshot({path:join(out,'after-editor-mobile.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 results.push('Legacy single-component baking opens with four populated/default fields, nine optional choices, and no saved-data rewrite.');
 await page.setViewportSize({width:1440,height:1000});
 await open(page,advancedDocument.name,{edit:true});
 for(const [key,value] of Object.entries(advancedDocument.variants[0].baking[0]))if(!['id','name'].includes(key))assert.equal(await stageField(page,0,key).inputValue(),value);
 assert.equal(await stageEditor(page,0).locator('[data-baking-field]').count(),9);
 assert.equal(await stageEditor(page,1).locator('[data-baking-field]').count(),1);
 assert.deepEqual(await page.locator('[data-path$=".name"]').evaluateAll(inputs=>inputs.filter(input=>/\.baking\.\d+\.name$/.test(input.dataset.path)).map(input=>input.value)),['Bake','Browning']);
 await page.setViewportSize({width:1440,height:1800});
 const advancedEditor=page.locator('[data-baking-editor-group="original-batter"]');
 await advancedEditor.evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+window.scrollY-120));
 await advancedEditor.screenshot({path:join(out,'after-editor-advanced.png')});
 results.push('Existing advanced fields and stage order remain visible and editable; unused optional fields stay absent.');
 await owner.context.close();

 for(const width of [1440,820,390,320]){
  const kitchen=await pageFor(h.ids.staff,width);await open(kitchen.page,basic.document.name,{kitchen:true});
  await verifyLayout(kitchen.page,width);
  const component=kitchen.page.locator('[data-component-view="original-batter"]');
  assert.equal(await kitchen.page.locator('[data-kitchen-panel="baking"]').count(),0);
  assert.equal(await kitchen.page.getByRole('button',{name:'Method',exact:true}).count(),0);
  assert.deepEqual(await component.locator('.recipe-baking-details dt').allTextContents(),['Top heat','Bottom heat setting','Time']);
  assert.doesNotMatch(await kitchen.page.locator('#recipe-main').innerText(),/PRIVATE_COST_NOTE|PRIVATE_SUPPLIER|profitability|Costing/);
  assert.equal(await kitchen.page.getByRole('button',{name:'Edit recipe',exact:true}).count(),0);
  assert.equal(await kitchen.page.getByRole('button',{name:'Print / PDF',exact:true}).count(),0);
  await kitchen.page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await kitchen.page.screenshot({path:join(out,`after-kitchen-${width}.png`),fullPage:true});
  await kitchen.context.close();
  results.push(`Kitchen ${width}px shows ingredients → procedure → baking in one component, populated values only, with no overflow or restricted controls.`);
 }

 const editableDocument=bakingFixture({multiple:true});editableDocument.name='Component Baking Workflow';editableDocument.variants[0].baking=[];
 const editable=await api(h.ids.owner,'create',{document:editableDocument,status:'production'});
 const edit=await pageFor(h.ids.owner,1440),editor=edit.page;
 await open(editor,editableDocument.name,{kitchen:true});
 assert.equal(await editor.locator('.recipe-baking-details').count(),0);
 await open(editor,editableDocument.name,{edit:true});
 const originalEditor=editor.locator('[data-component-editor="original-batter"]');
 assert.equal(await originalEditor.locator('[data-baking-stage]').count(),0);
 await originalEditor.getByRole('button',{name:'+ Add Baking Details',exact:true}).click();
 assert.equal(await stageEditor(editor,0).locator('input,textarea').count(),4);
 for(const [key,value] of Object.entries({name:'Initial Bake',top:'165',bottom:'160',minutes:'11'}))await stageField(editor,0,key).fill(value);
 await stageEditor(editor,0).locator(':scope>summary').click();
 assert.match(await stageEditor(editor,0).locator(':scope>summary').innerText(),/Initial Bake/);
 assert.match(await stageEditor(editor,0).locator(':scope>summary').innerText(),/165°C.*160°C.*11 min/);
 await stageEditor(editor,0).locator(':scope>summary').click();
 assert.equal(await stageField(editor,0,'top').inputValue(),'165');
 await save(editor);
 let saved=await api(h.ids.owner,'get',{id:editable.id});
 assert.equal(saved.document.variants[0].baking[0].group_id,'original-batter');
 assert.equal(saved.document.variants[0].baking[0].minutes,'11');
 results.push('A component without baking shows no kitchen section; adding and saving a default-only stage uses four fields and links to that component.');
 await addField(editor,0,'batter_temperature','23');
 assert.equal(await stageEditor(editor,0).locator('[data-baking-field]').count(),1);
 await addField(editor,0,'core','55');
 assert.equal(await stageEditor(editor,0).locator('[data-baking-field]').count(),2);
 assert.equal(await stageEditor(editor,0).locator('[data-action="add-baking-field"][data-field="core"]').count(),0);
 assert.equal(await stageEditor(editor,0).locator('[data-action="add-baking-field"][data-field="batter_temperature"]').count(),0);
 await addField(editor,0,'fan');
 await save(editor);
 assert.equal(await stageEditor(editor,0).locator('[data-baking-field="fan"]').isVisible(),true);
 assert.equal(await stageField(editor,0,'fan').inputValue(),'');
 assert.equal((await api(h.ids.owner,'get',{id:editable.id})).document.variants[0].baking[0].batter_temperature,'23');
 results.push('Saving a real recipe retains an activated empty optional field in the current editor while saving populated values.');
 await stageEditor(editor,0).locator('[data-action="remove-baking-field"][data-field="fan"]').click();
 assert.equal(await stageEditor(editor,0).locator('[data-baking-field="fan"]').count(),0);
 assert.equal(await editor.locator('.site-dialog[open]').count(),0);
 await save(editor);
 await editor.getByRole('button',{name:'View saved recipe',exact:true}).click();
 await editor.getByRole('button',{name:'Edit recipe',exact:true}).click();
 assert.equal(await stageField(editor,0,'batter_temperature').inputValue(),'23');
 assert.equal(await stageField(editor,0,'core').inputValue(),'55');
 results.push('Optional fields add individually without duplicates, empty fields remove immediately, and populated values survive save/reopen.');
 await stageEditor(editor,0).locator('[data-action="remove-baking-field"][data-field="core"]').click();
 assert.match(await editor.locator('.site-dialog').innerText(),/55|clear|remove/i);
 await editor.locator('.site-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await stageField(editor,0,'core').inputValue(),'55');
 await stageEditor(editor,0).locator('[data-action="remove-baking-field"][data-field="core"]').click();
 await editor.locator('.site-dialog').getByRole('button',{name:'Clear field',exact:true}).click();
 assert.equal(await stageEditor(editor,0).locator('[data-baking-field="core"]').count(),0);
 await addField(editor,0,'core','55');
 results.push('Removing a populated field requires explicit confirmation; cancel preserves it and confirmed removal clears it visibly.');

 await originalEditor.getByRole('button',{name:'+ Stage',exact:true}).click();
 for(const [key,value] of Object.entries({name:'Browning',top:'180',minutes:'3'}))await stageField(editor,1,key).fill(value);
 await addField(editor,1,'notes','Watch the surface colour closely.');
 assert.equal(await stageEditor(editor,1).locator('[data-baking-field="core"]').count(),0);
 await stageEditor(editor,1).locator('[data-action="move-stage"][data-direction="-1"]').click();
 assert.equal(await stageField(editor,0,'name').inputValue(),'Browning');
 assert.equal(await stageField(editor,1,'name').inputValue(),'Initial Bake');
 await originalEditor.getByRole('button',{name:'+ Stage',exact:true}).click();
 await stageField(editor,2,'top').fill('100');
 await stageEditor(editor,2).getByRole('button',{name:'Remove stage',exact:true}).click();
 await editor.locator('.site-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await stageField(editor,2,'top').inputValue(),'100');
 await stageEditor(editor,2).getByRole('button',{name:'Remove stage',exact:true}).click();
 await editor.locator('.site-dialog').getByRole('button',{name:'Remove stage',exact:true}).click();
 assert.equal(await originalEditor.locator('[data-baking-stage]').count(),2);
 await originalEditor.locator('[data-action="duplicate-group"]').click();
 const components=editor.locator('[data-component-editor]');assert.equal(await components.count(),3);
 const copiedGroupId=await components.evaluateAll(nodes=>nodes.find(node=>!['original-batter','filling'].includes(node.dataset.componentEditor)).dataset.componentEditor);
 const copiedEditor=editor.locator(`[data-component-editor="${copiedGroupId}"]`);
 assert.equal(await copiedEditor.locator('[data-baking-stage]').count(),2);
 const copiedStageIndex=Number(await copiedEditor.locator('[data-baking-stage]').first().getAttribute('data-baking-stage'));
 await stageField(editor,copiedStageIndex,'top').fill('190');
 assert.equal(await stageField(editor,0,'top').inputValue(),'180');
 await save(editor);
 saved=await api(h.ids.owner,'get',{id:editable.id});
 const published=structuredClone(saved),publishedStages=saved.document.variants[0].baking;
 assert.deepEqual(publishedStages.filter(stage=>stage.group_id==='original-batter').map(stage=>stage.name),['Browning','Initial Bake']);
 assert.equal(publishedStages.find(stage=>stage.group_id===copiedGroupId).top,'190');
 assert.equal(new Set(publishedStages.map(stage=>stage.id)).size,publishedStages.length);
 await editor.getByRole('button',{name:'View saved recipe',exact:true}).click();
 await editor.getByRole('button',{name:'Edit recipe',exact:true}).click();
 assert.equal(await stageField(editor,0,'name').inputValue(),'Browning');
 assert.equal(await stageField(editor,copiedStageIndex,'top').inputValue(),'190');
 results.push('Multiple stages keep independent fields, reorder and remove correctly; a duplicated component gets independent copied stages that persist after reload.');
 await editor.getByRole('button',{name:'View saved recipe',exact:true}).click();
 await editor.locator('[data-scale="target"]').fill('2');await editor.locator('[data-scale="target"]').press('Tab');
 await editor.evaluate(()=>{window.print=()=>{window.componentBakingPrintReady=true;};});
 await editor.getByRole('button',{name:'Print / PDF',exact:true}).click();
 await editor.locator('#recipe-export-form [name="production"]').check();
 await editor.getByRole('button',{name:'Prepare printable recipe',exact:true}).click();
 await editor.waitForFunction(()=>window.componentBakingPrintReady===true);
 const printed=editor.locator('.recipe-print-root [data-print-component="Original Batter"]');
 assert.equal(await printed.locator('.recipe-baking-stage').count(),2);
 assert.match(await printed.textContent(),/360 g/);assert.match(await printed.textContent(),/180/);assert.doesNotMatch(await printed.textContent(),/195/);
 assert.deepEqual(await printed.locator('.recipe-baking-stage h5').allTextContents(),['Browning','Initial Bake']);
 results.push('Printable production recipes keep baking stages with their component and leave temperatures and times unchanged at 2×.');
 await edit.context.close();

 for(const width of [1440,390]){
  const kitchen=await pageFor(h.ids.staff,width),view=kitchen.page;await open(view,editableDocument.name,{kitchen:true});
  const component=view.locator('[data-component-view="original-batter"]');
  assert.deepEqual(await component.locator('.recipe-baking-stage h4').allTextContents(),['Browning','Initial Bake']);
  const bakingText=await component.locator('.recipe-baking-details').innerText();
  assert.doesNotMatch(bakingText,/Actual bottom|Fan setting|Ingredient temperature|Resting temperature|Cooling time|Freezing time/);
  await view.locator('[data-check="flour"]').check();await view.locator('[data-check="step-1"]').check();
  await view.getByRole('button',{name:'×2',exact:true}).click();
  assert.equal(await component.locator('tbody td.numeric').first().innerText(),'360 g');
  assert.equal(await component.locator('.recipe-baking-details').innerText(),bakingText);
  if(width>700){await view.getByRole('button',{name:'Vanilla Filling',exact:true}).click();await view.getByRole('button',{name:'Original Batter',exact:true}).click();}
  else{await view.locator('[data-kitchen-section]').selectOption('component:filling');assert.equal(await view.locator('[data-component-view="filling"] .recipe-baking-details').count(),0);await view.locator('[data-kitchen-section]').selectOption('component:original-batter');}
  assert.equal(await view.locator('[data-check="flour"]').isChecked(),true);assert.equal(await view.locator('[data-check="step-1"]').isChecked(),true);
  await view.reload();await view.locator('.recipe-card').filter({has:view.getByRole('heading',{name:editableDocument.name,exact:true})}).getByRole('button',{name:'Open recipe',exact:true}).click();
  assert.equal(await view.locator('[data-check="flour"]').isChecked(),true);
  assert.equal(await view.locator('[data-scale=target]').isVisible(),true);
  const rounding=view.locator('.recipe-kitchen-adjustments');if(!await rounding.evaluate(element=>element.open))await rounding.locator('summary').first().click();
  await view.getByRole('button',{name:'Reset checkoffs',exact:true}).click();
  assert.equal(await view.locator('[data-check="flour"]').isChecked(),false);assert.equal(await view.locator('[data-check="step-1"]').isChecked(),false);
  await view.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await view.screenshot({path:join(out,`after-kitchen-multiple-${width}.png`),fullPage:true});
  if(width>700)await view.getByRole('button',{name:'Packaging & Special Equipment',exact:true}).click();else await view.locator('[data-kitchen-section]').selectOption('packaging');
  assert.match(await view.locator('[data-kitchen-panel="packaging"]').innerText(),/7-inch cake board and cake box/);
  await kitchen.context.close();
  results.push(`Kitchen ${width}px preserves stage order, unchanged bake settings at 2×, checkoffs through section switching/reload/reset, and packaging.`);
 }

 const history=await pageFor(h.ids.owner,1440),historyPage=history.page;await open(historyPage,editableDocument.name,{edit:true});
 await stageField(historyPage,0,'top').fill('195');await save(historyPage,'draft');
 const draft=await api(h.ids.owner,'get',{id:editable.id});
 assert.equal(draft.document.variants[0].baking[0].top,'195');
 assert.equal((await api(h.ids.staff,'get',{id:editable.id})).version_id,published.version_id);
 assert.deepEqual((await api(h.ids.owner,'get',{id:editable.id,version_id:published.version_id})).document,published.document);
 await historyPage.getByRole('button',{name:'View saved recipe',exact:true}).click();
 await historyPage.getByRole('button',{name:'Version history',exact:true}).click();
 await historyPage.locator(`[data-action="compare-version"][data-version="${published.version_id}"]`).click();
 assert.match(await historyPage.locator('#recipe-dialog-body').innerText(),/baking\.0\.top/);
 assert.match(await historyPage.locator('#recipe-dialog-body').innerText(),/180/);assert.match(await historyPage.locator('#recipe-dialog-body').innerText(),/195/);
 await historyPage.locator('[data-dialog-close]').click();
 await historyPage.getByRole('button',{name:'Version history',exact:true}).click();
 await historyPage.locator(`[data-action="restore-version"][data-version="${published.version_id}"]`).click();
 await historyPage.locator('.site-dialog').getByRole('button',{name:'Restore as draft',exact:true}).click();
 await historyPage.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();
 const restored=await api(h.ids.owner,'get',{id:editable.id});
 assert.deepEqual(restored.document.variants[0].baking,publishedStages);
 assert.equal((await api(h.ids.staff,'get',{id:editable.id})).version_id,published.version_id);
 results.push('Draft edits, version comparison and restoration preserve the old Final baking instructions and staff version.');
 await historyPage.getByRole('button',{name:'New test',exact:true}).click();
 await stageField(historyPage,0,'top').fill('200');
 await historyPage.locator('[data-test-field="observations"]').fill('Test the browning finish without changing the Final recipe.');
 await historyPage.getByRole('button',{name:'Save test',exact:true}).click();
 await historyPage.waitForFunction(()=>document.querySelector('[data-save-status]')?.textContent.startsWith('Saved test.'));
 await historyPage.getByRole('button',{name:'Back to recipe',exact:true}).click();
 await historyPage.getByRole('button',{name:'Testing / R&D',exact:true}).click();
 await historyPage.getByRole('button',{name:'View / edit',exact:true}).click();
 assert.equal(await stageField(historyPage,0,'top').inputValue(),'200');
 assert.equal((await api(h.ids.owner,'get',{id:editable.id})).document.variants[0].baking[0].top,'180');
 await historyPage.getByRole('button',{name:'Back to recipe',exact:true}).click();
 await historyPage.getByRole('button',{name:'Duplicate',exact:true}).click();
 assert.equal(await stageField(historyPage,0,'top').inputValue(),'180');
 const duplicateRecipe=(await api(h.ids.owner,'list',{query:editableDocument.name})).rows.find(row=>row.id!==editable.id);
 assert.ok(duplicateRecipe);assert.deepEqual((await api(h.ids.owner,'get',{id:duplicateRecipe.id})).document.variants[0].baking.map(({group_id,id,...stage})=>stage),publishedStages.map(({group_id,id,...stage})=>stage));
 await history.context.close();
 results.push('R&D baking changes save/reopen separately from Final recipes, and recipe duplication preserves all baking values.');

 const legacyDoc=bakingFixture({advanced:true,multiple:true});legacyDoc.name='Unassigned Legacy Baking';
 const legacy=await api(h.ids.owner,'create',{document:legacyDoc,status:'production'});
 const legacyUI=await pageFor(h.ids.owner,1440);await open(legacyUI.page,legacyDoc.name,{edit:true});
 const fallback=legacyUI.page.locator('[data-baking-editor-group=""]');
 assert.equal(await fallback.locator('[data-baking-stage]').count(),2);assert.match(await fallback.innerText(),/preserved|Assign each stage/i);
 assert.equal(await legacyUI.page.locator('[data-component-editor] [data-baking-stage]').count(),0);
 await legacyUI.page.locator('[data-baking-stage="0"] .recipe-baking-assignment>summary').click();
 await legacyUI.page.locator('[data-baking-group="0"]').selectOption('original-batter');
 await save(legacyUI.page,'draft');
 const assigned=await api(h.ids.owner,'get',{id:legacy.id});
 assert.equal(assigned.document.variants[0].baking[0].group_id,'original-batter');
 assert.deepEqual(Object.fromEntries(Object.entries(assigned.document.variants[0].baking[0]).filter(([key])=>key!=='group_id')),legacy.document.variants[0].baking[0]);
 assert.deepEqual((await api(h.ids.owner,'get',{id:legacy.id,version_id:legacy.version_id})).document,legacy.document);
 await legacyUI.context.close();
 const legacyKitchen=await pageFor(h.ids.staff,390);await open(legacyKitchen.page,legacyDoc.name,{kitchen:true});
 assert.equal(await legacyKitchen.page.locator('[data-component-view] .recipe-baking-details').count(),0);
 await legacyKitchen.page.locator('[data-kitchen-section]').selectOption('unassigned-baking');
 assert.match(await legacyKitchen.page.locator('[data-kitchen-panel="unassigned-baking"]').innerText(),/23|55|Browning/);
 await legacyKitchen.context.close();
 results.push('Ambiguous legacy instructions remain unassigned and readable; explicit draft assignment preserves every value and historical Final data.');
 const safe=await api(h.ids.staff,'get',{id:editable.id});
 assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_COST_NOTE|PRIVATE_SUPPLIER|cost_snapshot|supplier_name/);
 assert.deepEqual(safe.document.variants[0].baking,publishedStages);
 assert.deepEqual((await api(h.ids.owner,'get',{id:basic.id})).document,basic.document);
 results.push('Staff receive authorized baking data without costs, suppliers or private notes; screenshot-only legacy recipes remain unchanged.');
}
try{
 const basicDocument=bakingFixture(),advancedDocument=bakingFixture({advanced:true});
 const basic=await api(h.ids.owner,'create',{document:basicDocument,status:'production'});
 await api(h.ids.owner,'create',{document:advancedDocument,status:'production'});
 await api(h.ids.owner,'save_access',{user_id:h.ids.staff,permission:'kitchen'});
 if(phase==='before'){
  const owner=await pageFor(h.ids.owner,1440);await open(owner.page,basicDocument.name,{edit:true});
  const baking=owner.page.locator('.recipe-optional').filter({has:owner.page.getByRole('heading',{name:'Baking & temperature stages',exact:true})});
  assert.equal(await baking.locator('input,textarea').count(),13);
  await baking.screenshot({path:join(out,'before-editor-desktop.png')});
  await owner.page.setViewportSize({width:390,height:1000});
  await baking.screenshot({path:join(out,'before-editor-mobile.png')});
  await owner.context.close();
  for(const width of [1440,390]){
   const kitchen=await pageFor(h.ids.staff,width);await open(kitchen.page,basicDocument.name,{kitchen:true});
   assert.equal(await kitchen.page.locator('[data-kitchen-panel="baking"]').isVisible(),false);
   await kitchen.page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
   await kitchen.page.screenshot({path:join(out,`before-kitchen-${width}.png`),fullPage:true});
   if(width===390){
    assert.equal(await kitchen.page.locator('.recipe-kitchen-methods:visible').count(),0);
    await kitchen.page.getByRole('button',{name:'Method',exact:true}).click();
    await kitchen.page.screenshot({path:join(out,'before-kitchen-mobile-method.png'),fullPage:true});
    await kitchen.page.locator('[data-kitchen-section]').selectOption('baking');
   }else await kitchen.page.getByRole('button',{name:'Baking & temperature settings',exact:true}).click();
   await kitchen.page.screenshot({path:join(out,`before-kitchen-baking-${width}.png`),fullPage:true});
   await kitchen.context.close();
  }
  assert.deepEqual((await api(h.ids.owner,'get',{id:basic.id})).document,basic.document);
  await writeFile(join(out,'baseline-fixtures.json'),JSON.stringify({basic:basicDocument,advanced:advancedDocument,viewports:[1440,390]},null,2));
  results.push('Captured original desktop/mobile editor and kitchen component, method, and separate baking views from locally saved recipes.');
 }else await afterChecks(basic,advancedDocument);
 assert.deepEqual(errors,[]);
 console.log(results.map(result=>'PASS '+result).join('\n'));
}catch(error){
 if(activePage&&!activePage.isClosed())await activePage.screenshot({path:join(out,`${phase}-failure.png`),fullPage:true}).catch(()=>{});
 throw error;
}finally{
 await writeFile(join(out,`${phase}-results.json`),JSON.stringify({results,errors},null,2));
 await harness.close();
}
