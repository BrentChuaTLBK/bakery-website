import assert from 'node:assert/strict';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';

const t=await recipeBrowserHarness(),{api,h,pageFor,origin}=t;
try{
 const document=blankRecipe();document.name='Private print recheck';
 document.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g'}];
 document.variants[0].methods[0].steps[0].instruction='Mix the private formula.';
 const recipe=await api(h.ids.owner,'create',{document,status:'final'});
 await api(h.ids.owner,'save_access',{user_id:h.ids.staff,permission:'chef'});
 const {page,context}=await pageFor(h.ids.staff);
 await context.exposeFunction('restrictPrintRecipe',()=>api(h.ids.owner,'set_visibility',{id:recipe.id,revision:recipe.revision,visibility:'owner'}));
 await page.goto(origin+'/recipes.html');
 await page.getByRole('button',{name:'Open recipe',exact:true}).click();
 await page.evaluate(()=>{
  window.print=()=>{window.privatePrintCalled=true;};
  const original=window.auditRecipeApi;
  window.auditRecipeApi=async(action,payload)=>{
   if(action==='export_authorize'&&payload.version_ids?.length){
    await window.restrictPrintRecipe();window.privatePrintRechecked=true;
   }
   return original(action,payload);
  };
 });
 await page.getByRole('button',{name:'Print / PDF',exact:true}).click();
 await page.getByRole('button',{name:'Prepare printable recipe',exact:true}).click();
 await page.waitForFunction(()=>window.privatePrintRechecked===true&&document.querySelector('.recipe-print-root')===null);
 assert.equal(await page.evaluate(()=>Boolean(window.privatePrintCalled)),false);
 assert.equal(await page.locator('#recipe-print-page-style').count(),0);
 assert.equal((await api(h.ids.owner,'get',{id:recipe.id})).visibility,'owner');
 assert.deepEqual(t.errors,[]);
 console.log('PASS Changing visibility while a Chef prepares a PDF blocks printing and removes prepared private content');
 await context.close();
}finally{await t.close();}
