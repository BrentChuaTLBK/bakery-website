import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';

const t=await recipeBrowserHarness(),owner=t.h.ids.owner;
const api=(action,payload={})=>t.api(owner,action,payload);
const card=(page,id)=>page.locator('.recipe-library .recipe-card').filter({has:page.locator(`[data-action="open"][data-id="${id}"]`)});
function recipe(name){
 const document=blankRecipe();document.name=name;
 document.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g'}];
 document.variants[0].methods[0].steps[0].instruction='Mix gently.';
 return document;
}
async function confirmDelete(page,id){
 await card(page,id).getByRole('button',{name:'Delete',exact:true}).click();
 await page.locator('.site-dialog').getByRole('button',{name:'Delete recipe',exact:true}).click();
}
try{
 const untouched=await api('create',{document:recipe('Keep this reference'),status:'production'});
 const out=join(t.out,'library-delete');await mkdir(out,{recursive:true});
 for(const [width,status] of [[1440,'production'],[390,'draft']]){
  const source=await api('create',{document:recipe(`Delete reference ${width} <original>`),status});
  const history=await api('versions',{id:source.id});
  const {page,context}=await t.pageFor(owner,width);
  await page.goto(t.origin+'/recipes.html');await card(page,source.id).waitFor();
  await card(page,source.id).screenshot({path:join(out,`card-${width}.png`)});
  await card(page,source.id).getByRole('checkbox').check();
  const before=t.requests.filter(r=>r.action==='delete').length;
  await card(page,source.id).getByRole('button',{name:'Delete',exact:true}).click();
  assert.ok((await page.locator('.site-dialog').innerText()).includes(source.document.name));
  await page.locator('.site-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(t.requests.filter(r=>r.action==='delete').length,before);
  assert.equal(await card(page,source.id).count(),1);
  await confirmDelete(page,source.id);
  await card(page,source.id).waitFor({state:'detached'});
  assert.equal(t.requests.filter(r=>r.action==='delete').length,before+1);
  assert.doesNotMatch(await page.locator('.recipe-toolbar').first().innerText(),/selected/);
  const deleted=await api('get',{id:source.id});
  assert.ok(deleted.deleted_at);assert.equal(deleted.version_id,source.version_id);
  assert.deepEqual(deleted.document,source.document);assert.deepEqual(await api('versions',{id:source.id}),history);
  assert.deepEqual((await api('get',{id:untouched.id})).document,untouched.document);
  await page.locator('[data-filter="collection"]').selectOption('deleted');await card(page,source.id).waitFor();
  assert.equal(await card(page,source.id).getByRole('button',{name:'Delete',exact:true}).count(),0);
  await card(page,source.id).getByRole('button',{name:'View deleted recipe',exact:true}).click();
  await page.getByRole('button',{name:'Restore recipe',exact:true}).click();
  await page.getByRole('button',{name:'Restore recipe',exact:true}).waitFor({state:'detached'});
  const restored=await api('get',{id:source.id});
  assert.equal(restored.deleted_at,null);assert.equal(restored.version_id,source.version_id);
  assert.deepEqual(restored.document,source.document);
  await page.locator('[data-action="library"]').click();await page.locator('[data-filter="collection"]').selectOption('');
  await card(page,source.id).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await context.close();
  console.log(`PASS ${width}px: cancel is safe; confirmed deletion removes only the selected recipe; Recently deleted restores its unchanged formula and history.`);
 }
 const guard=await t.pageFor(owner),page=guard.page;
 const component=await api('create',{document:recipe('Linked component reference'),status:'production'});
 const parentDoc=recipe('Parent reference');parentDoc.variants[0].components=[{id:'component',version_id:component.version_id,quantity:'1',mode:'latest'}];
 await api('create',{document:parentDoc,status:'production'});
 await page.goto(t.origin+'/recipes.html');await confirmDelete(page,component.id);
 await page.locator('#recipe-notice').filter({hasText:'Other recipes use this component'}).waitFor();
 assert.equal((await api('get',{id:component.id})).deleted_at,null);
 const stale=await api('create',{document:recipe('Changed reference'),status:'draft'});
 await page.reload();await card(page,stale.id).waitFor();
 const changed=await api('save',{id:stale.id,revision:stale.revision,document:{...stale.document,description:'A newer edit'},status:'draft'});
 await confirmDelete(page,stale.id);
 await page.locator('#recipe-notice').filter({hasText:'This recipe changed'}).waitFor();
 assert.equal((await api('get',{id:stale.id})).revision,changed.revision);
 assert.equal((await api('get',{id:stale.id})).deleted_at,null);
 await guard.context.close();
 console.log('PASS Linked-component and stale-revision protections still block unsafe deletion.');
 for(const [user,permission] of [[t.h.ids.staff,'chef'],[t.h.ids.customer,'kitchen']]){
  await api('save_access',{user_id:user,permission});
  const client=await t.pageFor(user,390);await client.page.goto(t.origin+'/recipes.html');await card(client.page,untouched.id).waitFor();
  assert.equal(await client.page.getByRole('button',{name:'Delete',exact:true}).count(),0);
  await client.context.close();
 }
 console.log('PASS Only the owner sees the library delete action.');
 assert.deepEqual(t.errors,[]);
}finally{await t.close();}
