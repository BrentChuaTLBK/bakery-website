import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';

const harness=await recipeBrowserHarness(),{h,api,pageFor,origin,out,errors}=harness;
const results=[];
const names=['Vanilla','Nutmeg','Salt','Flour'];
const inputQuantities=['1 1/2','1/8','1/2','125.5'];
const units=['tsp','tsp','tsp','g'];
const path=(row,field)=>`[data-path="variants.0.groups.0.ingredients.${row}.${field}"]`;
const quantities=page=>page.locator('.recipe-component-view tbody td.numeric').allTextContents().then(values=>values.map(value=>value.trim()));
async function scale(page,factor){
 await page.locator('[data-scale="target"]').fill(factor);
 await page.locator('[data-scale="target"]').press('Tab');
 await page.waitForFunction(factor=>document.querySelector('.recipe-yield')?.textContent.includes(`Multiplier ×${factor}`),factor);
}
async function save(page){
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#recipe-editor')?.inert===false&&document.querySelector('[data-save-status]')?.textContent.startsWith('Saved.'));
}
try{
 const document=blankRecipe();document.name='QA teaspoon fractions';
 document.variants[0].groups[0].ingredients=names.map((name,index)=>({id:`tsp-${index}`,name,quantity:'1',unit:'g'}));
 document.variants[0].methods[0].steps[0].instruction='Combine the measured ingredients.';
 const original=await api(h.ids.owner,'create',{document,status:'draft'});
 await api(h.ids.owner,'save_access',{user_id:h.ids.staff,permission:'kitchen'});
 const {page,context}=await pageFor(h.ids.owner,390);
 await page.goto(origin+'/recipes.html');
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 for(let index=0;index<names.length;index++){
  const quantity=page.locator(path(index,'quantity'));
  assert.ok(['text',null,''].includes(await quantity.getAttribute('inputmode')),'Recipe quantity fields must allow the slash and space keys on phones.');
  if(index===0){
   assert.equal(await page.locator(path(index,'unit')).locator('option[value="tsp"]').count(),1);
   assert.doesNotMatch(await page.locator(path(index,'unit')).locator('option[value="tsp"]').innerText(),/saved unit/i);
  }
  await quantity.fill(inputQuantities[index]);
  await page.locator(path(index,'unit')).selectOption(units[index]);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#recipe-save-status').selectOption('production');
 await save(page);
 let stored=await api(h.ids.owner,'get',{id:original.id});
 assert.deepEqual(stored.document.variants[0].groups[0].ingredients.map(row=>row.quantity),inputQuantities);
 assert.deepEqual(stored.document.variants[0].groups[0].ingredients.map(row=>row.unit),units);
 results.push('At 390px, tsp is a standard selectable unit and mixed fractions save without losing precision.');

 await page.getByRole('button',{name:'View saved recipe',exact:true}).click();
 assert.deepEqual(await quantities(page),['1 1/2 tsp','1/8 tsp','1/2 tsp','125.5 g']);
 await page.getByRole('button',{name:'Edit recipe',exact:true}).click();
 for(let index=0;index<names.length;index++)assert.equal(await page.locator(path(index,'quantity')).inputValue(),inputQuantities[index]);
 await page.getByRole('button',{name:'View saved recipe',exact:true}).click();
 results.push('Saved fractions reopen unchanged and the recipe reader displays mixed fractions.');

 await scale(page,'2');
 assert.deepEqual(await quantities(page),['3 tsp','1/4 tsp','1 tsp','251 g']);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(out,'teaspoon-fractions-mobile.png'),fullPage:true});
 results.push('Doubling 1/8 tsp displays 1/4 tsp, while gram quantities remain decimal quantities.');

 await page.getByRole('button',{name:'Ingredient totals',exact:true}).click();
 for(const [name,expected] of [['Vanilla','3 tsp'],['Nutmeg','1/4 tsp'],['Salt','1 tsp'],['Flour','251 g']]){
  const row=page.locator('#recipe-dialog-body tbody tr').filter({has:page.getByRole('cell',{name,exact:true})});
  assert.equal((await row.locator('td.numeric').innerText()).trim(),expected);
 }
 await page.locator('[data-dialog-close]').click();
 results.push('Production ingredient totals use the same reduced teaspoon fractions.');

 await page.evaluate(()=>{window.print=()=>{window.teaspoonPrintReady=true;};});
 await page.getByRole('button',{name:'Print / PDF',exact:true}).click();
 await page.locator('#recipe-export-form [name="production"]').check();
 await page.getByRole('button',{name:'Prepare printable recipe',exact:true}).click();
 await page.waitForFunction(()=>window.teaspoonPrintReady===true);
 assert.equal((await page.locator('.recipe-print-root tbody tr').filter({has:page.getByRole('cell',{name:'Nutmeg',exact:true,includeHidden:true})}).locator('td').nth(1).textContent()).trim(),'1/4 tsp');
 await page.evaluate(()=>document.querySelector('.recipe-print-root')?.remove());
 results.push('Printing the current production quantity preserves the reduced fraction.');

 await scale(page,'3');
 assert.deepEqual(await quantities(page),['4 1/2 tsp','3/8 tsp','1 1/2 tsp','376.5 g']);
 await page.evaluate(()=>{
  const createObjectURL=URL.createObjectURL.bind(URL);
  URL.createObjectURL=blob=>{if(blob.type.startsWith('text/csv'))blob.text().then(value=>{window.teaspoonCSV=value;});return createObjectURL(blob);};
 });
 await page.getByRole('button',{name:'Ingredient CSV',exact:true}).click();
 await page.waitForFunction(()=>typeof window.teaspoonCSV==='string');
 const csv=await page.evaluate(()=>window.teaspoonCSV);
 assert.match(csv,/"Vanilla","","4 1\/2","tsp"/);
 assert.match(csv,/"Nutmeg","","3\/8","tsp"/);
 assert.match(csv,/"Salt","","1 1\/2","tsp"/);
 assert.match(csv,/"Flour","","376\.5","g"/);
 results.push('Tripling 1/2 tsp displays 1 1/2 tsp; CSV export contains the same exact mixed fractions.');

 await page.getByRole('button',{name:'Save scaled copy',exact:true}).click();
 const scaledQuantities=['4 1/2','3/8','1 1/2','376.5'];
 for(let index=0;index<names.length;index++)assert.equal(await page.locator(path(index,'quantity')).inputValue(),scaledQuantities[index]);
 await save(page);
 const copies=await api(h.ids.owner,'list',{query:'QA teaspoon fractions'});
 const copy=copies.rows.find(row=>row.id!==original.id);assert.ok(copy);
 const copied=await api(h.ids.owner,'get',{id:copy.id});
 assert.deepEqual(copied.document.variants[0].groups[0].ingredients.map(row=>row.quantity),scaledQuantities);
 stored=await api(h.ids.owner,'get',{id:original.id});
 assert.deepEqual(stored.document.variants[0].groups[0].ingredients.map(row=>row.quantity),inputQuantities);
 results.push('Saving a scaled copy keeps simplified fractions and leaves the original recipe unchanged.');

 await page.getByRole('button',{name:'Back to library',exact:true}).click();
 await page.getByRole('button',{name:'Manage',exact:true}).click();
 await page.getByRole('button',{name:/^Units/}).click();
 assert.equal(await page.getByRole('cell',{name:'tsp',exact:true}).count(),1);
 assert.equal(await page.getByRole('cell',{name:'Teaspoons',exact:true}).count(),1);
 const unitForm=page.locator('[data-add-unit]');
 await unitForm.locator('[name="name"]').fill('Duplicate teaspoons');
 await unitForm.locator('[name="symbol"]').fill(' TSP ');
 const writesBefore=harness.requests.filter(request=>request.action==='save_recipe_unit').length;
 await unitForm.getByRole('button',{name:'Add unit',exact:true}).click();
 await unitForm.getByText('That unit is already available. Choose it in the unit selector.',{exact:true}).waitFor();
 assert.equal(harness.requests.filter(request=>request.action==='save_recipe_unit').length,writesBefore);
 await unitForm.locator('[name="name"]').fill('QA jars');
 await unitForm.locator('[name="symbol"]').fill('jar');
 await unitForm.getByRole('button',{name:'Add unit',exact:true}).click();
 await page.getByRole('cell',{name:'jar',exact:true}).waitFor();
 await page.getByRole('button',{name:'Recipes',exact:true}).click();
 await page.locator('.recipe-card').filter({has:page.getByRole('heading',{name:document.name,exact:true})}).getByRole('button',{name:'Edit',exact:true}).click();
 assert.equal(await page.locator(path(0,'unit')).locator('option[value="jar"]').count(),1);
 assert.equal(await page.locator(path(0,'unit')).locator('option[value="tsp"]').count(),1);
 results.push('Manage → Units lists teaspoons once, rejects duplicate tsp without writing, and preserves custom units.');
 await context.close();

 const kitchen=await pageFor(h.ids.staff,390);
 await kitchen.page.goto(origin+'/recipes.html?view=kitchen');
 await kitchen.page.locator('.recipe-card').filter({has:kitchen.page.getByRole('heading',{name:document.name,exact:true})}).getByRole('button',{name:'Open recipe',exact:true}).click();
 await kitchen.page.getByRole('button',{name:'×2',exact:true}).click();
 assert.deepEqual(await quantities(kitchen.page),['3 tsp','1/4 tsp','1 tsp','251 g']);
 await kitchen.page.getByRole('button',{name:'×3',exact:true}).click();
 assert.deepEqual(await quantities(kitchen.page),['4 1/2 tsp','3/8 tsp','1 1/2 tsp','376.5 g']);
 assert.equal(await kitchen.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await kitchen.context.close();
 results.push('Kitchen staff see the same fraction scaling at phone width.');
 assert.deepEqual(errors,[]);
 console.log(results.map(result=>'PASS '+result).join('\n'));
}finally{
 await writeFile(join(out,'teaspoon-fractions-results.json'),JSON.stringify({results,errors},null,2));
 await harness.close();
}
