// Fully local browser fixtures; no production reads or writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://categories.test',out=join(root,'test-results/package-categories');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
try { for(const width of [1440,768,390,320]) for(const service of ['party','dessert']) {
  const categories=[{id:'c50',name:'50 pax'},{id:'c100',name:'100 pax'},{id:'c150',name:'150 pax'}];
  const titles=['Cookie A La Mode 50pax','Nori Chips 100pax','Cookie A La Mode x Nori Chips 50pax','Cookie Nibblers 50pax','Cookie A La Mode 100pax','Cookie A La Mode x Nori Chips 100pax','Cookie A La Mode 150pax','Nori Chips 150pax','Cookie A La Mode x Nori Chips 150pax'];
  const f={categories,fail:false,items:titles.map((subtitle,i)=>({id:'p'+(i+1),name:'Package '+(i+1),subtitle,category_id:'c'+subtitle.match(/(\d+)pax/)[1],price_cents:[900000,900000,1050000,900000,1350000,1950000,1800000,1200000,2700000][i],badge:i===5?'Most Popular':'',published:true,sort_order:i+1,revision:1,created_at:'2026-09-29',features:[{label:subtitle.split('pax')[0]+' servings',detail:'Classic treats, freshly prepared for your celebration.'},{label:'Choose 3 flavors',detail:'Vanilla, Chocolate, Strawberry, Matcha, Ube, Cheese, Cookies & Cream'},...(i%3===2?[{label:'50 Cups Nori Chips',detail:'Premium seasoned chips'},{label:'Choose 3 flavors',detail:'Original, Barbeque, Cheese, Sour Cream, White Cheddar, Chili BBQ, Sweet Corn'}]:[{label:'Toppings included',detail:'Marshmallows, Oreos, Rainbow Sprinkles, Sliced Almonds, Chocolate Syrup, Caramel Syrup'}])]}))};
  const settings={revision:1,inclusions:[{label:'4 Hours Duration',detail:''},{label:'Full Cart Setup',detail:''},{label:'2 Servers',detail:''},{label:'Free Delivery Within Quezon City',detail:'Excluding Novaliches & Payatas'}]};
  const errors=[],ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500});
  const response=(action,payload={})=>{
    if(action==='admin_list')return {items:f.items,categories:f.categories,settings};
    if(action==='browse')return {items:f.items.filter(p=>p.published),categories:f.categories,settings};
    if(action==='save_categories') {if(f.fail){f.fail=false;throw Error('Categories changed in another window. Close the editor and refresh before saving.')}f.categories=payload.categories;f.items=f.items.map(p=>f.categories.some(c=>c.id===p.category_id)?p:{...p,category_id:null,revision:p.revision+1});return {categories:f.categories,items:f.items};}
    if(action==='save') {const next={...payload.package,revision:payload.package.revision+1,created_at:'2026-09-29'};const i=f.items.findIndex(p=>p.id===next.id);if(i<0)f.items.push(next);else f.items[i]=next;return next;}
    if(action==='reorder'){f.items=payload.ids.map((id,i)=>({...f.items.find(p=>p.id===id),sort_order:i+1,revision:2}));return {items:f.items};}
    throw Error('Unexpected '+action);
  };
  await ctx.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname.includes('/rest/v1/rpc/')||u.pathname==='/api') {try{const {p_action,p_payload}=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify(response(p_action,p_payload))})}catch(e){return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:e.message})})}}
    if(u.origin!==origin)return route.abort();
    if(u.pathname==='/admin')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/ordering.css"><link rel="stylesheet" href="/assets/ordering/manage.css"><link rel="stylesheet" href="/assets/ordering/party-packages.css"><link rel="stylesheet" href="/assets/ordering/catalog-order.css"><link rel="stylesheet" href="/assets/ordering/site-dialog.css"></head><body class="manage-page"><main style="max-width:1100px;margin:auto;padding:16px"><div id="manager"></div></main><script type="module">import{mountPartyPackageManager}from'/assets/ordering/party-package-manager.js';mountPartyPackageManager(document.querySelector('#manager'),{role:'owner',connected:true,page:'${service}',cartApi:async()=>({items:[],revision:1}),api:async(p_action,p_payload)=>{const r=await fetch('/api',{method:'POST',body:JSON.stringify({p_action,p_payload})});const d=await r.json();if(!r.ok)throw Error(d.message);return d}});</script></body></html>`});
    if(u.pathname==='/public')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/party-packages.css"></head><body data-event-service="${service}" style="background:#fffaf0;margin:0"><main style="max-width:1200px;margin:36px auto;padding:0 20px"><section class="party-packages" data-party-packages><h1>Choose your party package</h1><div data-party-results></div><p class="party-status" data-party-status></p><button data-party-retry hidden>Retry</button></section></main><script type="module" src="/assets/ordering/party-packages.js"></script></body></html>`});
    try{return route.fulfill({contentType:{'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[extname(u.pathname)]||'application/octet-stream',body:await readFile(join(root,u.pathname))})}catch{return route.fulfill({status:404,body:'Missing'})}
  });
  ctx.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  const page=await ctx.newPage();await page.goto(origin+'/public');await page.locator('.party-card').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.deepEqual(await page.locator('.party-category-heading h2').allTextContents(),['50 pax','100 pax','150 pax']);
  for(const group of await page.locator('.party-category').all())assert.equal(await group.locator('.party-card').count(),3);
  assert.equal(await page.locator('details,summary').count(),0);for(const text of await page.locator('.party-feature-detail').all())assert(await text.isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(width>=1100) for(const group of await page.locator('.party-category').all()) {
    const tops=await group.locator('.party-price').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().top));
    assert(Math.max(...tops)-Math.min(...tops)<2,'Prices align across the row');
  }
  await page.screenshot({path:join(out,`${service}-public-${width}.png`),fullPage:true});
  await page.getByRole('link',{name:'150 pax',exact:true}).click();assert.match(page.url(),/#package-category-c150$/);assert.equal(await page.locator('.party-card').count(),9);
  await page.goto(origin+'/admin');await page.locator('[data-party-edit="p1"]').waitFor();
  assert.deepEqual(await page.locator('.party-admin-group-heading h3').allTextContents(),['50 pax','100 pax','150 pax']);
  await page.locator('[data-package-group="0"] [data-order-handle="0"]').press('ArrowDown');await page.getByText('Package order saved.',{exact:true}).waitFor();assert.deepEqual(await page.locator('[data-package-group="0"] h2').allTextContents(),['Package 3','Package 1','Package 4']);
  assert.deepEqual(await page.locator('[data-package-group="1"] h2').allTextContents(),['Package 2','Package 5','Package 6']);
  await page.locator('[data-party-duplicate="p1"]').click();assert.equal(await page.locator('[name=category_id]').inputValue(),'c50');await page.locator('[data-party-form] button[type=submit]').click();await page.locator('.party-editor').waitFor({state:'hidden'});assert.equal(f.items.length,10);assert.equal(f.items.at(-1).published,false);
  await page.locator('[data-party-categories]').click();await page.locator('[data-category-row="c50"] input').fill('Small celebrations');await page.locator('[data-category-row="c150"] [data-category-up]').click();
  await page.locator('[data-category-add]').click();await page.locator('[data-party-form] button[type=submit]').click();assert.equal(f.categories.length,3,'Blank category blocks save but remains removable');await page.locator('[data-category-remove]').last().click();
  await page.locator('[data-category-add]').click();const customName='Custom <img src=x onerror=alert(1)> celebrations';await page.locator('[data-category-row] input').last().fill(customName);
  assert(await page.locator('.party-editor').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:join(out,`${service}-editor-${width}.png`)});
  f.fail=true;await page.locator('[data-party-form] button[type=submit]').click();await page.getByRole('alert').filter({hasText:'changed in another window'}).waitFor();assert.equal(await page.locator('[data-category-row] input').first().inputValue(),'Small celebrations');
  await page.locator('[data-party-form] button[type=submit]').click();await page.locator('.party-editor').waitFor({state:'hidden'});
  assert.deepEqual(f.categories.map(c=>c.name),['Small celebrations','150 pax','100 pax',customName]);
  await page.locator('[data-party-edit="p1"]').click();await page.locator('[name=category_id]').selectOption(f.categories.at(-1).id);await page.locator('[data-party-form] button[type=submit]').click();await page.locator('.party-editor').waitFor({state:'hidden'});assert.equal(f.items.find(p=>p.id==='p1').category_id,f.categories.at(-1).id);
  await page.locator('[data-party-categories]').click();await page.locator('[data-category-row="c100"] [data-category-remove]').click();await page.locator('[data-party-form] button[type=submit]').click();await page.locator('.party-editor').waitFor({state:'hidden'});assert.equal(f.items.length,10);
  assert.equal(await page.locator('.party-admin-group').filter({hasText:'Uncategorized'}).locator('.party-admin-item').count(),3);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(out,`${service}-admin-${width}.png`),fullPage:true});
  await page.goto(origin+'/public');await page.locator('.party-card').first().waitFor();assert.equal(await page.locator('.party-card').count(),9);assert.equal(await page.locator('[data-party-results] img').count(),0);assert.match(await page.locator('[data-party-results]').innerText(),/Custom <img/);assert.equal(await page.locator('.party-category-heading h2').last().textContent(),'More packages');
  assert.deepEqual(errors,[]);await ctx.close();console.log(`PASS ${service} categories, assignments, retry, deletion, duplication, ordering, visible details and no overflow at ${width}px`);
}}finally{await browser.close()}
