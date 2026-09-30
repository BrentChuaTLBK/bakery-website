import {escapeHtml as esc} from './client.js?v=order-backups-2';
import {buildBackupWorkbook,validateBackup} from './order-backup.js?v=brand-20261001';
const errors={proof_missing:'An attached proof image could not be copied. The last good backup has been kept; check the image in the order and try again.',access:'Google access was denied. Check that the backup spreadsheet and proof ZIP are shared with the service account as an Editor.',api_disabled:'Enable Google Sheets API and Google Drive API in the service account’s Google Cloud project.',configuration:'The Google connection or the Orders, Items and Recovery tabs need attention.',quota:'Google has temporarily limited requests. The next scheduled run will retry.',too_large:'The backup is too large for this spreadsheet sync. Download the JSON recovery file and contact support.',network:'The last sync could not reach the backup service. It will retry automatically.'};
const date=value=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'Not yet';
const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
export function mountBackups(root,{role,connected,api,connection,archive,save=download}) {
 if(role!=='owner'||!connected){root.innerHTML='<p class="notice">Sign in as the owner to manage order backups.</p>';return;}
 let status=null,busy=false,scope='paid_active',message='';
 const render=()=>{
  if(!root.isConnected)return;
  root.innerHTML=`<div class="section-heading"><div><p class="eyebrow">Protect your orders</p><h1>Backups</h1><p>Keep a copy of orders that still need to be served.</p></div><button class="button button-secondary" data-backup="refresh" ${busy?'disabled':''}>Refresh status</button></div>
   <p role="status" class="backup-feedback">${esc(message)}</p>
   <div class="backup-grid"><section class="panel backup-card"><h2>Google Drive backup</h2>
    <p>Paid orders and payments under review, still awaiting fulfillment. Includes orders waiting for your payment check and overdue orders. Completed, cancelled and refunded orders leave the active sheet on the next successful sync.</p>
    <dl class="backup-status"><div><dt>Status</dt><dd>${!status?'Loading…':status.last_error?'Needs attention':!status.enabled?'Not connected':status.busy?'Syncing…':status.pending?'Changes waiting to sync':'Up to date'}</dd></div><div><dt>Paid / under review to serve</dt><dd>${status?.paid_active_count??'—'}</dd></div><div><dt>Last successful copy</dt><dd>${esc(date(status?.last_success_at))}</dd></div><div><dt>Orders in last copy</dt><dd>${status?.last_order_count??'—'}</dd></div><div><dt>Proof images in last copy</dt><dd>${status?.last_proof_count??'—'}</dd></div></dl>
    ${status?.last_error?`<p class="notice">${esc(errors[status.last_error]||errors.network)}</p>`:''}
    <p class="muted">Checks every five minutes, even when this dashboard is closed. Unchanged data is skipped; a daily refresh repairs accidental sheet edits.</p>
    <div class="backup-actions">${status?.spreadsheet_id?`<a class="button button-secondary" href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(status.spreadsheet_id)}/edit" target="_blank" rel="noopener noreferrer">Open backup sheet</a>`:''}${status?.archive_file_id?`<a class="button button-secondary" href="https://drive.google.com/file/d/${encodeURIComponent(status.archive_file_id)}/view" target="_blank" rel="noopener noreferrer">Open proof ZIP</a>`:''}<button class="button" data-backup="sync" ${busy||!status?.enabled?'disabled':''}>Back up now</button></div>
    ${!status?.enabled?'<p class="muted">Automatic backup setup is pending. You can download an order copy now.</p>':''}
   </section><section class="panel backup-card"><h2>Download a copy</h2><p>Save a current snapshot to your device whenever you need it.</p>
    <label for="backup-scope">Orders to include</label><select id="backup-scope" ${busy?'disabled':''}><option value="paid_active" ${scope==='paid_active'?'selected':''}>Paid or under-review orders to serve</option><option value="unserved" ${scope==='unserved'?'selected':''}>All unserved orders, including unpaid</option></select>
    <p class="muted">${status?.unserved_count??'—'} unserved website and direct orders in total.</p>
    <div class="backup-actions"><button class="button" data-backup="zip" ${busy||!status?'disabled':''}>Download with proofs (ZIP)</button><button class="button button-secondary" data-backup="excel" ${busy||!status?'disabled':''}>Download Excel</button><button class="button button-secondary" data-backup="json" ${busy||!status?'disabled':''}>Download recovery data</button></div>
    <p>The ZIP includes recovery data and actual proof images grouped by order number. Excel includes order details, flavors and a recovery-data tab. The JSON file keeps structured order, payment, history and inventory reservation records.</p>
   </section></div>
   <section class="panel backup-card backup-limits"><h2>What this protects</h2><p>This is an operational copy for recovering unserved orders. It supplements your Supabase daily database backups. Keep downloaded files private because they contain customer details.</p><p>Actual payment-proof images are saved in the private ZIP beside your Google spreadsheet. The manual ZIP also includes images; Excel and JSON contain file paths only. Customer access links are excluded. This is not a full website or database restore. Changes made in Google Sheets do not change website orders.</p></section>`;
  root.querySelector('#backup-scope').addEventListener('change',e=>scope=e.target.value);
  root.querySelectorAll('[data-backup]').forEach(button=>button.addEventListener('click',()=>run(button.dataset.backup)));
 };
 async function run(action){
  if(busy)return;busy=true;message=action==='refresh'?'Checking backup status…':action==='sync'?'Copying current orders to Google Drive…':'Preparing your download…';render();
  try {
   if(action==='refresh')status=await api('status');
   else if(action==='sync'){
    const result=await connection('sync');status=result.connection||await api('status');
    if(result.ok===false)throw Error(errors[status.last_error]||errors.network);
    message=result.skipped==='busy'?'A backup is already running. Refresh status shortly.':'Google Drive backup updated.';
   }else if(action==='zip'){
    save(await archive(scope),`TLB-orders-and-proofs-${scope}-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`);
    message='Downloaded recovery data and attached proof images.';
   }else{
    const snapshot=validateBackup(await api('download',{scope}));
    const name=`TLB-orders-${scope}-${snapshot.generated_at.replace(/[:.]/g,'-')}`;
    if(action==='json')save(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),name+'.json');
    else{const {excelLibrary}=await import('./accounting-export.js?v=brand-20261001');const wb=buildBackupWorkbook(snapshot,await excelLibrary());save(new Blob([await wb.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name+'.xlsx');}
    message=`Downloaded ${snapshot.orders.length} orders.`;
   }
   if(action==='refresh')message='Status refreshed. Times are shown in Asia/Manila.';
  }catch(error){message=error.message||'Backup request failed. Please try again.';}
  finally{busy=false;render();}
 }
 render();run('refresh');
}
