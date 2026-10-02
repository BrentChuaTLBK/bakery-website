import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {auditHarness} from './academy-audit-harness.mjs';
import {emailTestTls} from './academy-email-test-tls.mjs';
const s=await auditHarness(undefined,{localPhotoFixture:true}),{h,origin}=s,channel=process.env.PLAYWRIGHT_CHANNEL||'chrome',out=`work/academy-visual-email/${channel}`,results=[];
await mkdir(out,{recursive:true});const bytes=await readFile('assets/pastries/Tiramisu/Classic_Tiramisu.webp');
// Sandboxed srcdoc frames bypass Playwright routing in Chromium. Serve actual
// photo bytes over test-only localhost TLS so preview decoding is verified.
const servedPhotos=new Map();let photoSequence=0;
const photoServer=createServer(await emailTestTls(),(req,res)=>{const body=servedPhotos.get(req.url);res.writeHead(body?200:404,{'Content-Type':body?'image/jpeg':'text/plain','Access-Control-Allow-Origin':'*'});res.end(body||'Missing test photo');});
await new Promise(r=>photoServer.listen(0,'127.0.0.1',r));const photoOrigin='https://127.0.0.1:'+photoServer.address().port;
const imageFile={name:'academy-bake.webp',mimeType:'image/webp',buffer:bytes};
const api=(action,p)=>s.serial(()=>s.api(h.ids.owner,action,p));
const fixture=async(options={})=>{
 const p=await s.pageFor(h.ids.owner,1440,{ignoreHTTPSErrors:true,...options});p.page.setDefaultTimeout(9000);const photos=new Map(),uploads=[];let fail=false,release,delay=false;
 await p.context.exposeFunction('auditPublicPhotoUpload',async upload=>{
  uploads.push(upload);assert.equal(upload.type,'image/jpeg');assert.equal(upload.meta.kind,'product');assert.deepEqual(upload.bytes.slice(0,2),[255,216]);
  if(delay)await new Promise(r=>release=r);if(fail){fail=false;throw Error('Photo upload interrupted. Try again.');}
  const path='/'+(++photoSequence)+'.jpg',url=photoOrigin+path;photos.set(url,Buffer.from(upload.bytes));servedPhotos.set(path,Buffer.from(upload.bytes));return {url};
 });
 await p.context.route(photoOrigin+'/**',route=>route.fulfill({body:servedPhotos.get(new URL(route.request().url()).pathname)||bytes,contentType:'image/jpeg'}));
 const open=async(view='newsletter')=>{await p.page.goto(`${origin}/academy/admin#${view}`);await p.page.getByRole('button',{name:'Use template',exact:true}).waitFor();};
 if(process.env.ACADEMY_DEBUG){p.page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text());});p.page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()?.errorText));}
 await open();return {...p,open,uploads,fail:()=>fail=true,hold:()=>delay=true,release:()=>{delay=false;release?.();}};
};
const check=async(name,fn)=>{if(process.env.ACADEMY_CHECK_FILTER&&!new RegExp(process.env.ACADEMY_CHECK_FILTER).test(name))return;try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){results.push({name,status:'FAIL',error:e.stack});console.log('FAIL',name,e.message);for(const c of s.browser.contexts())for(const p of c.pages())await p.screenshot({path:`${out}/failure-${results.length}.png`,fullPage:true}).catch(()=>{});}finally{for(const c of s.browser.contexts())await c.close();}};
const fill=async page=>{await page.getByLabel('Subject',{exact:true}).fill('Your next baking adventure');await page.getByLabel('Message',{exact:true}).fill('Join Chef Cookie for an afternoon of baking. All ingredients and take-home bakes are included.');await page.locator('[data-email-field="headline"]').fill('A little flour. A lot of possibility.');await page.locator('[data-email-field="intro"]').fill('Step into our kitchen and make something lovely.');await page.locator('[data-email-field="preheader"]').fill('A warm invitation from TLB Academy.');await page.locator('[data-email-field="cta_label"]').fill('Explore our classes');await page.locator('[data-email-field="cta_url"]').fill('https://thelittlebakerkitchen.com/academy.html');};
const upload=async(page,key='hero_url')=>{await page.locator(`[data-email-file="${key}"]`).setInputFiles(imageFile);await page.locator(`[data-email-photo="${key}"] [data-photo-status]`).filter({hasText:'Photo added.'}).waitFor();const altKey=key==='hero_url'?'hero_alt':key.replace('image_url','alt');await page.locator(`[data-email-field="${altKey}"]`).fill('A cocoa-dusted tiramisu made in class');};
try{
 await check('Four layouts update the live design and preserve the message, headings and button',async()=>{
  const p=await fixture();await fill(p.page);for(const layout of ['launch','showcase','journal','invitation']){await p.page.locator(`[data-email-layout="${layout}"]`).click();assert.equal(await p.page.locator(`[data-email-layout="${layout}"]`).getAttribute('aria-pressed'),'true');await p.page.locator('.ap-email-live iframe').contentFrame().getByRole('heading',{name:'A little flour. A lot of possibility.'}).waitFor();}
  await p.page.locator('.ap-email-live iframe').contentFrame().getByRole('link',{name:'Explore our classes'}).waitFor();assert.equal(await p.page.getByLabel('Subject',{exact:true}).inputValue(),'Your next baking adventure');assert.equal(p.calls.filter(c=>c.action==='broadcast_send').length,0);
 });
 await check('Real photo conversion and uploads populate the main picture and reorderable highlights',async()=>{
  const p=await fixture();await fill(p.page);await upload(p.page);await p.page.locator('[data-email-add]').click();await p.page.locator('[data-email-field="items.0.title"]').fill('Baking together');await upload(p.page,'items.0.image_url');await p.page.locator('[data-email-field="items.0.description"]').fill('Make a classic tiramisu from scratch.');
  await p.page.locator('[data-email-add]').click();await p.page.locator('[data-email-field="items.1.title"]').fill('Skills to take home');await p.page.locator('[data-email-up="1"]').click();assert.equal(await p.page.locator('[data-email-field="items.1.title"]').inputValue(),'Baking together');assert.match(await p.page.locator('[data-email-field="items.1.image_url"]').inputValue(),/127\.0\.0\.1/);
  await p.page.locator('[data-email-remove="0"]').click();assert.equal(await p.page.locator('[data-email-field="items.0.title"]').inputValue(),'Baking together');assert.equal(p.uploads.length,2);
  await p.page.getByRole('button',{name:'Save as template',exact:true}).click();let d=p.page.getByRole('dialog');await d.getByLabel('Template name').fill('Our photographed class');await d.getByRole('button',{name:'Save template',exact:true}).click();await d.waitFor({state:'detached'});
  const saved=(await api('email_templates',{kind:'marketing'})).templates.find(t=>t.name==='Our photographed class');assert.equal(saved.email_content.items.length,1);assert.match(saved.email_content.hero_url,/127\.0\.0\.1/);
  await p.page.screenshot({path:`${out}/editor-desktop.png`,fullPage:true});
 });
 await check('Saved designs reload with pictures and selecting another template requires confirmation',async()=>{
  const p=await fixture(),saved=(await api('email_templates',{kind:'marketing'})).templates.find(t=>t.name==='Our photographed class');await p.page.getByLabel('Start from a template').selectOption(saved.id);await p.page.getByRole('button',{name:'Use template',exact:true}).click();assert.equal(await p.page.locator('[data-email-field="items.0.title"]').inputValue(),'Baking together');assert.match(await p.page.locator('[data-email-field="hero_url"]').inputValue(),/127\.0\.0\.1/);
  await p.page.getByLabel('Start from a template').selectOption('builtin:tips');await p.page.getByRole('button',{name:'Use template',exact:true}).click();await p.page.getByRole('dialog').waitFor();await p.page.keyboard.press('Escape');assert.match(await p.page.locator('[data-email-field="hero_url"]').inputValue(),/127\.0\.0\.1/);
  await p.page.getByRole('button',{name:'Use template',exact:true}).click();await p.page.getByRole('button',{name:'Use this template',exact:true}).click();assert.equal(await p.page.locator('[data-email-field="hero_url"]').inputValue(),'');assert.equal(await p.page.locator('[data-email-layout="journal"]').getAttribute('aria-pressed'),'true');
 });
 await check('Desktop and mobile previews load pictures, escape hostile text and keep links disabled',async()=>{
  const p=await fixture();await fill(p.page);await upload(p.page);await p.page.locator('[data-email-add]').click();await p.page.locator('[data-email-field="items.0.title"]').fill('Our signature tiramisu');await upload(p.page,'items.0.image_url');await p.page.locator('[data-email-field="items.0.description"]').fill('Coffee, cocoa and a little kitchen confidence.');
  await p.page.getByRole('button',{name:'Preview email',exact:true}).click();const d=p.page.getByRole('dialog'),frame=d.locator('iframe').contentFrame();await frame.getByRole('img').first().waitFor();await frame.locator('img').first().evaluate(img=>img.decode());await d.screenshot({path:`${out}/preview-desktop.png`});
  await d.getByRole('button',{name:'Mobile',exact:true}).click();assert.ok((await d.locator('iframe').boundingBox()).width<=375);await d.screenshot({path:`${out}/preview-mobile.png`});const email=await p.context.newPage();await email.setViewportSize({width:640,height:900});await email.setContent(await d.locator('iframe').getAttribute('srcdoc'));await email.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));await email.screenshot({path:`${out}/full-email-desktop.png`,fullPage:true});await email.setViewportSize({width:375,height:844});assert.equal(await email.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await email.screenshot({path:`${out}/full-email-mobile.png`,fullPage:true});await email.close();assert.equal(await frame.locator('a').first().getAttribute('href'),'#preview');await p.page.keyboard.press('Escape');
  await p.page.setViewportSize({width:390,height:844});assert.equal(await p.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.page.screenshot({path:`${out}/editor-mobile.png`,fullPage:true});
  await p.page.locator('[data-email-field="headline"]').fill('<img src=x onerror=alert(1)>');await p.page.getByRole('button',{name:'Preview email',exact:true}).click();await d.locator('iframe').contentFrame().getByRole('heading',{name:'<img src=x onerror=alert(1)>'}).waitFor();assert.equal(await d.locator('iframe').contentFrame().locator('[onerror],script').count(),0);assert.equal(await d.locator('iframe').getAttribute('sandbox'),'');assert.equal(p.calls.filter(c=>c.action==='broadcast_send').length,0);
 });
 await check('Unsupported files and interrupted uploads retain the draft and allow a successful retry',async()=>{
  const p=await fixture();await fill(p.page);await p.page.locator('[data-email-file="hero_url"]').setInputFiles({name:'not-photo.exe',mimeType:'application/octet-stream',buffer:Buffer.from('not an image')});await p.page.locator('[data-photo-status]').filter({hasText:'Choose a JPG'}).waitFor();assert.equal(p.uploads.length,0);
  p.fail();await p.page.locator('[data-email-file="hero_url"]').setInputFiles(imageFile);await p.page.locator('[data-photo-status]').filter({hasText:'Photo upload interrupted'}).waitFor();assert.equal(await p.page.getByLabel('Subject',{exact:true}).inputValue(),'Your next baking adventure');await upload(p.page);assert.equal(p.uploads.length,2);
 });
 await check('Saving and sending are blocked during upload, and navigation discards late upload results',async()=>{
  const p=await fixture();await fill(p.page);p.hold();await p.page.locator('[data-email-file="hero_url"]').setInputFiles(imageFile);await p.page.waitForFunction(()=>document.querySelector('form').dataset.emailUploadBusy==='true');assert.equal(await p.page.getByRole('button',{name:'Review recipients',exact:true}).isDisabled(),true);assert.equal(await p.page.getByRole('button',{name:'Save as template',exact:true}).isDisabled(),true);
  await p.page.evaluate(()=>location.hash='overview');await p.page.getByRole('heading',{name:'Your teaching kitchen'}).waitFor();p.release();await p.open();assert.equal(await p.page.locator('[data-email-field="hero_url"]').inputValue(),'');assert.equal(p.calls.filter(c=>c.action==='broadcast_send').length,0);
 });
 await check('Recipient review and the queued email preserve the exact visual design and consent filter',async()=>{
  await s.serial(()=>s.api(h.ids.customer,'newsletter',{academy:true}));await s.db.query("update tlb.settings set data=jsonb_set(data,'{pickup_address}','\"Synthetic test kitchen\"') where id");
  const p=await fixture();await fill(p.page);await upload(p.page);await p.page.getByRole('button',{name:'Review recipients',exact:true}).click();const d=p.page.getByRole('dialog');await d.locator('iframe').contentFrame().getByRole('img').waitFor();await d.getByRole('button',{name:'Queue newsletter',exact:true}).click();await d.waitFor({state:'detached'});const sent=p.calls.find(c=>c.action==='broadcast_send');assert.ok(sent);assert.equal(sent.p.email_content.headline,'A little flour. A lot of possibility.');assert.match(sent.p.email_content.hero_url,/127\.0\.0\.1/);const rows=(await s.db.query("select payload from tlb.outbox where event_type='academy_broadcast' order by created_at desc limit 1")).rows;assert.deepEqual(rows[0].payload.email_content,sent.p.email_content);
 });
 await check('Class emails use the same photo editor with an operational footer and no marketing unsubscribe',async()=>{
  const p=await fixture();await p.open('email');await fill(p.page);await upload(p.page);await p.page.getByRole('button',{name:'Preview email',exact:true}).click();const frame=p.page.getByRole('dialog').locator('iframe').contentFrame();await frame.getByText('This is an Academy account or class notification.',{exact:true}).waitFor();assert.equal(await frame.getByRole('link',{name:'Unsubscribe from Academy marketing'}).count(),0);
 });
 await check('An older backend cannot silently save or queue an email without its pictures',async()=>{
  const p=await fixture({responseTransform:(action,result)=>{if(action==='email_templates')delete result.visual_email_templates;return result;}});await fill(p.page);
  await p.page.getByRole('button',{name:'Save as template',exact:true}).click();await p.page.locator('[data-template-status]').filter({hasText:'Picture templates are not available yet'}).waitFor();assert.equal(await p.page.getByRole('dialog').count(),0);
  await p.page.getByRole('button',{name:'Review recipients',exact:true}).click();await p.page.getByRole('alert').filter({hasText:'Picture templates are not available yet'}).waitFor();assert.equal(p.calls.filter(c=>['save_email_template','broadcast_preview','broadcast_send'].includes(c.action)).length,0);
 });
 await writeFile(`${out}/results.json`,JSON.stringify({results,errors:s.errors},null,2));assert.deepEqual(s.errors,[]);assert.ok(results.every(r=>r.status==='PASS'));console.log(`${results.length}/${results.length} visual email browser checks passed (${channel})`);
}finally{await s.close();photoServer.closeAllConnections();await new Promise(r=>photoServer.close(r));}
