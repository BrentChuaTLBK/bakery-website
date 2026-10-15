import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';

const t=await recipeBrowserHarness(),owner=t.h.ids.owner,chef=t.h.ids.staff,kitchen=t.h.ids.customer;
const api=(action,payload={},user=owner)=>t.api(user,action,payload),checks=[];
const document=name=>{const d=blankRecipe();d.name=name;d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Mix gently.';return d;};
const open=async(page,id)=>{await page.locator(`[data-action=open][data-id="${id}"]`).click();await page.locator('.recipe-scale-card').waitFor();};
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
let ownerClient,chefClient,kitchenClient;
try{
 await api('save_access',{user_id:chef,permission:'chef'});await api('save_access',{user_id:kitchen,permission:'kitchen'});
 const staff=(await api('staff_overview',{})).staff.find(p=>p.user_id===kitchen);await api('staff_save',{...staff,mode:'always'});
 let shared=await api('create',{document:document('Visibility shared reference'),status:'final'});
 const fresh=await api('create',{document:document('Visibility second shared recipe'),status:'final'});
 ownerClient=await t.pageFor(owner);const page=ownerClient.page;
 await page.goto(t.origin+'/recipes.html');await open(page,shared.id);
 const out=join(t.out,'owner-visibility');await mkdir(out,{recursive:true});
 await check('Owner can cancel or confirm privacy separately from status, formula and version',async()=>{
  assert.equal(await page.locator('[data-recipe-visibility]').inputValue(),'staff');
  assert.deepEqual(await page.locator('[data-recipe-status] option').allTextContents(),['Draft','R&D','Final','Hidden','Archive']);
  await page.locator('[data-recipe-visibility]').selectOption('owner');await page.getByRole('button',{name:'Apply visibility',exact:true}).click();
  await page.getByRole('heading',{name:'Make this recipe owner only?',exact:true}).waitFor();
  assert.match(await page.locator('.site-dialog').innerText(),/Shared recipes that use it/);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await api('get',{id:shared.id})).visibility,'staff');
  await page.getByRole('button',{name:'Apply visibility',exact:true}).click();await page.getByRole('button',{name:'Make owner only',exact:true}).click();
  await page.locator('[data-recipe-visibility]').filter({has:page.locator('option[value=owner]:checked')}).waitFor();
  const after=await api('get',{id:shared.id});assert.equal(after.visibility,'owner');assert.equal(after.version_id,shared.version_id);assert.equal(after.status,shared.status);assert.deepEqual(after.document,shared.document);shared=after;
  assert.equal(await page.locator('.recipe-toolbar .recipe-visibility-badge').innerText(),'Owner only');
  await page.locator('[data-action=library]').click();await page.locator('.recipe-library').waitFor();assert.equal(await page.locator('.recipe-card').filter({has:page.locator(`[data-action=open][data-id="${shared.id}"]`)}).locator('.recipe-visibility-badge').innerText(),'Owner only');
 });
 await check('New recipes default to Shared with staff; owner can save a private recipe at creation',async()=>{
  await page.getByRole('button',{name:'+ New recipe',exact:true}).click();assert.equal(await page.locator('[data-edit-visibility]').inputValue(),'staff');
  await page.locator('[data-path=name]').fill('Visibility private from creation');await page.locator('[data-edit-visibility]').selectOption('owner');
  await page.locator('[data-path="variants.0.groups.0.ingredients.0.name"]').fill('Flour');await page.locator('[data-path="variants.0.groups.0.ingredients.0.quantity"]').fill('100');
  await page.locator('[data-path="variants.0.methods.0.steps.0.instruction"]').fill('Mix gently.');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Version 1 saved · Draft.',{exact:true}).waitFor();
  const request=t.requests.findLast(r=>r.action==='create'&&r.payload.document?.name==='Visibility private from creation');assert.equal(request.payload.visibility,'owner');assert.equal(request.result.visibility,'owner');
  await page.getByRole('button',{name:'View saved recipe',exact:true}).click();await page.locator('[data-recipe-visibility]').waitFor();assert.equal(await page.locator('[data-recipe-visibility]').inputValue(),'owner');
 });
 await check('Private duplicate and scaled-copy editors preserve source privacy',async()=>{
  await page.getByRole('button',{name:'Duplicate',exact:true}).click();await page.locator('[data-edit-visibility]').waitFor();assert.equal(await page.locator('[data-edit-visibility]').inputValue(),'owner');
  await page.getByRole('button',{name:'View saved recipe',exact:true}).click();await page.getByRole('button',{name:'Save scaled copy',exact:true}).click();
  assert.equal(await page.locator('[data-edit-visibility]').inputValue(),'owner');await page.locator('[data-path=name]').fill('Visibility private scaled copy');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Version 1 saved · Draft.',{exact:true}).waitFor();
  assert.equal(t.requests.findLast(r=>r.action==='create'&&r.payload.document?.name==='Visibility private scaled copy').result.visibility,'owner');
 });
 await check('A new private working draft keeps its visibility through close and recovery',async()=>{
  await page.getByRole('button',{name:'View saved recipe',exact:true}).click();await page.locator('[data-action=library]').click();await page.getByRole('button',{name:'+ New recipe',exact:true}).click();
  await page.locator('[data-path=name]').fill('Visibility recover private draft');await page.locator('[data-edit-visibility]').selectOption('owner');
  await page.locator('[data-path="variants.0.groups.0.ingredients.0.name"]').fill('Flour');await page.locator('[data-path="variants.0.groups.0.ingredients.0.quantity"]').fill('100');await page.locator('[data-path="variants.0.methods.0.steps.0.instruction"]').fill('Mix gently.');
  await page.getByRole('button',{name:'Keep draft & close',exact:true}).click();await page.locator('.recipe-library').waitFor();
  const draft=(await api('drafts',{limit:100})).find(d=>d.document.name==='Visibility recover private draft');assert.equal(draft.visibility,'owner');
  await page.getByRole('button',{name:'Recover working draft',exact:true}).click();await page.locator(`#recipe-dialog [data-action=recover-draft][data-id="${draft.draft_id}"]`).click();
  assert.equal(await page.locator('[data-edit-visibility]').inputValue(),'owner');
  await page.getByRole('button',{name:'Keep draft & close',exact:true}).click();await page.locator('.recipe-library').waitFor();
 });
 await check('Recovering a stale shared draft as a copy preserves its source recipe’s newer owner-only setting',async()=>{
  const source=await api('create',{document:document('Visibility recovery source'),status:'draft'}),draftId=randomUUID();
  await api('autosave',{id:source.id,revision:source.revision,draft_id:draftId,visibility:'staff',document:document('Visibility recovered private copy')});
  await api('set_visibility',{id:source.id,revision:source.revision,visibility:'owner'});
  assert.equal((await api('drafts',{limit:100})).find(d=>d.draft_id===draftId).visibility,'staff');
  await page.getByRole('button',{name:'Recover working draft',exact:true}).click();await page.locator(`#recipe-dialog [data-action=recover-draft][data-id="${draftId}"]`).click();
  await page.getByRole('button',{name:'Recover as new recipe',exact:true}).click();assert.equal(await page.locator('[data-edit-visibility]').inputValue(),'owner');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'View saved recipe',exact:true}).waitFor();
  const created=t.requests.findLast(r=>r.action==='create'&&r.payload.document?.name==='Visibility recovered private copy');assert.equal(created.result.visibility,'owner');assert.notEqual(created.result.id,source.id);
  await page.getByRole('button',{name:'View saved recipe',exact:true}).click();await page.locator('[data-action=library]').click();await page.locator('.recipe-library').waitFor();
 });
 await check('Owner visibility controls remain readable on phone and tablet',async()=>{
  await open(page,shared.id);
  await page.waitForFunction(()=>!document.querySelector('#recipe-notice')?.textContent);
  for(const width of [390,820]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok(await page.locator('[data-recipe-visibility]').evaluate(e=>e.getBoundingClientRect().height>=44));await page.screenshot({path:join(out,`owner-visibility-${width}.png`),fullPage:false});}
  await page.setViewportSize({width:1440,height:1000});
 });
 chefClient=await t.pageFor(chef);kitchenClient=await t.pageFor(kitchen,390,{network:true});
 await check('Chef and Kitchen cannot see owner-only recipes or visibility controls',async()=>{
  for(const client of [chefClient,kitchenClient]){await client.page.goto(t.origin+'/recipes.html');await client.page.locator('.recipe-library').waitFor();assert.equal(await client.page.locator(`[data-action=open][data-id="${shared.id}"]`).count(),0);await open(client.page,fresh.id);assert.equal(await client.page.locator('[data-recipe-visibility],[data-edit-visibility],[data-action=set-visibility]').count(),0);}
  await chefClient.page.getByRole('button',{name:'Edit recipe',exact:true}).click();assert.equal(await chefClient.page.locator('[data-edit-visibility]').count(),0);
  await chefClient.page.getByRole('button',{name:'View saved recipe',exact:true}).click();
 });
 await check('An open Chef formula, dialog and print output clear after privacy revocation without signing out',async()=>{
  const chefPage=chefClient.page;await chefPage.getByRole('button',{name:'View cost details',exact:true}).click();await chefPage.locator('#recipe-dialog[open]').waitFor();
  await chefPage.evaluate(()=>{const print=document.createElement('div');print.className='recipe-print-root';print.textContent='PRIVATE_PRINT_SENTINEL';document.body.append(print);});
  const current=await api('get',{id:fresh.id});await api('set_visibility',{id:fresh.id,revision:current.revision,visibility:'owner'});await chefPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await chefPage.locator('[data-recipe-unavailable]').waitFor();assert.equal(await chefPage.locator('#recipe-dialog[open],.recipe-print-root,.recipe-scale-card').count(),0);assert.doesNotMatch(await chefPage.locator('body').innerText(),/PRIVATE_PRINT_SENTINEL|Visibility second shared recipe/);
  await chefPage.getByRole('button',{name:'Back to recipe library',exact:true}).click();await chefPage.locator('.recipe-library').waitFor();assert.equal(await chefPage.locator(`[data-action=open][data-id="${fresh.id}"]`).count(),0);assert.equal((await api('bootstrap',{},chef)).role,'chef');
 });
 await check('A same-browser visibility change refreshes an idle Chef library and sharing restores authorized access',async()=>{
  await page.locator('[data-recipe-visibility]').selectOption('staff');await page.getByRole('button',{name:'Apply visibility',exact:true}).click();await page.getByRole('button',{name:'Share with staff',exact:true}).click();await page.getByText('Visibility saved · Shared with staff.',{exact:true}).waitFor();
  // Test clients use separate browser profiles. Deliver the same local signal
  // that another tab in the Chef profile receives after a permission change.
  await chefClient.page.evaluate(()=>{const signal=new BroadcastChannel('tlb-recipe-access-changed');signal.postMessage('permissions-changed');signal.close();});
  await chefClient.page.locator(`[data-action=open][data-id="${shared.id}"]`).waitFor();await open(chefClient.page,shared.id);
  const before=t.requests.filter(r=>r.user===chef&&r.action==='list').length;await chefClient.page.locator('[data-action=library]').click();await chefClient.page.locator('.recipe-library').waitFor();assert.ok(t.requests.filter(r=>r.user===chef&&r.action==='list').length>before);
 });
 assert.deepEqual(t.errors,[]);console.log(`Recipe owner visibility UI complete: ${checks.length} checks.`);
}finally{for(const client of [ownerClient,chefClient,kitchenClient])await client?.context.close();await t.close();}
