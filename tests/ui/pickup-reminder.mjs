import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
const require=createRequire(import.meta.url), {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://pickup-reminder.test',output=join(root,'test-results/pickup-reminder');
const base={id:'ready',reference:'TLB-A2B3C4',revision:3,created_at:'2026-09-24T01:00:00Z',fulfillment_date:'2026-09-24',method:'pickup',payment_status:'paid',fulfillment_status:'ready_for_pickup',buyer:{name:'Test Customer',email:'customer@example.test',phone:'09171234567'},items:[{name:'Nori',quantity:1,unit_price_cents:13000,line_total_cents:13000}],history:[],subtotal_cents:13000,total_cents:13000,discount_cents:0,delivery_cents:0,paid_amount_cents:13000,pickup_address:'Test kitchen address'};
const orders=[base,{...base,id:'completed',fulfillment_status:'completed'},{...base,id:'delivery',method:'delivery',fulfillment_status:'out_for_delivery'},{...base,id:'refund',refund_label:true},{...base,id:'unpaid',payment_status:'under_review'},{...base,id:'preparing',fulfillment_status:'preparing'}];
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const mock=`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:'staff'}}}}),onAuthStateChange:()=>{}};
export async function api(action,payload={}){const r=await fetch('/fixture-api',{method:'POST',body:JSON.stringify({action,payload})});const data=await r.json();if(!r.ok)throw Error(data.error);return data}
export async function upload(){throw Error('Unexpected upload')} export async function websiteVisitorStats(){return {}};${helpers}`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,headless:true});
try{
  for(const width of [1440,390]){
    const rows=structuredClone(orders),calls=[];
    let failNext=true;
    const ctx=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,serviceWorkers:'block'});
    await ctx.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
      if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
      if(url.pathname==='/fixture-api'){
        const {action,payload}=route.request().postDataJSON();calls.push({action,payload});
        let response;
        if(action==='admin_bootstrap')response={role:width<500?'staff':'owner',products:[],categories:[],orders:rows,inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}};
        else if(action==='get_order')response=rows.find(o=>o.id===payload.order_id);
        else if(action==='send_pickup_reminder'){
          await new Promise(r=>setTimeout(r,80));
          if(failNext){failNext=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture network failure. Please retry.'})});}
          response=rows.find(o=>o.id===payload.order_id);
          response.pickup_reminder={id:'reminder-'+calls.length,status:'pending',requested_at:new Date().toISOString(),next_allowed_at:new Date(Date.now()+900000).toISOString()};
          response.history.push({action:'pickup_reminder_requested',at:new Date().toISOString(),actor:'Staff',reason:'Pickup reminder email queued for the customer.'});
        }else throw Error('Unexpected action '+action);
        return route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
      }
      const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();
      try{return await route.fulfill({body:await readFile(file),contentType:mime[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    });
    const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/manage.html');await page.locator('[data-view="orders"]').click();
    const open=async id=>{await page.locator(`[data-action="open-order"][data-id="${id}"]`).click();await page.locator('#dialog-title').filter({hasText:'TLB-A2B3C4'}).waitFor();};
    const button=page.locator('[data-action="send-pickup-reminder"]');
    await open('ready');await button.waitFor();
    assert.match(await page.locator('.pickup-reminder').textContent(),/customer@example.test/);
    assert.equal(await button.isEnabled(),true);
    await button.scrollIntoViewIfNeeded();
    await page.locator('.pickup-reminder').screenshot({path:join(output,`button-${width}.png`)});
    await button.click();
    await page.getByText('Fixture network failure. Please retry.',{exact:true}).waitFor();
    assert.equal(await button.isEnabled(),true,'Failed request can be retried');
    await button.click();await button.dispatchEvent('click');
    await page.locator('.pickup-reminder').getByText('Reminder queued',{exact:true}).waitFor();
    const sends=calls.filter(c=>c.action==='send_pickup_reminder');
    assert.equal(sends.length,2,'Rapid repeated clicks do not enqueue more requests');
    assert.equal(sends[0].payload.idempotency_key,sends[1].payload.idempotency_key,'Network retry keeps its key');
    assert.equal(await button.isDisabled(),true);
    assert.match(await page.locator('.pickup-reminder').textContent(),/queued for delivery/);
    assert.equal(rows[0].fulfillment_status,'ready_for_pickup');
    assert.equal(rows[0].revision,3);
    assert.equal(await page.locator('#admin-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Dialog has no horizontal overflow');
    rows[0].pickup_reminder.status='sent';rows[0].pickup_reminder.sent_at=new Date().toISOString();
    await page.locator('[data-action="refresh-pickup-reminder"]').click();
    await page.locator('.pickup-reminder [role="status"]').filter({hasText:'Last reminder sent'}).waitFor();
    assert.match(await page.locator('.pickup-reminder').textContent(),/Last reminder sent/);
    assert.equal(await button.isDisabled(),true,'Cooldown remains visible after provider acceptance');
    rows[0].pickup_reminder.next_allowed_at=new Date(Date.now()-1000).toISOString();
    await page.locator('[data-action="refresh-pickup-reminder"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-action="send-pickup-reminder"]').disabled);
    assert.equal(await button.isEnabled(),true,'Another reminder is available after cooldown');
    await button.click();await page.locator('.pickup-reminder').getByText('Reminder queued',{exact:true}).waitFor();
    const allSends=calls.filter(c=>c.action==='send_pickup_reminder');
    assert.equal(allSends.length,3);assert.notEqual(allSends[2].payload.idempotency_key,allSends[1].payload.idempotency_key);
    await page.locator('#dialog-close').click();
    for(const id of ['completed','delivery','refund','unpaid','preparing']){
      await open(id);assert.equal(await button.count(),0,`${id} has no pickup reminder button`);await page.locator('#dialog-close').click();
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS pickup reminders ${width}px: ${width<500?'staff':'owner'}, eligibility, queue feedback, duplicate clicks, stable retry key, cooldown and refresh`);
    await ctx.close();
  }
}finally{await browser.close();}
