import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {newsletterTemplates,sampleNewsletter,renderNewsletterCampaign} from '../../assets/ordering/newsletter-templates.js';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'test-results/newsletter-templates');
const require=createRequire(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'package.json')),{chromium}=require('playwright');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH});
try{
 const context=await browser.newContext(),page=await context.newPage();
 await context.route('https://**/*',async route=>{
  const url=new URL(route.request().url()),path=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(url.hostname==='thelittlebakerkitchen.com'&&path.startsWith(root+sep))try{return await route.fulfill({body:await readFile(path),contentType:'image/webp'});}catch{}
  return route.abort();
 });
 for(const template of newsletterTemplates){
  const content=sampleNewsletter(template.id);
  if(template.id==='promo')Object.assign(content,{offer_code:'SWEET15',offer_heading:'15% OFF',offer_terms:'Illustrative offer · ₱500 minimum purchase.\nUp to ₱150 discount. Ends October 31, 2026 PHT.\nDelivery excluded.'});
  const rendered=renderNewsletterCampaign(content,{pickup_address:'The Little Baker Kitchen · Quezon City'});
  await writeFile(join(out,`${template.id}.html`),rendered.html);
  for(const width of [900,390,320]){
   await page.setViewportSize({width,height:1000});await page.setContent(rendered.html);await page.waitForFunction(()=>[...document.images].every(i=>i.complete));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${template.id} overflow at ${width}`);
   assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('img:not([alt])').count(),0);
   assert.equal(await page.getByRole('link',{name:'Unsubscribe from newsletters',exact:true}).count(),1);
   assert.equal(await page.evaluate(()=>[...document.images].every(i=>i.naturalWidth>0)),true,`${template.id} image loads`);
   if(template.id==='promo')await page.getByText('SWEET15',{exact:true}).waitFor();
   if(width===390)await page.screenshot({path:join(out,`${template.id}-mobile.png`),fullPage:true});
  }
 }
 const blockImages=route=>route.abort();await context.route('https://**/*',blockImages);
 const blocked=renderNewsletterCampaign({...sampleNewsletter('promo'),offer_code:'CODE'.repeat(25),offer_heading:'15% OFF',offer_terms:'Offer expires October 31, 2026 PHT.'}).html;
 await page.setContent(blocked);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Long code fits mobile');await page.getByText('CODE'.repeat(25),{exact:true}).waitFor();await page.getByText('Offer expires October 31, 2026 PHT.',{exact:true}).waitFor();
 await context.unroute('https://**/*',blockImages);
 const newTemplates=newsletterTemplates.filter(t=>['promo','launch','academy'].includes(t.id));
 await writeFile(join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New TLB newsletter templates</title><style>body{margin:0;padding:28px;background:#f2eadf;color:#493426;font:15px Arial}h1,h2{font-family:Georgia;font-weight:normal}h1{margin:0 0 8px}.templates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-top:28px}iframe{width:100%;height:980px;border:1px solid #decab6;background:#fffaf0}a{color:#784c28}p{line-height:1.6}@media(max-width:850px){.templates{grid-template-columns:1fr}}</style><h1>A little inspiration for your next newsletter</h1><p>Three new templates for TLB. The offer and code shown here are examples for preview only.</p><div class="templates">${newTemplates.map(t=>`<article><h2>${t.name}</h2><p>${t.description}</p><p><a href="${t.id}.html">Open full preview →</a></p><iframe title="${t.name}" src="${t.id}.html"></iframe></article>`).join('')}</div></html>`);
 await page.setViewportSize({width:1440,height:1260});await page.goto(pathToFileURL(join(out,'index.html')).href);for(const frame of page.frames())await frame.waitForFunction(()=>[...document.images].every(i=>i.complete));await page.screenshot({path:join(out,'new-templates.png'),fullPage:true});
 console.log('PASS all 6 email layouts at 900/390/320px; photos, headings, unsubscribe, long promo codes and images blocked.');
}finally{await browser.close();}
