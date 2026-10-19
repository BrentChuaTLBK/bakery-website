import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {blankRecipe,variant} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';

const harness=await recipeBrowserHarness(),{h,api,pageFor,origin,out,errors}=harness;
const results=[];
const fixtures=[
 {name:'Basic batch',yield:{quantity:'1',unit:'batch'},options:['multiplier','yield'],targets:{multiplier:'2',yield:'2'}},
 {name:'Count yield',yield:{quantity:'12',unit:'pcs'},options:['multiplier','yield','pieces'],targets:{multiplier:'2',yield:'24',pieces:'24'}},
 {name:'Full yield details',yield:{quantity:'2',unit:'batch',portions:'12',portion_weight:'50',batch_weight:'600',pans:'2'},options:['multiplier','yield','pieces','portions','portion','weight','pans'],targets:{multiplier:'2',yield:'4',pieces:'24',portions:'24',portion:'100',weight:'1200',pans:'4'}},
 {name:'Custom production',yield:{quantity:'1',unit:'cake',scale_options:[{id:'boxes',label:'Boxes',quantity:'2',unit:'boxes'},{id:'trays',label:'Trays',quantity:'3',unit:'trays'}],scale_default:'custom:trays'},options:['multiplier','custom:boxes','custom:trays'],targets:{multiplier:'2','custom:boxes':'4','custom:trays':'6'},defaultMode:'custom:trays',defaultTarget:'3'},
 {name:'Zero optional details',yield:{quantity:'1',unit:'batch',portions:'0',portion_weight:'0',batch_weight:'0',pans:'0'},options:['multiplier','yield'],targets:{multiplier:'2',yield:'2'}}
];
const displayedQuantities=page=>page.locator('.recipe-component-view tbody td.numeric').allTextContents().then(values=>values.map(value=>value.trim()));
async function showControls(page){
 const controls=page.locator('.recipe-kitchen-production');
 if(await controls.count()&&!await controls.evaluate(element=>element.open))await controls.locator('summary').first().click();
}
async function selectSize(page,index){
 await showControls(page);
 await page.locator('[data-view-variant]').selectOption(String(index));
 await showControls(page);
 const fixture=fixtures[index];
 assert.deepEqual(await page.locator('[data-scale="mode"] option').evaluateAll(options=>options.map(option=>option.value)),fixture.options,`${fixture.name}: available modes`);
 assert.equal(await page.locator('[data-scale="mode"]').inputValue(),fixture.defaultMode||'multiplier',`${fixture.name}: initial mode`);
 assert.equal(await page.locator('[data-scale="target"]').inputValue(),fixture.defaultTarget||'1',`${fixture.name}: initial target`);
 assert.deepEqual(await displayedQuantities(page),['100 g','1/8 tsp'],`${fixture.name}: initial formula`);
}
async function checkMode(page,mode,target){
 await page.locator('[data-scale="mode"]').selectOption(mode);
 await page.locator('[data-scale="target"]').fill(target);
 await page.locator('[data-scale="target"]').press('Tab');
 await page.waitForFunction(()=>document.querySelector('.recipe-yield')?.textContent.includes('Multiplier ×2'));
 assert.deepEqual(await displayedQuantities(page),['200 g','1/4 tsp']);
 assert.equal(await page.locator('.recipe-scale-card .recipe-error').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
}
try{
 const document=blankRecipe();document.name='QA usable scaling options';
 document.variants=fixtures.map((fixture,index)=>{
  const size=variant(fixture.name);size.yield={...size.yield,...fixture.yield};
  size.groups[0].ingredients=[{id:`flour-${index}`,name:'Flour',quantity:'100',unit:'g'},{id:`salt-${index}`,name:'Salt',quantity:'1/8',unit:'tsp'}];
  size.methods[0].steps[0].instruction='Combine the measured ingredients.';
  return size;
 });
 const record=await api(h.ids.owner,'create',{document,status:'production'});
 const original=structuredClone(record.document);
 await api(h.ids.owner,'save_access',{user_id:h.ids.staff,permission:'kitchen'});
 for(const [role,user,route] of [['Owner',h.ids.owner,'/recipes.html'],['Kitchen',h.ids.staff,'/recipes.html?view=kitchen']]){
  const {page,context}=await pageFor(user,390);
  await page.goto(origin+route);
  await page.getByRole('button',{name:'Open recipe',exact:true}).click();
  for(let index=0;index<fixtures.length;index++){
   await selectSize(page,index);
   for(const [mode,target] of Object.entries(fixtures[index].targets))await checkMode(page,mode,target);
   results.push(`${role} at 390px: ${fixtures[index].name} offers only usable modes; every offered mode scales correctly.`);
  }
  await selectSize(page,3);
  assert.deepEqual(await page.locator('[data-scale="mode"] option').allTextContents(),['Multiplier','Boxes','Trays']);
  await checkMode(page,'custom:trays','6');
  await selectSize(page,0);
  await checkMode(page,'yield','2');
  results.push(`${role}: switching between custom and basic sizes resets to a valid default without carrying over the previous mode or quantity.`);
  await page.locator('[data-scale="target"]').fill('0');
  await page.locator('[data-scale="target"]').press('Tab');
  await page.locator('.recipe-scale-card .recipe-error').waitFor();
  assert.match(await page.locator('.recipe-scale-card .recipe-error').innerText(),/greater than zero/);
  assert.equal(await page.locator('[data-scale="mode"]').inputValue(),'yield');
  assert.equal(await page.locator('[data-scale="target"]').inputValue(),'0');
  assert.equal(await page.locator('.recipe-component-view:visible').count(),0);
  await checkMode(page,'yield','2');
  results.push(`${role}: a zero target keeps the selected mode and displays validation instead of silently resetting to a base batch.`);
  await context.close();
 }
 const after=await api(h.ids.owner,'get',{id:record.id});
 assert.deepEqual(after.document,original);
 assert.equal(after.version,record.version);
 assert.deepEqual(errors,[]);
 results.push('Temporary scaling and size changes preserve the saved recipe document and version.');
 console.log(results.map(result=>'PASS '+result).join('\n'));
}finally{
 await writeFile(join(out,'scaling-options-results.json'),JSON.stringify({results,errors},null,2));
 await harness.close();
}
