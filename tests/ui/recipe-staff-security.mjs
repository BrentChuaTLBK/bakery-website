import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
import {staffFixture} from '../backend/recipe-staff-fixture.mjs';

const t=await recipeBrowserHarness(),out=join(t.out,'staff-security');await mkdir(out,{recursive:true});
let activePage,checks=0;const results=[],network=[];
const check=async(name,fn)=>{await fn();checks++;results.push({name,passed:true});console.log(`PASS ${name}`);};
try{
 const f=await staffFixture(t.db,{h:t.h,serialize:t.run,dispatch:async(a,p,u)=>(await t.api(u,a,p,true)).result});
 const admin=await t.pageFor(f.owner,1440,{network:true}),page=admin.page;activePage=page;
 page.on('response',async response=>{if(response.url().includes('/rpc/recipe_api'))network.push({user:'owner',status:response.status(),headers:await response.allHeaders(),body:await response.json()});});
 const click=action=>page.locator(`[data-staff-action="${action}"]`).click();
 const tab=name=>page.locator(`[data-staff-tab="${name}"]`).click();
 const choose=id=>page.locator(`[data-staff-person="${id}"]`);
 const day=date=>page.locator(`[data-staff-date="${date}"]`);
 async function calendarReady(){await page.locator('[data-staff-date="2026-10-05"]').waitFor();}
 async function settleMutation(action,run){const response=page.waitForResponse(r=>r.url().includes('/rpc/recipe_api')&&r.request().postDataJSON()?.p_action===action);await run();await response;await page.locator('.staff-access').waitFor();}
 await page.goto(`${t.origin}/recipes.html`);await page.locator('[data-tab="staff-access"]').waitFor();
 await check('Staff Access opens on a complete Monday–Sunday calendar with centralized staff selection',async()=>{
  await page.locator('[data-tab="staff-access"]').click();await calendarReady();assert.equal(await page.locator('.staff-calendar-day').count(),42);assert.equal(await page.locator('.staff-calendar-weekdays span').count(),7);
  assert.equal(await page.locator('.staff-calendar-weekdays').innerText(),'Mon\nTue\nWed\nThu\nFri\nSat\nSun');await choose(f.angie).check();await choose(f.edna).check();assert.match(await page.locator('.staff-selection-summary').innerText(),/2 Staff Selected/);
  await page.screenshot({path:join(out,'calendar-desktop.png'),fullPage:true,animations:'disabled'});
 });
 await check('one bulk action blocks both selected staff and restoring one produces a truthful Mixed state',async()=>{
  await day('2026-10-05').click();await settleMutation('staff_calendar',()=>click('block'));await page.waitForFunction(()=>document.querySelector('[data-staff-date="2026-10-05"]')?.classList.contains('blocked'));
  await choose(f.edna).uncheck();await settleMutation('staff_calendar',()=>click('restore'));await choose(f.edna).check();await page.waitForFunction(()=>document.querySelector('[data-staff-date="2026-10-05"]')?.classList.contains('mixed'));
  assert.match(await day('2026-10-05').innerText(),/Mixed · 1 of 2 blocked/);await page.screenshot({path:join(out,'calendar-mixed.png'),fullPage:true,animations:'disabled'});
 });
 await check('date ranges, future months, large-action confirmation and Undo work as one bulk workflow',async()=>{
  await click('select-all');await click('clear-dates');await page.locator('#staff-date-range [name="from"]').fill('2026-10-10');await page.locator('#staff-date-range [name="to"]').fill('2026-10-15');await page.locator('#staff-date-range [type="submit"]').click();
  assert.equal(await page.locator('.staff-calendar-day[aria-pressed="true"]').count(),6);await click('block');await page.getByRole('button',{name:'Confirm Block',exact:true}).waitFor();assert.match(await page.getByRole('dialog').filter({hasText:'30 Staff-Date blocks'}).innerText(),/5 Staff/);
  await page.screenshot({path:join(out,'bulk-confirmation.png'),fullPage:true,animations:'disabled'});await settleMutation('staff_calendar',()=>page.getByRole('button',{name:'Confirm Block',exact:true}).click());
  await page.locator('.staff-undo').filter({hasText:'5 Staff across 6 dates'}).waitFor();assert.equal((await f.overview()).dates.filter(d=>d.date>='2026-10-10'&&d.date<='2026-10-15').length,30);
  await settleMutation('staff_undo',()=>click('undo'));assert.equal((await f.overview()).dates.filter(d=>d.date>='2026-10-10'&&d.date<='2026-10-15').length,0);
  await click('next-month');await page.locator('.staff-month-nav h4').filter({hasText:'November 2026'}).waitFor();await click('today');await calendarReady();
 });
 await check('a failed calendar request shows an error without false success and retry applies only once',async()=>{
  await click('clear-staff');await choose(f.angie).check();await click('clear-dates');await day('2026-10-07').click();t.failNext('staff_calendar');
  await settleMutation('staff_calendar',()=>click('block'));await page.locator('.staff-access [role="alert"]').filter({hasText:'Connection interrupted'}).waitFor();assert.equal((await f.overview()).dates.some(d=>d.date==='2026-10-07'),false);
  await settleMutation('staff_calendar',()=>click('block'));await page.locator('.staff-undo').filter({hasText:'1 Staff across 1 date'}).waitFor();assert.equal((await f.overview()).dates.filter(d=>d.date==='2026-10-07').length,1);await settleMutation('staff_undo',()=>click('undo'));
 });
 await check('Staff settings save selected recipes and explicit R&D access; default hours include weekends',async()=>{
  await tab('staff');await page.locator(`[data-staff-action="edit-staff"][data-id="${f.angie}"]`).click();const form=page.locator('#staff-person-form');await form.locator('[name="can_view_rd"]').check();await form.locator(`[name="scope_id"][value="${f.research.id}"]`).check();
  await form.locator('[type="submit"]').click();await form.waitFor({state:'hidden'});await page.locator('tr').filter({hasText:'Angie'}).filter({hasText:'Final + R&D'}).waitFor();await page.screenshot({path:join(out,'staff-overview.png'),fullPage:true,animations:'disabled'});
  await tab('hours');assert.equal(await page.locator('#staff-default-hours input[type="checkbox"]:checked').count(),7);assert.equal(await page.locator('[name="hours_start_7"]').inputValue(),'10:00');assert.equal(await page.locator('[name="hours_end_7"]').inputValue(),'19:00');
 });
 await check('temporary access uses Manila time, expires automatically and appears in owner-only activity',async()=>{
  await tab('temporary');await page.locator('#staff-override-form [name="starts_local"]').fill('2026-10-01T19:00');await page.locator('#staff-override-form [name="ends_local"]').fill('2026-10-01T22:00');await page.locator('#staff-override-form [type="submit"]').click();
  await page.locator('.staff-override-list article').filter({hasText:'Angie'}).waitFor();await page.screenshot({path:join(out,'temporary-access.png'),fullPage:true,animations:'disabled'});await tab('activity');await page.locator('.staff-activity').waitFor();assert.match(await page.locator('.staff-activity').innerText(),/Granted temporary access/);await page.screenshot({path:join(out,'activity.png'),fullPage:true,animations:'disabled'});
 });
 await check('the access calendar remains usable on tablet and phone without page overflow',async()=>{
  await tab('calendar');await page.setViewportSize({width:1024,height:1000});await page.screenshot({path:join(out,'calendar-tablet.png'),fullPage:true,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'calendar-phone.png'),fullPage:true,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1440,height:1000});
 });
 const kitchen=await t.pageFor(f.angie,1024,{network:true}),kp=kitchen.page;activePage=kp;
 await kp.route('**/staff-return-test.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Kitchen navigation test</title><p>Away from protected recipes.</p>'}));
 kp.on('response',async response=>{if(response.url().includes('/rpc/recipe_api'))network.push({user:'kitchen',action:response.request().postDataJSON().p_action,status:response.status(),headers:await response.allHeaders(),body:await response.json()});});
 const open=async(name,target=kp)=>{await target.locator('.recipe-card').filter({has:target.locator('h2',{hasText:name})}).getByRole('button',{name:'Open recipe',exact:true}).click();await target.locator('h1').filter({hasText:name}).waitFor();};
 await check('actual Kitchen network payloads exclude confidential data and expose only authorized Final recipes',async()=>{
  await kp.goto(`${t.origin}/recipes.html`);await kp.locator('.recipe-library .recipe-card').first().waitFor();assert.equal(await kp.locator('.recipe-library .recipe-card').count(),2);
  assert.equal(await kp.getByRole('button',{name:/Print|CSV|export|Download|Save Recipe/i}).count(),0);assert.equal(await kp.getByRole('button',{name:'Staff Access',exact:true}).count(),0);
  await open('Vanilla Basque');assert.equal(await kp.getByRole('button',{name:/Print|CSV|export|Download/i}).count(),0);
  const response=network.filter(n=>n.user==='kitchen'&&n.action==='get').at(-1);assert.ok(response);assert.match(response.headers['cache-control'],/no-store/);
  const body=JSON.stringify(response.body);for(const secret of ['CONFIDENTIAL','Chocolate Basque','cost_snapshot','supplier','profit','margin','private_notes','additional_costs'])assert.equal(body.includes(secret),false,secret);
  assert.match(body,/Philadelphia/);await kp.screenshot({path:join(out,'kitchen-final-tablet.png'),fullPage:true,animations:'disabled'});
 });
 await check('Final/R&D switching is one tap, keeps production separate and does not add exports or test logs',async()=>{
  await kp.getByRole('button',{name:'R&D',exact:true}).click();await kp.locator('.recipe-library .recipe-card').first().waitFor();assert.equal(await kp.locator('.recipe-library .recipe-card').count(),1);await open('R&D Basque');assert.equal(await kp.getByRole('button',{name:'New test',exact:true}).count(),0);
  await kp.getByRole('button',{name:'Final',exact:true}).click();await kp.locator('.recipe-library .recipe-card').first().waitFor();await open('Vanilla Basque');
 });
 await check('scaling and checklists work without saving the master, while print and casual copy are deterred',async()=>{
  const before=(await f.api('get',{id:f.vanilla.id})).document;await kp.locator('[data-action="quick-scale"][data-factor="2"]').click();await kp.waitForFunction(()=>document.querySelector('.recipe-quick-quantity')?.textContent.includes('2'));
  assert.match(await kp.locator('[data-component-view]').first().innerText(),/400/);await kp.locator('[data-check]').first().check();assert.deepEqual((await f.api('get',{id:f.vanilla.id})).document,before);
  assert.equal(await kp.locator('#recipe-main').evaluate(node=>{const e=new Event('copy',{bubbles:true,cancelable:true});node.dispatchEvent(e);return e.defaultPrevented;}),true);
  await kp.emulateMedia({media:'print'});assert.equal(await kp.locator('#recipe-main').isVisible(),false);assert.match(await kp.evaluate(()=>getComputedStyle(document.body,'::before').content),/printing is disabled/);await kp.screenshot({path:join(out,'staff-print-protection.png'),animations:'disabled'});await kp.emulateMedia({media:'screen'});
 });
 await check('an open recipe locks at the server-issued 7pm boundary and scaling requests are denied',async()=>{
  // Remove the earlier temporary grant before testing the ordinary closing hour.
  const active=(await f.overview()).overrides.filter(o=>o.user_id===f.angie);await f.api('staff_revoke_override',{ids:active.map(o=>o.id)});
  await f.clock('2026-10-01 18:59:59');await kp.locator('[data-action="library"]').click();await kp.locator('.recipe-library .recipe-card').first().waitFor();await open('Vanilla Basque');await f.clock('2026-10-01 19:00');
  await kp.locator('[data-kitchen-locked]').waitFor({timeout:5000});await kp.locator('[data-kitchen-locked="outside_hours"]').waitFor({timeout:5000});assert.equal(await kp.locator('[data-component-view]').count(),0);assert.equal(await kp.locator('#recipe-main').innerText().then(t=>t.includes('200 g')),false);await kp.screenshot({path:join(out,'kitchen-outside-hours.png'),fullPage:true,animations:'disabled'});
  const denied=await kp.evaluate(async(id)=>{const {recipeApi}=await import('/assets/ordering/client.js?v=recipe-system-3');try{await recipeApi('scale',{id});return false;}catch(error){return error.reason;}},f.vanilla.id);assert.equal(denied,'outside_hours');
 });
 await check('Back, Forward, restored pages, offline mode and saved browser storage cannot recover closed recipes',async()=>{
  await kp.goto(`${t.origin}/staff-return-test.html`);await kp.goBack();await kp.locator('[data-kitchen-locked="outside_hours"]').waitFor();await kp.goForward();await kp.goBack();await kp.locator('[data-kitchen-locked="outside_hours"]').waitFor();
  await kp.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await kp.locator('[data-kitchen-locked]').waitFor();
  const storage=await kp.evaluate(async()=>({local:{...localStorage},session:{...sessionStorage},caches:await caches.keys(),databases:await indexedDB.databases(),workers:(await navigator.serviceWorker.getRegistrations()).length}));
  for(const text of ['Vanilla','Cream cheese','CONFIDENTIAL','Philadelphia'])assert.equal(JSON.stringify(storage).includes(text),false);assert.deepEqual(storage.caches,[]);assert.equal(storage.workers,0);
  await f.clock('2026-10-02 14:00');await kp.locator('[data-action="verify-kitchen-access"]').click();await kp.locator('.recipe-library .recipe-card').first().waitFor();await open('Vanilla Basque');await kitchen.context.setOffline(true);await kp.locator('[data-kitchen-locked="connection_required"]').waitFor();assert.equal(await kp.locator('[data-component-view]').count(),0);await kitchen.context.setOffline(false);await kp.locator('h1').filter({hasText:'Vanilla Basque'}).waitFor({timeout:6000});
 });
 await check('calendar/account blocks revoke all open tabs promptly and R&D follows the same block',async()=>{
  const second=await kitchen.context.newPage();await second.goto(`${t.origin}/recipes.html?view=rd`);await second.locator('.recipe-library .recipe-card').first().waitFor();await open('R&D Basque',second);
  const start=performance.now();await f.calendar([f.angie],['2026-10-02']);
  await Promise.all([kp.locator('[data-kitchen-locked="date_blocked"]').waitFor({timeout:18000}),second.locator('[data-kitchen-locked="date_blocked"]').waitFor({timeout:18000})]);assert.ok(performance.now()-start<17500);await kp.screenshot({path:join(out,'kitchen-blocked-date.png'),fullPage:true,animations:'disabled'});
  await f.calendar([f.angie],['2026-10-02'],'restore');await kp.locator('[data-action="verify-kitchen-access"]').click();await kp.locator('h1').filter({hasText:'Vanilla Basque'}).waitFor();await f.api('staff_set_mode',{users:[f.angie],mode:'blocked'});await kp.evaluate(()=>window.dispatchEvent(new Event('focus')));await kp.locator('[data-kitchen-locked="account_blocked"]').waitFor();await kp.screenshot({path:join(out,'kitchen-account-blocked.png'),fullPage:true,animations:'disabled'});await second.close();
  await f.api('staff_set_mode',{users:[f.angie],mode:'scheduled'});await kp.locator('[data-action="verify-kitchen-access"]').click();await kp.locator('h1').filter({hasText:'Vanilla Basque'}).waitFor();
 });
 await check('a failed revalidation clears protected data and a subsequent successful check restores fresh data',async()=>{
  t.failNext('access_check');await kp.evaluate(()=>window.dispatchEvent(new Event('focus')));await kp.locator('[data-kitchen-locked="connection_required"]').waitFor();assert.equal(await kp.locator('[data-component-view]').count(),0);await kp.locator('[data-action="verify-kitchen-access"]').click();await kp.locator('h1').filter({hasText:'Vanilla Basque'}).waitFor();
 });
 await check('Owner printing and CSV exports remain available and use an explicit server authorization',async()=>{
  activePage=page;await page.locator('[data-tab="library"]').click();await open('Vanilla Basque',page);await page.evaluate(()=>{window.print=()=>{window.printCalled=true;};});
  await page.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.locator('#recipe-export-form [type="submit"]').click();await page.waitForFunction(()=>window.printCalled===true);assert.ok(await page.locator('.recipe-print-root').innerText().then(t=>t.includes('Cream cheese')));
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Ingredient CSV',exact:true}).click();const csv=await download;assert.match(csv.suggestedFilename(),/ingredients\.csv$/);await csv.saveAs(join(out,'owner-ingredients.csv'));
  assert.ok(network.filter(n=>n.user==='owner'&&n.body?.allowed&&n.body?.role==='owner').length>=4);
 });
 await check('role promotion and demotion clear elevated views without refreshing the staff JWT',async()=>{
  activePage=kp;await t.run(()=>t.db.query("insert into tlb.staff(user_id,role) values($1,'owner') on conflict(user_id) do update set role='owner'",[f.angie]));await kp.evaluate(()=>window.dispatchEvent(new Event('focus')));await kp.locator('[data-tab="staff-access"]').waitFor();await open('Vanilla Basque');assert.equal(await kp.getByRole('button',{name:'Print / PDF',exact:true}).count(),1);
  await t.run(()=>t.db.query("update tlb.staff set role='staff' where user_id=$1",[f.angie]));await kp.evaluate(()=>window.dispatchEvent(new Event('focus')));await kp.locator('.recipe-library .recipe-card').first().waitFor();assert.equal(await kp.locator('[data-tab="staff-access"]').count(),0);await open('Vanilla Basque');assert.equal(await kp.getByRole('button',{name:'Print / PDF',exact:true}).count(),0);assert.equal(await kp.locator('.recipe-print-root').count(),0);
 });
 await check('revoking one recipe clears it and reauthorization returns to the remaining permitted library',async()=>{
  await f.save(f.angie,{scope_ids:[f.matcha.id,f.research.id]});await kp.evaluate(()=>window.dispatchEvent(new Event('focus')));await kp.locator('[data-kitchen-locked="recipe_denied"]').waitFor();assert.equal(await kp.locator('[data-component-view]').count(),0);
  await kp.locator('[data-action="verify-kitchen-access"]').click();await kp.locator('.recipe-library .recipe-card').first().waitFor();assert.equal(await kp.locator('.recipe-library').getByText('Vanilla Basque',{exact:true}).count(),0);await open('Matcha Basque');
  await f.save(f.angie,{scope_ids:[f.vanilla.id,f.matcha.id,f.research.id]});await kp.evaluate(()=>window.dispatchEvent(new Event('focus')));await kp.locator('h1').filter({hasText:'Matcha Basque'}).waitFor();
 });
 await check('kitchen phone layout preserves reading, quantity controls and the Final/R&D switch',async()=>{
  await kp.setViewportSize({width:390,height:844});await kp.screenshot({path:join(out,'kitchen-phone.png'),fullPage:true,animations:'disabled'});assert.equal(await kp.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await kp.getByRole('button',{name:'R&D',exact:true}).count(),1);
 });
 assert.deepEqual(t.errors,[]);await writeFile(join(out,'results.json'),JSON.stringify({checks,results,network_responses:network.length,console_errors:t.errors},null,2));await writeFile(join(out,'network-audit.json'),JSON.stringify(network,null,2));console.log(`Staff security UI: ${checks} checks passed.`);
}catch(error){if(activePage)await activePage.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(error);console.error('PAGE ERRORS',t.errors);process.exitCode=1;}finally{await t.close();}
