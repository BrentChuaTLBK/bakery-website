// Local fixtures only: no account, network API, or production data is used.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname,join,resolve,sep} from 'node:path';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://accounting-category.test';
const output=join(root,'test-results/accounting-category-filter'),results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/ordering.css"><link rel="stylesheet" href="/assets/ordering/manage.css"><link rel="stylesheet" href="/assets/ordering/accounting.css"><link rel="stylesheet" href="/assets/css/form-controls.css"></head><body class="manage-page"><main id="accounting-manager" style="max-width:1200px;margin:auto;padding:24px 16px"></main></body></html>';

function fixture() {
  const categories=[
    {id:'nori',name:'Krisp Nori & <Special>',revision:1},
    {id:'pastries',name:'Pastries',revision:1},
    {id:'website',name:'Website sales',system_key:'website',revision:1},
    {id:'archived',name:'Old packaging',archived:true,revision:1},
    {id:'empty',name:'No entries yet',revision:1}
  ];
  const entry=(id,category,kind='sale',date='2026-10-19',extra={})=>({id,category_id:category,kind,entry_date:date,amount_cents:10000,note:id,source:'Manual',revision:1,payment_method:'cash',...extra});
  const entries=Array.from({length:55},(_,i)=>entry('Nori '+String(i).padStart(2,'0'),'nori',i%2?'expense':'sale'));
  entries.push(...Array.from({length:55},(_,i)=>entry('Pastry '+String(i).padStart(2,'0'),'pastries')),
    entry('Automatic website entry','website','sale','2026-10-19',{source:'Website'}),
    entry('Historical packaging entry','archived','expense'),
    entry('Older Nori entry','nori','sale','2025-02-03'),
    entry('Future pastry entry','pastries','sale','2027-02-03'));
  return {categories,entries};
}

await mkdir(output,{recursive:true});
const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{channel:'chrome'}),headless:true});
try {
  for(const width of [1440,390,320]) {
    const state=fixture(),calls=[],errors=[],checks=[];
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<500,serviceWorkers:'block'});
    await context.exposeFunction('accountingFixtureApi',(action,payload={})=>{
      calls.push({action,payload:structuredClone(payload)});
      if(action==='accounting_report') {
        const sorted=state.entries.slice().sort((a,b)=>a.entry_date.localeCompare(b.entry_date)||a.id.localeCompare(b.id));
        const all=payload.mode==='all',entries=sorted.filter(e=>all||e.entry_date>=payload.start&&e.entry_date<=payload.end);
        const first=sorted[0]?.entry_date||null,last=sorted.at(-1)?.entry_date||null;
        return {...payload,report_version:2,start:all?first:payload.start,end:all?last:payload.end,
          first_entry:first,latest_entry:last,categories:state.categories,entries,deliveries:[],legacy_count:0,
          summary:state.categories.map(c=>({id:c.id,name:c.name,
            sales_cents:entries.filter(e=>e.category_id===c.id&&e.kind==='sale').reduce((n,e)=>n+e.amount_cents,0),
            expense_cents:entries.filter(e=>e.category_id===c.id&&e.kind==='expense').reduce((n,e)=>n+e.amount_cents,0)}))};
      }
      if(action==='accounting_save_entry') {
        const index=state.entries.findIndex(e=>e.id===payload.id);
        const saved={...payload,revision:payload.revision+1,source:'Manual'};
        if(index<0)state.entries.push(saved);else state.entries[index]=saved;
        return saved;
      }
      throw Error('Unexpected fixture action: '+action);
    });
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort();
      if(url.pathname==='/fixture.html')return route.fulfill({contentType:'text/html',body:html});
      if(url.pathname==='/assets/ordering/accounting-export.js')return route.fulfill({contentType:'text/javascript',body:'export async function exportAccounting(report){(window.accountingExports ||= []).push(structuredClone(report));}'});
      const file=resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(root+sep))return route.abort();
      try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
    });
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    const select=page.getByRole('combobox',{name:'Filter by category',exact:true});
    const rows=page.locator('.accounting-records tbody tr'),badge=page.locator('.accounting-records .badge');
    const check=async(name,fn)=>{await fn();checks.push(name);console.log(`PASS ${width}px ${name}`);};
    const idle=()=>page.waitForFunction(()=>document.querySelector('#accounting-manager').dataset.busy!=='true'&&!document.querySelector('[data-accounting=export]').disabled);
    const fits=async()=>{
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'No horizontal page overflow');
      const bounds=await select.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'Category control fits viewport');
      assert.ok(bounds.height>=44,'Category control has a usable touch target');
    };
    const setDate=async(name,value)=>page.evaluate(async({name,value})=>{
      const {setAccountingDate}=await import('/assets/ordering/accounting-date-picker.js?v=branded-calendars-1');
      setAccountingDate(document.querySelector('.accounting-filters'),name,value,{notify:true});
    },{name,value});
    try {
      await page.goto(origin+'/fixture.html');
      await page.evaluate(async()=>{
        const {mountAccounting}=await import('/assets/ordering/accounting-manager.js');
        const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        mountAccounting(document.querySelector('#accounting-manager'),{api:window.accountingFixtureApi,role:'owner',connected:true,
          today:'2026-10-19',filters:{},escapeHtml,money:value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value)/100),openOrder:async()=>{}});
      });
      await select.waitFor();await idle();
      const summaryBefore=await page.locator('.accounting-summary').innerText(),netBefore=await page.locator('.accounting-net').innerText();

      await check('All categories defaults to the selected month and offers automatic and archived categories',async()=>{
        assert.equal(await select.inputValue(),'');assert.equal(await badge.innerText(),'112 entries');assert.equal(await rows.count(),50);
        assert.equal(await select.locator('option[value="website"]').innerText(),'Website sales');
        assert.match(await select.locator('option[value="archived"]').innerText(),/Old packaging.*archived/i);
        assert.equal(await select.locator('option[value="nori"]').innerText(),'Krisp Nori & <Special>');
        assert.equal(await select.locator('special').count(),0);await fits();
      });
      await check('Filtering searches every page and retains both income and expenses',async()=>{
        await page.locator('[data-accounting=next]').click();
        await select.focus();await select.selectOption('nori');
        assert.equal(await select.evaluate(el=>el===document.activeElement),true,'Filtering preserves keyboard focus');
        assert.equal(await badge.innerText(),'55 of 112 entries');assert.equal(await rows.count(),50);
        assert.equal(await page.locator('[data-accounting=previous]').isDisabled(),true,'Changing category starts at page one');
        assert.match(await page.locator('.accounting-pagination').innerText(),/Page 1 of 2/);
        assert.ok((await rows.locator('td:nth-child(2)>strong').allTextContents()).every(name=>name==='Krisp Nori & <Special>'));
        assert.ok((await rows.locator('td:nth-child(4)').allTextContents()).some(value=>value!=='—'));
        assert.ok((await rows.locator('td:nth-child(5)').allTextContents()).some(value=>value!=='—'));
        await page.locator('[data-accounting=next]').click();assert.equal(await rows.count(),5);
        assert.equal(await page.locator('[data-accounting=next]').isDisabled(),true);
        await select.selectOption('website');assert.equal(await rows.count(),1);assert.match(await rows.innerText(),/Automatic website entry/);
        assert.equal(await page.locator('.accounting-pagination').count(),0);
      });
      await check('Archived categories and empty categories remain visible without changing overall totals',async()=>{
        await select.selectOption('archived');assert.equal(await badge.innerText(),'1 of 112 entries');assert.match(await rows.innerText(),/Historical packaging entry/);
        await select.selectOption('empty');assert.equal(await badge.innerText(),'0 of 112 entries');
        assert.equal(await rows.innerText(),'No entries for this category in the selected timeframe.');
        assert.equal(await page.locator('.accounting-summary').innerText(),summaryBefore);
        assert.equal(await page.locator('.accounting-net').innerText(),netBefore);
        assert.match(await page.locator('.accounting-records').innerText(),/all categories/i);
        await select.selectOption('archived');await fits();await select.scrollIntoViewIfNeeded();
        await page.screenshot({path:join(output,`category-${width}.png`)});
      });
      await check('Refresh and category rename preserve selection by ID',async()=>{
        await select.selectOption('nori');state.categories.find(c=>c.id==='nori').name='Krisp Nori renamed';
        await page.locator('[data-accounting=refresh]').click();await idle();
        assert.equal(await select.inputValue(),'nori');assert.equal(await select.locator('option:checked').innerText(),'Krisp Nori renamed');
        assert.equal(await badge.innerText(),'55 of 112 entries');
        assert.ok((await rows.locator('td:nth-child(2)>strong').allTextContents()).every(name=>name==='Krisp Nori renamed'));
      });
      await check('Editing an entry keeps the selected category and unsaved form context',async()=>{
        await rows.locator('[data-accounting=edit]').first().click();
        const form=page.locator('.accounting-entry-form');await form.locator('[name=amount]').fill('123.45');
        await form.locator('[name=note]').fill('Edited Nori entry');await form.locator('[type=submit]').click();await idle();
        assert.equal(await select.inputValue(),'nori');assert.match((await rows.allTextContents()).join('\n'),/Edited Nori entry/);
        await form.locator('[name=note]').fill('Unsaved draft remains');await select.selectOption('pastries');
        assert.equal(await form.locator('[name=note]').inputValue(),'Unsaved draft remains');
        assert.equal(await page.locator('#accounting-manager').getAttribute('data-dirty'),'true');
        await page.locator('[data-accounting=cancel-entry]').click();await select.selectOption('nori');
      });
      await check('Category selection combines with custom dates and All time',async()=>{
        await setDate('start','2026-10-01');await setDate('end','2026-10-18');
        await page.locator('.accounting-filters [type=submit]').click();await idle();
        assert.equal(await select.inputValue(),'nori');assert.equal(await badge.innerText(),'0 of 0 entries');
        assert.equal(await rows.innerText(),'No entries for this category in the selected timeframe.');
        await page.locator('[data-accounting=all-time]').click();await idle();
        assert.equal(await select.inputValue(),'nori');assert.equal(await badge.innerText(),'56 of 114 entries');
        await page.locator('[data-accounting=next]').click();assert.match((await rows.allTextContents()).join('\n'),/Older Nori entry/);
        assert.equal(await rows.count(),6);assert.match(await page.locator('.accounting-period-caption').innerText(),/2025-02-03 to 2027-02-03/);
      });
      await check('Export retains every category and applied timeframe while the list remains filtered',async()=>{
        await setDate('month','2028-02'); // Unapplied input must not change export scope.
        await page.locator('[data-accounting=export]').click();await idle();
        const exported=await page.evaluate(()=>window.accountingExports.at(-1));
        assert.equal(exported.mode,'all');assert.equal(exported.entries.length,114);
        assert.ok(exported.entries.some(e=>e.category_id==='pastries'));assert.ok(exported.entries.some(e=>e.category_id==='archived'));
        assert.equal(await select.inputValue(),'nori');assert.equal(await badge.innerText(),'56 of 114 entries');
        assert.ok(calls.filter(c=>c.action==='accounting_report').every(c=>!('category_filter' in c.payload)&&!('category_id' in c.payload)),'Category selection never narrows the full report request');
      });
      await check('Clear restores all entries and a removed category cannot leave a stale filter',async()=>{
        await select.selectOption('');assert.equal(await badge.innerText(),'114 entries');assert.equal(await rows.count(),50);
        assert.equal(await page.locator('[data-accounting=previous]').isDisabled(),true);
        await select.selectOption('empty');state.categories.splice(state.categories.findIndex(c=>c.id==='empty'),1);
        await page.locator('[data-accounting=refresh]').click();await idle();
        assert.equal(await select.inputValue(),'');assert.equal(await badge.innerText(),'114 entries');await fits();
      });
      assert.deepEqual(errors,[]);results.push({width,checks});
    }catch(error){await page.screenshot({path:join(output,`failure-${width}.png`),fullPage:true});throw error;}
    finally{await context.close();}
  }
  await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));
  console.log(`Accounting category filter: ${results.reduce((n,r)=>n+r.checks.length,0)} checks passed.`);
}finally{await browser.close();}
