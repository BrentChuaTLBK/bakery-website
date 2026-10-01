import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
const t=await recipeBrowserHarness(),{api,h,pageFor,origin}=t,results=[];
const payload='row" onfocus="window.auditIdentifierExecuted=true';
try{
 const d=blankRecipe();d.name='QA escaped recipe';d.description='<img src=x onerror="window.auditTextExecuted=true">';const v=d.variants[0];v.id='size" onclick="window.auditVariantExecuted=true';v.groups[0].ingredients[0]={id:payload,name:'Flour <b>literal</b>',quantity:'1',unit:'g'};v.methods[0].steps[0].instruction='<img src=x onerror="window.auditTextExecuted=true"> Mix.';
 d.photos=[{id:'photo" onfocus="window.auditPhotoExecuted=true',file_id:'file" onclick="window.auditFileExecuted=true',caption:'Literal <caption>'}];
 const saved=await api(h.ids.owner,'create',{document:d,status:'final'}),{page,context}=await pageFor(h.ids.owner);
 await page.goto(origin+'/recipes.html');await page.getByRole('button',{name:'Open recipe',exact:true}).click();await page.locator('[data-check]').first().focus();
 assert.equal(await page.locator('[data-check]').first().getAttribute('data-check'),payload);assert.equal(await page.locator('[onfocus],[onclick],[onerror]').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.auditIdentifierExecuted||window.auditTextExecuted)),false);
 await page.getByRole('button',{name:'Edit recipe',exact:true}).click();await page.locator('[data-photo-caption]').focus();assert.equal(await page.locator('[onfocus],[onclick],[onerror]').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.auditPhotoExecuted||window.auditFileExecuted)),false);
 results.push('Saved row IDs, photo IDs, file references, ingredient text and procedures render as data without event attributes');
 await page.locator('[data-action=library]').click();await page.getByRole('button',{name:'+ New recipe',exact:true}).click();await page.locator('summary').filter({hasText:'Reuse a saved component recipe'}).click();await page.getByRole('button',{name:'+ Link recipe',exact:true}).click();await page.getByRole('button',{name:'Link',exact:true}).click();await page.getByRole('button',{name:'Use size',exact:true}).waitFor();assert.equal(await page.locator('[onclick]').count(),0);assert.equal(await page.getByRole('button',{name:'Use size',exact:true}).getAttribute('data-variant'),v.id);await page.getByRole('button',{name:'Use size',exact:true}).click();assert.equal(await page.evaluate(()=>Boolean(window.auditVariantExecuted)),false);
 results.push('Saved component size identifiers cannot inject click handlers in the component picker');
 await context.close();
 const legacy=blankRecipe();legacy.name='QA legacy step checkoffs';legacy.variants[0].groups[0].ingredients[0]={id:'flour',name:'Flour',quantity:'10',unit:'g'};legacy.variants[0].methods=[{name:'Mix',steps:[{instruction:'First legacy step.'},{instruction:'Second legacy step.'}]}];
 await api(h.ids.owner,'create',{document:legacy,status:'final'});const k=await pageFor(h.ids.owner);await k.page.goto(origin+'/recipes.html');await k.page.locator('.recipe-card').filter({hasText:'QA legacy step checkoffs'}).getByRole('button',{name:'Open recipe',exact:true}).click();const checks=k.page.locator('.recipe-procedure-view [data-check]');await checks.first().check();assert.equal(await checks.last().isChecked(),false);await k.page.reload();await k.page.locator('.recipe-card').filter({hasText:'QA legacy step checkoffs'}).getByRole('button',{name:'Open recipe',exact:true}).click();assert.equal(await checks.first().isChecked(),true);await k.page.getByRole('button',{name:'Reset checkoffs',exact:true}).click();assert.equal(await checks.first().isChecked(),false);assert.equal(await checks.last().isChecked(),false);
 results.push('Legacy steps without IDs have independent checkoffs that survive refresh and reset correctly');
 assert.deepEqual(t.errors,[]);await writeFile(join(t.out,'security-results.json'),JSON.stringify(results,null,2));for(const name of results)console.log('PASS '+name);
}finally{await t.close();}
