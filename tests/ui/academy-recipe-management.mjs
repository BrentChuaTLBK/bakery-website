import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {auditHarness} from './academy-audit-harness.mjs';
import {teachingFixture} from '../academy-recipe-management.mjs';
import {unwrapRecipeResult} from '../backend/recipe-staff-fixture.mjs';

const s=await auditHarness(),{db,h,origin,cookie}=s,out='work/academy-recipe-management',results=[];
await mkdir(out,{recursive:true});
const api=(action,p={})=>s.serial(()=>s.api(h.ids.owner,action,p));
const check=async(name,fn)=>{await fn();results.push({name,status:'PASS'});console.log('PASS',name);};
try{
 const document=teachingFixture();
 const source=await s.serial(()=>h.as(h.ids.owner,async()=>unwrapRecipeResult((await db.query('select public.recipe_api($1,$2::jsonb) result',['create',JSON.stringify({document,status:'production'})])).rows[0].result)));
 const admin=await s.pageFor(h.ids.owner),{page}=admin;let recipeId;
 await check('Import the latest component-based editor document and retain source provenance in Academy',async()=>{
  await page.goto(origin+'/academy/admin#recipes');await page.getByRole('button',{name:'Import from Recipe System',exact:true}).click();
  await page.getByRole('button',{name:'Compatibility cake · v1 · Final',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[name=title]')?.value==='Compatibility cake');recipeId=new URL(page.url()).hash.split('/')[1];
  assert.match(await page.locator('.ap-recipe-source-strip').textContent(),/Compatibility cake · v1/);
  assert.equal(await page.locator('[data-editor-path="0.groups.0.ingredients.0.quantity"]').inputValue(),'1/8');
  assert.equal(await page.locator('[data-editor-path="0.baking.0.actual_bottom"]').inputValue(),'155');
  assert.equal(await page.locator('[data-editor-path="0.baking.0.notes"]').inputValue(),'Cool fully before assembling.');
  assert.equal(await page.locator('[data-editor-path="0.baking.1.group_id"] option:checked').textContent(),'Filling');
 });
 await check('Student recipe editing, group removal/undo and preview preserve baking associations and optional fields',async()=>{
  await page.locator('[data-group]').first().getByRole('button',{name:'Remove ingredient group',exact:true}).click();
  assert.equal(await page.locator('[data-editor-path="0.baking.0.group_id"]').inputValue(),'');
  await page.getByRole('button',{name:'Undo removal',exact:true}).click();
  assert.equal(await page.locator('[data-editor-path="0.baking.0.group_id"] option:checked').textContent(),'Cake');
  await page.locator('[data-editor-path="0.baking.0.actual_bottom"]').fill('158');
  await page.getByRole('button',{name:'Preview student recipe',exact:true}).click();
  const preview=page.getByRole('dialog');await preview.locator('.ap-baking-setting').first().waitFor();
  assert.match(await preview.locator('.ap-baking-setting').first().textContent(),/Component: Cake/);
  assert.match(await preview.locator('.ap-baking-setting').first().textContent(),/Actual bottom heat158/);
  assert.match(await preview.locator('.ap-baking-setting').nth(1).textContent(),/Component: Filling/);
  assert.ok(!(await preview.textContent()).includes('group_id'));assert.ok(!(await preview.textContent()).includes('PRIVATE_'));
  await page.screenshot({path:out+'/recipe-preview-desktop.jpg',type:'jpeg',quality:80});
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Save student recipe',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ap-recipe-source-strip')?.textContent.includes('Version 2'));
  const saved=await api('admin_recipe',{id:recipeId});assert.equal(saved.document.variants[0].baking[0].actual_bottom,'158');assert.equal(saved.document.variants[0].baking[0].cooling_minutes,'30');
 });
 await check('Students can read component procedures, baking stages, temperatures and times on a phone',async()=>{
  await api('assign_recipe',{class_id:cookie.id,recipe_id:recipeId});const student=await s.pageFor(h.ids.customer,390);
  await student.page.goto(origin+`/academy/dashboard#recipe/${cookie.id}/${recipeId}`);await student.page.getByRole('heading',{name:'Compatibility cake',exact:true}).waitFor();
  assert.match(await student.page.locator('#recipe-section-3').textContent(),/Component: Filling/);
  const text=await student.page.locator('#recipe-section-4').textContent();for(const value of ['Component: Cake','Actual bottom heat158','Ingredient temperature18','Cooling time (minutes)30','Freezing time (minutes)10','Cool fully before assembling.','Temperature4'])assert.ok(text.includes(value),value);
  assert.ok(!(await student.page.locator('.ap-recipe').textContent()).includes('PRIVATE_'));
  await student.page.locator('#recipe-section-4').scrollIntoViewIfNeeded();assert(await student.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await student.page.screenshot({path:out+'/baking-details-phone.jpg',type:'jpeg',quality:80});await student.context.close();
 });
 await check('Delete confirmation names the affected classes, Cancel keeps the recipe and stale confirmation cannot delete an edited recipe',async()=>{
  await page.goto(origin+'/academy/admin#recipes');await page.locator(`[data-delete-recipe="${recipeId}"]`).click();
  let dialog=page.getByRole('dialog');await dialog.getByText(cookie.name,{exact:true}).waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await api('admin_recipes')).length,1);
  await page.locator(`[data-delete-recipe="${recipeId}"]`).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Delete recipe',exact:true}).waitFor();
  const r=await api('admin_recipe',{id:recipeId});await api('save_recipe',{id:r.id,revision:r.revision,title:r.title,document:r.document});
  await dialog.getByRole('button',{name:'Delete recipe',exact:true}).click();await dialog.getByText('This recipe changed. Reload before deleting.',{exact:true}).waitFor();
  assert.equal((await api('admin_recipes')).length,1);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 });
 await check('Retrying a lost deletion response removes the recipe once and refreshes the list',async()=>{
  await page.locator(`[data-delete-recipe="${recipeId}"]`).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Delete recipe',exact:true}).waitFor();
  admin.failNext('delete_recipe','after');await dialog.getByRole('button',{name:'Delete recipe',exact:true}).click();await dialog.getByText('Connection interrupted. Please retry.',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Delete recipe',exact:true}).click();await page.locator(`[data-delete-recipe="${recipeId}"]`).waitFor({state:'detached'});
  assert.deepEqual(await api('admin_recipes'),[]);assert.equal((await s.serial(()=>db.query("select count(*)::int n from tlb.academy_audit where action='recipe_deleted'"))).rows[0].n,1);
 });
 await check('An unavailable Final-only endpoint shows an error with no historical import choices',async()=>{
  admin.failNext('final_recipes');await page.getByRole('button',{name:'Import from Recipe System',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('alert').filter({hasText:'Connection interrupted. Please retry.'}).waitFor();assert.equal(await dialog.locator('[data-import]').count(),0);
  assert.ok(admin.calls.some(c=>c.action==='final_recipes'));assert.ok(!admin.calls.some(c=>c.action==='production_recipes'));
 });
 assert.deepEqual(s.errors,[]);
}finally{await writeFile(out+'/ui-results.json',JSON.stringify({results,errors:s.errors},null,2));await s.close();}
