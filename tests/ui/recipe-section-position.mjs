import assert from 'node:assert/strict';
import {blankRecipe,group,method} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
const t=await recipeBrowserHarness(),{owner,staff}=t.h.ids;
const api=(action,payload={})=>t.api(owner,action,payload);
try{
 const doc=blankRecipe();doc.name='Section position fixture';
 const v=doc.variants[0];v.groups=[];v.methods=[];
 for(const [name,count] of [['Coconut Chiffon',18],['Coconut Cream Cheese Mousse',16],['Neutral Glaze',1]]){
  const g=group(name);g.ingredients[0].name='Sugar';g.ingredients[0].quantity='100';v.groups.push(g);
  const m=method(g.id);m.steps=Array.from({length:count},(_,i)=>({id:g.id+'-'+i,instruction:'Mix the ingredients gently, then check the texture before continuing.'}));v.methods.push(m);
 }
 const assembly=method();assembly.name='Assembly';assembly.steps=Array.from({length:15},(_,i)=>({id:'assembly-'+i,instruction:'Layer the cake and filling evenly, then chill before decorating.'}));v.methods.push(assembly);
 v.packaging.description='Cake box and board';
 const recipe=await api('create',{document:doc,status:'final'});
 await api('save_access',{user_id:staff,permission:'kitchen'});
 for(const [user,width] of [[staff,390],[staff,320],[staff,1440],[owner,1440]]){
  const {page,context}=await t.pageFor(user,width,width<700?{isMobile:true,hasTouch:true}:{});
  await page.goto(t.origin+'/recipes.html?view=kitchen');
  await page.locator(`[data-action=open][data-id="${recipe.id}"]`).click();
  const nav=page.locator('.recipe-kitchen-nav');
  await nav.waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await nav.evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-150));
  const position=()=>nav.evaluate(el=>({y:scrollY,top:el.getBoundingClientRect().top,focus:document.activeElement?.outerHTML.slice(0,100)}));
  const stable=async(action,label)=>{
   const before=await position();await action();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const after=await position();
   assert.ok(Math.abs(after.y-before.y)<=1&&Math.abs(after.top-before.top)<=1,`${user===owner?'owner':'staff'} ${width}px ${label}: ${JSON.stringify({before,after})}`);
   assert.equal(await page.locator('[data-kitchen-panel]:visible').count(),1);
  };
  const choose=async name=>{
   const title=name.replace(/^\d+\. /,'');
   if(width<700)await page.locator('[data-kitchen-section]').selectOption({label:name});
   else{
    const button=nav.getByRole('button',{name:title,exact:true}),box=await button.boundingBox();
    assert.equal(await button.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),true,'The site header does not cover the component controls');
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
   }
   assert.equal(await page.locator('[data-kitchen-panel]:visible h2').first().textContent(),title);
  };
  if(width<700){
   await stable(()=>page.getByRole('button',{name:'Next section',exact:true}).tap(),'next component');
   await stable(()=>page.locator('[data-kitchen-section]').selectOption('component:'+v.groups[2].id),'short component dropdown');
   await stable(()=>page.getByRole('button',{name:'Next section',exact:true}).tap(),'assembly');
   await stable(()=>page.getByRole('button',{name:'Previous section',exact:true}).tap(),'previous component');
  }else{
   for(const name of ['2. Coconut Cream Cheese Mousse','3. Neutral Glaze','4. Assembly','1. Coconut Chiffon']){
    await stable(()=>choose(name),name);
   }
  }
  await stable(()=>choose('1. Coconut Chiffon'),'return to first component');
  const check=page.locator('[data-kitchen-panel]:visible [data-check]').first();await check.check();
  await nav.evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY+300));
  await stable(()=>choose('3. Neutral Glaze'),'sticky navigation to short component');
  await stable(()=>choose('4. Assembly'),'sticky navigation to assembly');
  await stable(()=>choose('5. Packaging & Special Equipment'),'sticky navigation to packaging');
  await stable(()=>choose('1. Coconut Chiffon'),'sticky navigation back');
  assert.equal(await check.isChecked(),true,'Section switching preserves checkoffs');
  if(width>700){
   const assemblyButton=nav.getByRole('button',{name:'Assembly',exact:true});await assemblyButton.focus();
   await stable(()=>assemblyButton.press('Enter'),'keyboard section switching');
   assert.equal(await assemblyButton.evaluate(el=>document.activeElement===el),true,'Focus stays on the navigation control');
  }
  await context.close();
 }
 assert.deepEqual(t.errors,[]);
 assert.deepEqual((await api('get',{id:recipe.id})).document,recipe.document);
 console.log('PASS Component and assembly navigation keeps the viewport and controls in place on mobile and desktop without changing the saved recipe.');
}finally{await t.close();}
