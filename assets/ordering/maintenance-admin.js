import {api,escapeHtml as esc,manilaDate} from './client.js';
const manilaInput=value=>value?new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,16):'';
const manilaTimestamp=value=>value?new Date(value+':00+08:00').toISOString():null;
const dateTime=value=>value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
import {accountingDateTimePicker,bindAccountingDates} from './accounting-date-picker.js?v=branded-calendars-1';
export function mountMaintenance(root,{owner}){
 if(!owner){root.textContent='Sign in as an owner to manage website maintenance.';return;}
 bindAccountingDates(root);
 let saved=null,latest=null,busy=false,polling=false,alive=true,timer,receivedAt=0,requestVersion=0;
 root.innerHTML='<div class="view-heading"><div><span class="eyebrow">Website availability</span><h1>Maintenance</h1><p>Announce planned updates and control when ordering is available.</p></div><button class="button button-secondary" data-maint-refresh>Refresh</button></div><p data-maint-status role="status">Loading maintenance settings…</p><div data-maint-form></div>';
 const status=root.querySelector('[data-maint-status]');
 const connected=()=>alive&&root.isConnected;
 const completed=data=>data?.settings.mode==='scheduled'&&!data.status.active&&Date.parse(data.settings.ends_at)<=Date.parse(data.status.server_time);
 function modeLabel(){
  const f=root.querySelector('form');if(!f||!saved||!latest)return;
  const unchanged=f.elements.starts.value===manilaInput(saved.settings.starts_at)&&f.elements.ends.value===manilaInput(saved.settings.ends_at);
  const ended=saved.settings.mode==='scheduled'&&Date.parse(saved.settings.ends_at)<=Date.parse(latest.status.server_time);
  f.querySelector('[value="scheduled"]').textContent=unchanged&&ended?'Scheduled — completed':'Scheduled — start and end automatically';
 }
 function paintStatus(){
  const notice=root.querySelector('[data-maint-state]');if(!notice||!latest)return;
  const s=latest.settings,live=latest.status;
  let title='Website maintenance is off',detail='';
  if(live.active){title='Maintenance is active';detail=live.uploads_paused?'Uploads and payment deadlines are paused.':'Existing order uploads remain available.';}
  else if(completed(latest)){title='Maintenance completed';detail=`Ended ${dateTime(s.ends_at)}. Website maintenance is off.`;}
  else if(s.mode==='scheduled'){title='Maintenance is scheduled';detail=`${dateTime(s.starts_at)} to ${dateTime(s.ends_at)}`;}
  else if(live.announce){detail='Only the planned-maintenance banner is showing.';}
  notice.innerHTML=`<strong>${title}</strong>${detail?` · ${esc(detail)}`:''}`;
  const history=root.querySelector('[data-maint-history]');history.hidden=!completed(latest);history.textContent='The previous schedule is kept below for reference. Choose new dates to schedule another maintenance window.';
  root.querySelector('[data-maint-conflict]').hidden=latest.revision===saved.revision;
  modeLabel();
 }
 function accept(result){saved=result;latest=result;receivedAt=performance.now();paint();root.dataset.dirty='false';}
 function schedule(){
  clearTimeout(timer);if(!connected()||document.hidden)return;
  const server=Date.parse(latest?.status.server_time)+performance.now()-receivedAt;
  const boundary=[latest?.status.starts_at,latest?.status.ends_at].map(Date.parse).filter(t=>Number.isFinite(t)&&t>server).sort((a,b)=>a-b)[0];
  timer=setTimeout(poll,Math.max(1000,Math.min(30000,Number.isFinite(boundary)?boundary-server+150:30000)));
 }
 async function poll(){
  if(!connected())return;if(busy||polling||document.hidden){schedule();return;}
  polling=true;const version=requestVersion;
  try{
   const result=await api('maintenance_admin');if(!connected()||version!==requestVersion)return;
   if(!saved){accept(result);status.textContent='';}
   else{latest=result;receivedAt=performance.now();paintStatus();}
   root.querySelector('[data-maint-poll-error]').hidden=true;
  }catch{
   if(connected()&&version===requestVersion){const error=root.querySelector('[data-maint-poll-error]');if(error){error.textContent='Couldn’t refresh maintenance status. Showing the last confirmed status; retrying automatically.';error.hidden=false;}}
  }finally{polling=false;schedule();}
 }
 function visibility(){if(document.hidden)clearTimeout(timer);else poll();}
 function paint(){const s=saved.settings;
  root.querySelector('[data-maint-form]').innerHTML=`<section class="panel"><p class="notice" data-maint-state role="status"></p><p class="help-text" data-maint-history hidden></p><p class="notice" data-maint-conflict hidden>Maintenance settings changed elsewhere. Refresh to load them before editing; your current draft has been kept.</p><p class="form-error" data-maint-poll-error role="status" hidden></p><form class="maintenance-form"><label class="field">Maintenance mode<select name="mode"><option value="off" ${s.mode==='off'?'selected':''}>Off — website open</option><option value="manual" ${s.mode==='manual'?'selected':''}>On now — switch off manually</option><option value="scheduled" ${s.mode==='scheduled'?'selected':''}>Scheduled — start and end automatically</option></select></label><div class="field-row">${accountingDateTimePicker('starts','Planned start · Manila',manilaInput(s.starts_at),manilaDate(),{optional:s.mode!=='scheduled'})}${accountingDateTimePicker('ends','Planned end · Manila',manilaInput(s.ends_at),manilaDate(),{optional:s.mode!=='scheduled'})}</div><p class="help-text">Scheduled mode uses these times automatically. In manual mode they announce the plan; maintenance stays on until you turn it off.</p><label class="maintenance-check"><input name="announce" type="checkbox" ${s.announce?'checked':''}>Show a planned-maintenance banner</label><p class="help-text">Use Off with the banner checked to announce an upcoming update without closing the website. The announcement disappears after the planned end.</p><label class="field">Customer message<textarea name="message" required maxlength="400" rows="3">${esc(s.message)}</textarea></label><label class="maintenance-check"><input name="pause_uploads" type="checkbox" ${s.pause_uploads?'checked':''}>Pause payment-proof uploads and their deadlines during maintenance</label><p class="help-text">Recommended for order or payment-system updates. Customers keep their remaining upload time when maintenance ends. Already-expired orders stay expired. Uncheck for visual updates that can safely keep uploads available.</p><p class="help-text">New orders stop during maintenance. Customers can still sign in and view existing orders; your team dashboard stays accessible. Turning maintenance off does not override “Pause new orders” in Shop settings.</p><div class="notice" data-maint-preview></div><p class="form-error" role="alert"></p><button class="button" type="submit">Save maintenance settings</button></form></section>`;
  preview();paintStatus();
 }
 function preview(){const f=root.querySelector('form');if(!f)return;f.querySelectorAll('.accounting-date-picker').forEach(picker=>{picker.dataset.optional=String(f.elements.mode.value!=='scheduled');});root.dataset.dirty='true';modeLabel();f.querySelector('[data-maint-preview]').textContent='Banner preview: '+f.elements.message.value+(f.elements.starts.value?' · '+f.elements.starts.value.replace('T',' ')+(f.elements.ends.value?' to '+f.elements.ends.value.replace('T',' '):'')+' Manila time':'');}
 async function load(){if(busy)return;busy=true;requestVersion++;clearTimeout(timer);try{const result=await api('maintenance_admin');if(!connected())return;accept(result);status.textContent='';}catch(e){if(connected())status.textContent=e.message;}finally{busy=false;schedule();}}
 root.querySelector('[data-maint-refresh]').onclick=()=>{if(root.dataset.dirty==='true'){status.textContent='Save your changes before refreshing, or reopen Maintenance to discard them.';return;}load();};
 root.addEventListener('input',preview);root.addEventListener('change',preview);
 root.addEventListener('submit',async e=>{if(!e.target.matches('.maintenance-form'))return;e.preventDefault();if(busy||!e.target.reportValidity())return;const f=e.target,button=f.querySelector('[type=submit]'),error=f.querySelector('.form-error');busy=true;requestVersion++;clearTimeout(timer);root.dataset.busy='true';button.disabled=true;error.textContent='';
  try{const result=await api('save_maintenance',{revision:saved.revision,settings:{mode:f.elements.mode.value,announce:f.elements.announce.checked,pause_uploads:f.elements.pause_uploads.checked,message:f.elements.message.value.trim(),starts_at:f.elements.starts.value?manilaTimestamp(f.elements.starts.value):null,ends_at:f.elements.ends.value?manilaTimestamp(f.elements.ends.value):null}});if(!connected())return;accept(result);status.textContent='Maintenance settings saved.';}
  catch(e){error.textContent=e.message;}finally{busy=false;root.dataset.busy='false';button.disabled=false;schedule();}
 });document.addEventListener('visibilitychange',visibility);load();
 return {destroy(){alive=false;requestVersion++;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);}};
}
