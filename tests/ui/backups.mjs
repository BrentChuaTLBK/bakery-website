import {selectDashboardSection} from '../helpers/dashboard-nav.mjs';
import {completeClientFixture} from '../helpers/client-fixture.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'));
const root=resolve(import.meta.dirname,'../..'),origin='https://backups.test',out=join(root,'tests/artifacts/backups');
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=client.slice(client.indexOf('export function money('));
const status={enabled:true,spreadsheet_id:'test_sheet_1234567890123456789',pending:false,last_success_at:'2026-09-30T00:00:00Z',last_order_count:1,paid_active_count:1,unserved_count:2};
const snapshot={format:'tlb-order-backup',version:1,scope:'paid_active',generated_at:'2026-09-30T00:00:00Z',orders:[{id:'test-1',reference:'TLB-FIXTURE',fulfillment_date:'2026-10-01',data:{items:[{name:'Cake',quantity:1,unit_price_cents:10000}],total_cents:10000}}]};
const mock=completeClientFixture(client,`export const configured=true,ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{access_token:'fixture',user:{id:'owner'}}}}),onAuthStateChange:()=>{}};
export async function api(action){if(action==='admin_bootstrap')return {role:window.fixtureRole,products:[],categories:[],orders:[],inventory:[],promos:[],zones:[],staff:[],email_status:[],settings:{paused:false}};throw Error(action);}
export async function orderBackupApi(action,payload){window.backupCalls??=[];window.backupCalls.push({action,payload});if(window.failBackup)throw Error('Fixture connection unavailable');return action==='status'?window.backupStatus:{...window.backupSnapshot,scope:payload.scope};}
export async function orderBackupConnection(){if(window.failBackup)throw Error('Fixture sync unavailable');return {ok:true,connection:window.backupStatus};}
${helpers}`);
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE_PATH,headless:true});await mkdir(out,{recursive:true});
try{
 for(const [width,role] of [[1440,'owner'],[390,'owner'],[390,'staff']]){
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});
  await context.addInitScript(({role,status,snapshot})=>{window.fixtureRole=role;window.backupStatus=status;window.backupSnapshot=snapshot;},{role,status,snapshot});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('exceljs'))return route.fulfill({contentType:'text/javascript',body:await readFile(process.env.EXCELJS_PATH)});
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(url.pathname.endsWith('traffic.js')||url.pathname.endsWith('newsletter.js'))return route.fulfill({contentType:'text/javascript',body:''});
   const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({body:await readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/manage.html#backups');await page.locator('#shop-status').filter({hasText:'Shop accepting orders'}).waitFor({state:'attached'});
  if(role==='staff'){assert.equal(await page.locator('[data-view=backups]').isVisible(),false);assert.equal(await page.locator('#backup-manager').count(),0);await context.close();continue;}
  await page.locator('#backup-manager h1').waitFor();await page.getByText('Status refreshed.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#backup-manager').screenshot({path:join(out,`backups-${width}.png`)});
  await page.locator('#backup-scope').selectOption('unserved');
  const jsonDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery data'}).click();
  const file=await jsonDownload;assert.match(file.suggestedFilename(),/unserved.*json$/);const saved=JSON.parse(await readFile(await file.path(),'utf8'));assert.equal(saved.scope,'unserved');assert.equal(saved.orders[0].reference,'TLB-FIXTURE');
  const excelDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download Excel'}).click();assert.match((await excelDownload).suggestedFilename(),/xlsx$/);
  await page.evaluate(()=>window.failBackup=true);await page.getByRole('button',{name:'Back up now',exact:true}).click();await page.getByText('Fixture sync unavailable').waitFor();assert.equal(await page.getByRole('button',{name:'Download recovery data'}).isEnabled(),true);
  await page.evaluate(()=>{window.failBackup=false;window.backupStatus.last_error='quota';});await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('Needs attention',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);await context.close();
 }
 await writeFile(join(out,'result.json'),JSON.stringify({desktop:1440,mobile:390,owner:true,staffBlocked:true,jsonDownload:true,excelDownload:true,errorRecovery:true}));
 console.log('PASS backups UI: desktop/mobile, owner navigation, staff exclusion, JSON/Excel downloads and sync failure recovery');
}finally{await browser.close();}
