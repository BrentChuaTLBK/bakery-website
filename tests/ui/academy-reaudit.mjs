import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {auditHarness} from './academy-audit-harness.mjs';
const s=await auditHarness(),{h,api,cookie,cupcake,origin}=s,results=[],out='work/academy-reaudit/expanded';await mkdir(out,{recursive:true});
const check=async(name,fn)=>{try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){results.push({name,status:'FAIL',error:e.message});console.log('FAIL',name,e.message.split('\n')[0]);}};
try{
 for(let i=0;i<26;i++){const post=await api(h.ids.customer,'draft_submission',{class_id:cookie.id,title:'Cake '+i,category:'Cakes',visibility:'gallery'});await s.upload(h.ids.customer,{purpose:'submission',submission_id:post.id});await api(h.ids.customer,'submit_work',{id:post.id});await api(h.ids.owner,'moderate',{id:post.id,status:'approved'});}
 const post=await api(h.ids.stranger,'draft_submission',{class_id:cupcake.id,title:'One cookie',category:'Cookies',visibility:'gallery'});await s.upload(h.ids.stranger,{purpose:'submission',submission_id:post.id});await api(h.ids.stranger,'submit_work',{id:post.id});await api(h.ids.owner,'moderate',{id:post.id,status:'approved'});
 await check('Failed gallery filter preserves matching controls and load-more state',async()=>{
  const p=await s.pageFor(h.ids.customer);await p.page.goto(origin+'/academy/dashboard#gallery');await p.page.getByLabel('Filter by category').selectOption('Cakes');await p.page.waitForFunction(()=>document.querySelectorAll('[data-post]').length===24&&document.querySelector('#ap-gallery-status').textContent.includes('shown'));
  p.failNext('gallery','before');await p.page.getByLabel('Filter by category').selectOption('Cookies');await p.page.getByText('The gallery could not load. Please try again.',{exact:true}).waitFor();
  assert.equal(await p.page.getByLabel('Filter by category').inputValue(),'Cakes','Visible filter must describe the retained gallery, not the failed request');
  await p.page.getByRole('button',{name:'Load more',exact:true}).click();await p.page.waitForFunction(()=>document.querySelectorAll('[data-post]').length===26);assert.equal(await p.page.getByRole('heading',{name:'One cookie',exact:true}).count(),0);
  await p.page.getByLabel('Filter by category').selectOption('Cookies');await p.page.getByRole('heading',{name:'One cookie',exact:true}).waitFor();assert.equal(await p.page.locator('[data-post]').count(),1);await p.context.close();
 });
 await check('Photo progress and form errors both hide raw database error details',async()=>{
  const p=await s.pageFor(h.ids.customer,390);await p.page.goto(origin+'/academy/dashboard#share/'+cookie.id);await p.page.getByLabel('Product / title').fill('Upload error sanitization');
  const png=Buffer.from(await p.page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;return canvas.toDataURL('image/png').split(',')[1];}),'base64');
  await p.page.locator('input[name=photos]').setInputFiles({name:'test.png',mimeType:'image/png',buffer:png});
  p.failNext('reserve_media','before','permission denied for relation academy_portal_media');await p.page.getByRole('button',{name:'Submit your creation',exact:true}).click();await p.page.getByRole('alert').waitFor();
  assert.doesNotMatch(await p.page.locator('body').innerText(),/permission denied|academy_portal_media|relation/i);
  await p.page.getByRole('button',{name:'Retry upload & send',exact:true}).click();await p.page.waitForFunction(()=>location.hash.startsWith('#class/'));await p.context.close();
 });
 await check('A hidden optional product category never silently classifies cupcake work as Cookies',async()=>{
  const p=await s.pageFor(h.ids.stranger,390);await p.page.goto(origin+'/academy/dashboard#share/'+cupcake.id);await p.page.getByLabel('Product / title').fill('My cupcake practice');
  assert.equal(await p.page.locator('select[name=category]').inputValue(),'Other');
  await p.page.getByText('Related class details (optional)',{exact:true}).click();await p.page.getByLabel('Product category',{exact:true}).selectOption('Cupcakes');assert.equal(await p.page.getByLabel('Product category',{exact:true}).inputValue(),'Cupcakes');await p.context.close();
 });
}finally{await writeFile(out+'/results.json',JSON.stringify({results,errors:s.errors,scope:'Actual browser pages and migrated SQL with controlled Auth/storage/network transport'},null,2));for(const c of s.browser.contexts())for(const p of c.pages())await p.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});await s.close();if(results.some(r=>r.status==='FAIL'))process.exitCode=1;}
