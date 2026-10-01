const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const labels={scheduled:'Allowed Now',always_allowed:'Allowed Now',outside_hours:'Closed — Outside Hours',date_blocked:'Blocked Today',temporary_allow:'Temporarily Allowed',temporary_block:'Temporarily Blocked',account_blocked:'Account Blocked',account_unavailable:'Email verification required'};
const eventLabels={recipe_opened:'Opened recipe',recipe_scaled:'Scaled recipe',access_denied:'Access denied',export_attempt:'Export attempt',copy_deterrent:'Copy deterrent',dates_blocked:'Blocked recipe dates',dates_restored:'Restored scheduled access',calendar_undone:'Undid calendar change',staff_permissions_changed:'Changed staff permissions',account_mode_changed:'Changed account access mode',default_hours_changed:'Changed default hours',temporary_allow_created:'Granted temporary access',temporary_block_created:'Created temporary block',temporary_override_ended:'Ended temporary override'};
const modeLabels={scheduled:'Scheduled',always:'Always Allowed',blocked:'Blocked'};
const isoDay=date=>date.toISOString().slice(0,10);
const utcDay=value=>new Date(`${value}T00:00:00Z`);
export function addCalendarDays(value,amount){const date=utcDay(value);date.setUTCDate(date.getUTCDate()+amount);return isoDay(date);}
export function calendarDays(month){
 const first=utcDay(`${month}-01`),start=addCalendarDays(isoDay(first),-((first.getUTCDay()+6)%7));
 return Array.from({length:42},(_,i)=>addCalendarDays(start,i));
}
export function calendarDateState(selected,date,blocks){
 const count=[...selected].filter(id=>blocks.has(`${id}:${date}`)).length,total=selected.size;
 return {count,total,state:count===0?'normal':count===total?'blocked':'mixed',label:!total?'Select staff':count===0?'Normal':count===total?'Blocked':`Mixed · ${count} of ${total} blocked`};
}
function manilaInput(value){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
const prettyDate=value=>utcDay(value).toLocaleDateString('en-PH',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'});
const prettyTime=value=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
const clockLabel=value=>{if(!value)return '—';const [h,m]=value.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;};
function hoursSummary(hours){const enabled=(hours||[]).filter(h=>h.enabled);if(!enabled.length)return 'No scheduled hours';if(enabled.every(h=>h.start===enabled[0].start&&h.end===enabled[0].end))return `${enabled.length===7?'Every day':enabled.map(h=>days[h.day-1].slice(0,3)).join(', ')} · ${clockLabel(enabled[0].start)}–${clockLabel(enabled[0].end)}`;return 'Hours vary by day';}
export function summarizeDates(values){
 const sorted=[...values].sort(),ranges=[];let first,last;
 for(const d of sorted){if(last&&addCalendarDays(last,1)!==d){ranges.push(first===last?prettyDate(first):`${prettyDate(first)}–${prettyDate(last)}`);first=null;}first??=d;last=d;}
 if(first)ranges.push(first===last?prettyDate(first):`${prettyDate(first)}–${prettyDate(last)}`);return ranges.join('; ');
}
function hoursFields(hours,prefix='hours'){
 return `<div class="staff-hours" data-hours="${prefix}"><div class="staff-hours-heading"><span>Day</span><span>Start</span><span>End</span></div>${[...hours].sort((a,b)=>a.day-b.day).map(h=>`<div class="staff-hours-row" data-hours-day="${h.day}"><label class="recipe-inline-check"><input type="checkbox" name="${prefix}_enabled_${h.day}" ${h.enabled?'checked':''}>${days[h.day-1]}</label><label><span class="sr-only">${days[h.day-1]} start</span><input type="time" name="${prefix}_start_${h.day}" value="${esc(h.start)}" required></label><label><span class="sr-only">${days[h.day-1]} end</span><input type="time" name="${prefix}_end_${h.day}" value="${esc(h.end)}" required></label></div>`).join('')}</div>`;
}
function readHours(form,prefix='hours'){
 const data=new FormData(form);return days.map((_,i)=>({day:i+1,enabled:data.has(`${prefix}_enabled_${i+1}`),start:String(data.get(`${prefix}_start_${i+1}`)),end:String(data.get(`${prefix}_end_${i+1}`))}));
}

export async function openStaffAccess({root,api,shell,dialog,closeDialog,confirm,notify,openAccounts,isActive=()=>true,state:s={}}){
 s.selected??=new Set();s.dates??=new Set();s.tab??='calendar';s.staffFilter??='active';s.query??='';s.error='';
 let data,activity={rows:[],flags:[]},pending=false,disposed=false;
 const selection=()=>data.staff.filter(p=>s.selected.has(p.user_id));
 const selectedNames=()=>selection().map(p=>p.name).join(', ');
 function selectedSummary(){return `<div class="staff-selection-summary"><strong>${s.selected.size} Staff Selected</strong><span>${esc(selectedNames()||'Select staff to edit recipe access.')}</span></div>`;}
 function contextHeading(){
  const people=selection(),names=people.slice(0,2).map(p=>p.name).join(' + '),extra=people.length>2?` + ${people.length-2} more`:'';
  const dates=[...s.dates].sort(),shortDate=value=>utcDay(value).toLocaleDateString('en-PH',{timeZone:'UTC',month:'short',day:'numeric',...(value.slice(0,4)!==s.month?.slice(0,4)?{year:'numeric'}:{})});
  const dateSummary=dates.length?`${dates.length} ${dates.length===1?'date':'dates'}${dates.length<=2?' · '+dates.map(shortDate).join(', '):' selected'}`:'Choose dates';
  const showSelection=s.tab==='calendar'||s.tab==='temporary';
  return `<header class="staff-context-heading"><div><h1>Staff Access</h1><p>Kitchen recipe access · Asia/Manila</p></div>${showSelection?`<div class="staff-context-selection" aria-label="Current selection"><strong title="${esc(selectedNames())}">${people.length?esc(names+extra)+' selected':'Choose staff'}</strong><span>${esc(s.tab==='calendar'?dateSummary:`${people.length} ${people.length===1?'person':'people'} for temporary access`)}</span></div>`:''}</header>`;
 }
 function staffSelector(){
  const filtered=data.staff.filter(p=>{const query=s.query.toLowerCase();return (!query||`${p.name} ${p.email}`.toLowerCase().includes(query))&&(s.staffFilter==='all'||s.staffFilter==='active'&&p.active&&p.mode!=='blocked'||s.staffFilter==='allowed'&&p.access.allowed||s.staffFilter==='blocked'&&!p.access.allowed);});
  return `<aside class="staff-selector recipe-card"><h3>1. Select Staff</h3><label>Search staff<input type="search" data-staff-search value="${esc(s.query)}" placeholder="Name or email"></label><label>Show<select data-staff-filter>${[['active','Active Staff'],['all','All Kitchen Staff'],['allowed','Currently Allowed'],['blocked','Currently Blocked']].map(([v,t])=>`<option value="${v}" ${s.staffFilter===v?'selected':''}>${t}</option>`).join('')}</select></label><div class="staff-selector-actions"><button type="button" data-staff-action="select-all">Select all active</button><button type="button" data-staff-action="clear-staff">Clear</button></div><div class="staff-people">${filtered.map(p=>`<label class="staff-person"><input type="checkbox" data-staff-person="${p.user_id}" ${s.selected.has(p.user_id)?'checked':''}><span><strong>${esc(p.name)}</strong><small>${esc(labels[p.access.reason]||p.access.reason)}</small></span></label>`).join('')||'<p class="recipe-muted">No matching Kitchen Staff.</p>'}</div>${selectedSummary()}</aside>`;
 }
 function calendar(){
  const dates=calendarDays(s.month),blocks=new Set(data.dates.filter(d=>d.blocked).map(d=>`${d.user_id}:${d.date}`));
  const month=utcDay(`${s.month}-01`).toLocaleDateString('en-PH',{timeZone:'UTC',month:'long',year:'numeric'});
  return `<div class="staff-workspace">${staffSelector()}<section class="recipe-card staff-calendar"><div class="staff-calendar-heading"><div><h3>2. Select Dates</h3><p class="recipe-muted">Every normal date follows the selected staff’s access hours.</p></div><div class="staff-month-nav"><button type="button" data-staff-action="previous-month" aria-label="Previous month">←</button><h4>${month}</h4><button type="button" data-staff-action="next-month" aria-label="Next month">→</button><button type="button" data-staff-action="today">Today</button></div></div>
   <div class="staff-calendar-legend"><span><i class="normal"></i>Normal</span><span><i class="blocked"></i>Blocked</span><span><i class="mixed"></i>Mixed</span></div>
   <div class="staff-calendar-weekdays" aria-hidden="true">${days.map(d=>`<span>${d.slice(0,3)}</span>`).join('')}</div><div class="staff-calendar-grid" role="group" aria-label="${month} access dates">${dates.map(date=>{
    const status=calendarDateState(s.selected,date,blocks),today=manilaInput(data.server_now).slice(0,10)===date;
    return `<button type="button" data-staff-date="${date}" class="staff-calendar-day ${status.state} ${date.startsWith(s.month)?'':'other-month'} ${today?'today':''}" aria-pressed="${s.dates.has(date)}" aria-label="${esc(prettyDate(date))}: ${esc(status.label)}${today?', today':''}"><strong>${Number(date.slice(-2))}</strong><span>${esc(status.label)}</span>${s.dates.has(date)?'<span class="staff-day-selected" aria-hidden="true">✓</span>':''}</button>`;
   }).join('')}</div>
   <form class="staff-date-range" id="staff-date-range"><label>Start date<input type="date" name="from" value="${esc(s.rangeFrom||`${s.month}-01`)}" required></label><label>End date<input type="date" name="to" value="${esc(s.rangeTo||`${s.month}-01`)}" required></label><button type="submit">Select date range</button></form>
   <div class="staff-date-summary"><strong>${s.dates.size} ${s.dates.size===1?'Date':'Dates'} Selected</strong><span>${esc(s.dates.size?summarizeDates(s.dates):'Tap dates above or select a range.')}</span><button type="button" data-staff-action="clear-dates" ${s.dates.size?'':'disabled'}>Clear date selection</button></div>
   <div class="staff-calendar-apply"><div><strong>3. Apply to Selected Staff</strong><small>${s.selected.size} staff × ${s.dates.size} dates = ${s.selected.size*s.dates.size} Staff-Date changes</small></div><div class="recipe-actions"><button type="button" class="danger" data-staff-action="block" ${!s.selected.size||!s.dates.size||pending?'disabled':''}>Block Selected Dates</button><button type="button" data-staff-action="restore" ${!s.selected.size||!s.dates.size||pending?'disabled':''}>Restore Scheduled Access</button></div></div>
   <p class="recipe-muted staff-rule-note">Date blocks apply to Final and R&D recipes. Temporary Allow Anytime can override a date block. Account blocks always take priority. Restoring a date keeps each person’s access mode and normal hours.</p>
  </section></div>`;
 }
 function staffTable(){
  return `<section class="recipe-card"><div class="recipe-section-head"><div><h3>Kitchen Staff</h3><p class="recipe-muted">Manage schedules, recipe scope and R&D permission. Use the Access Calendar for blocked dates.</p></div><button type="button" data-staff-action="accounts">Accounts & invitations</button></div><div class="recipe-table-wrap"><table class="recipe-table staff-overview"><thead><tr><th>Staff</th><th>Recipe Scope</th><th>Access Mode</th><th>Hours</th><th>Today</th><th>Current Status</th><th>Actions</th></tr></thead><tbody>${data.staff.map(p=>`<tr><td><strong>${esc(p.name)}</strong><small>${esc(p.email)}</small>${p.can_view_rd?'<small>Final + R&D</small>':'<small>Final recipes</small>'}</td><td>${p.scope_mode==='all'?'All production':p.scope_mode==='categories'?`${p.scope_ids.length} selected categories`:`${p.scope_ids.length} selected recipes`}</td><td>${modeLabels[p.mode]}</td><td>${p.mode==='always'?'Any time':esc(hoursSummary(p.hours||data.hours))}</td><td>${p.access.calendar_blocked?'Blocked Today':'Normal'}</td><td><span class="staff-status ${p.access.allowed?'allowed':'closed'}">${esc(labels[p.access.reason]||p.access.reason)}</span></td><td><div class="staff-row-actions"><button type="button" data-staff-action="edit-staff" data-id="${p.user_id}">Settings</button><button type="button" data-staff-action="${p.mode==='blocked'?'restore-account':'block-account'}" data-id="${p.user_id}" ${p.mode==='blocked'?'':'class="danger"'}>${p.mode==='blocked'?'Restore account':'Block account'}</button><button type="button" data-staff-action="staff-activity" data-id="${p.user_id}">Activity</button></div></td></tr>`).join('')||'<tr><td colspan="7">No Kitchen Staff yet. Add an account or invitation above.</td></tr>'}</tbody></table></div></section>`;
 }
 function defaults(){return `<section class="recipe-card staff-hours-card"><h3>Default Kitchen Access Hours</h3><p class="recipe-muted">Asia/Manila · Applies to Scheduled staff who use default hours. Saturday and Sunday are included.</p><form id="staff-default-hours">${hoursFields(data.hours)}<p class="recipe-muted">Access opens at the start time and closes at the end time. Use same-day hours.</p><button type="submit" class="primary">Save Default Hours</button></form></section>`;}
 function temporary(){
  const draft=s.overrideDraft||{},start=draft.starts_local??manilaInput(data.server_now),end=draft.ends_local??manilaInput(new Date(new Date(data.server_now).getTime()+2*3600000));
  return `<div class="staff-workspace">${staffSelector()}<section class="recipe-card"><h3>Temporary Overrides</h3><p class="recipe-muted">Overrides expire automatically. Times use Asia/Manila. A blocked account stays blocked until you restore it.</p><form id="staff-override-form"><div class="recipe-fields two"><label>Action<select name="kind"><option value="allow">Temporary Allow Anytime</option><option value="block" ${draft.kind==='block'?'selected':''}>Temporary Block</option></select></label><label class="wide">Staff${selectedSummary()}</label><label>Start<input type="datetime-local" name="starts_local" value="${esc(start)}" required></label><label>End<input type="datetime-local" name="ends_local" value="${esc(end)}" required></label><label class="wide">Note · optional<input name="note" value="${esc(draft.note||'')}" maxlength="500" placeholder="For example, an evening production run"></label></div><button type="submit" class="primary" ${s.selected.size?'':'disabled'}>Apply Temporary Override</button></form>
   <h3 class="staff-upcoming-title">Current & Upcoming</h3><div class="staff-override-list">${data.overrides.map(o=>`<article><div><strong>${esc(data.staff.find(p=>p.user_id===o.user_id)?.name||'Former Kitchen Staff')}</strong><span class="staff-status ${o.kind==='allow'?'allowed':'closed'}">${o.kind==='allow'?'Temporary Allow Anytime':'Temporary Block'}</span><p>${prettyTime(o.starts_at)} → ${prettyTime(o.ends_at)}</p>${o.note?`<p class="recipe-muted">${esc(o.note)}</p>`:''}</div><button type="button" data-staff-action="end-override" data-id="${o.id}">End override</button></article>`).join('')||'<p class="recipe-muted">No active or upcoming overrides.</p>'}</div></section></div>`;
 }
 function activityView(){return `<section class="recipe-card"><div class="recipe-section-head"><h3>Recipe Access Activity</h3><label>Staff<select data-staff-activity-filter><option value="">All staff</option>${data.staff.map(p=>`<option value="${p.user_id}" ${s.activityUser===p.user_id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></div><p class="recipe-muted">Times use Asia/Manila. Records cover recipe access and permission changes.</p>${activity.flags.length?`<div class="staff-security-flags"><h4>Recent patterns · last 5 minutes</h4>${activity.flags.map(f=>`<p><strong>${esc(f.name||'Former staff')}</strong>: ${[f.export_attempts?`${f.export_attempts} export attempts`:'',f.denied_requests>=5?`${f.denied_requests} denied requests`:'',f.recipe_openings>=20?`${f.recipe_openings} recipe openings`:''].filter(Boolean).join(' · ')}</p>`).join('')}</div>`:''}<div class="recipe-table-wrap"><table class="recipe-table staff-activity"><thead><tr><th>Time</th><th>Staff / Admin</th><th>Event</th><th>Details</th></tr></thead><tbody>${activity.rows.map(e=>`<tr><td>${prettyTime(e.created_at)}${e.occurrences>1?`<small>${e.occurrences} occurrences</small>`:''}</td><td>${esc(e.name||e.actor_name||'Former account')}${e.name&&e.actor_name&&e.actor!==e.user_id?`<small>By ${esc(e.actor_name)}</small>`:''}</td><td>${esc(eventLabels[e.action]||e.action)}</td><td>${esc(e.recipe_name||'')}${e.reason?`<small>${esc(labels[e.reason]||e.reason.replaceAll('_',' '))}</small>`:''}${e.details?.users?`<small>${esc(e.details.users.map(id=>data.staff.find(p=>p.user_id===id)?.name||'Former staff').join(', '))}</small>`:''}${e.details?.dates?`<small>${esc(summarizeDates(e.details.dates))}</small>`:''}${e.details?.mode?`<small>${modeLabels[e.details.mode]||esc(e.details.mode)}</small>`:''}${e.details?.ends_at?`<small>Until ${prettyTime(e.details.ends_at)}</small>`:''}</td></tr>`).join('')||'<tr><td colspan="4">No recent access events.</td></tr>'}</tbody></table></div>${activity.rows.length&&activity.hasMore?'<button type="button" data-staff-action="more-activity">Load older activity</button>':''}</section>`;}
 function render(){
  if(disposed||!isActive())return;
  shell(`<section class="staff-access" data-staff-access><div class="staff-overview-counts"><span><strong>${data.staff.length}</strong> Kitchen Staff</span><span><strong>${data.staff.filter(p=>p.access.allowed).length}</strong> Allowed Now</span><span><strong>${data.staff.filter(p=>!p.access.allowed).length}</strong> Closed or Blocked</span><button type="button" data-staff-action="refresh">Refresh status</button></div><nav class="staff-tabs" aria-label="Staff access sections">${[['calendar','Access Calendar'],['staff','Staff'],['hours','Default Hours'],['temporary','Temporary Overrides'],['activity','Activity']].map(([key,text])=>`<button type="button" data-staff-tab="${key}" ${key===s.tab?'aria-current="page"':''}>${text}</button>`).join('')}</nav>${s.error?`<p class="recipe-error" role="alert">${esc(s.error)}</p>`:''}${s.lastAction?`<div class="staff-undo" role="status"><span>${esc(s.lastAction.message)}</span><button type="button" data-staff-action="undo" ${pending?'disabled':''}>Undo</button></div>`:''}${({calendar,staff:staffTable,hours:defaults,temporary,activity:activityView}[s.tab]||calendar)()}</section>`,{heading:contextHeading()});
  const area=root.querySelector('[data-staff-access]');
  area.querySelector('#staff-override-form')?.addEventListener('input',event=>{s.overrideDraft=Object.fromEntries(new FormData(event.currentTarget));});
  area.addEventListener('click',click);area.addEventListener('change',change);area.addEventListener('submit',submit);
  area.querySelector('[data-staff-search]')?.addEventListener('input',event=>{s.query=event.target.value;const pos=event.target.selectionStart;render();const input=root.querySelector('[data-staff-search]');input?.focus();if(input?.type!=='search')input?.setSelectionRange(pos,pos);});
 }
 async function loadActivity({append=false}={}){
  const rows=await api('staff_activity',{user_id:s.activityUser||null,limit:100,...(append?{before:activity.rows.at(-1)?.id}:{})});activity={...rows,rows:append?[...activity.rows,...rows.rows]:rows.rows,hasMore:rows.rows.length===100};
 }
 async function load(){
  let range=s.month?calendarDays(s.month):null;
  data=await api('staff_overview',range?{from:range[0],to:range.at(-1)}:{});
  if(!s.month){s.month=manilaInput(data.server_now).slice(0,7);range=calendarDays(s.month);data=await api('staff_overview',{from:range[0],to:range.at(-1)});}
  s.selected=new Set([...s.selected].filter(id=>data.staff.some(p=>p.user_id===id)));
  if(s.tab==='activity')await loadActivity();render();
 }
 async function saved(action,payload,after){
  const result=await api(action,payload);after?.(result);
  try{await load();}catch(error){s.error=`Change saved, but current status could not be refreshed. Use Refresh status before making another change. ${error.message}`;render();}
  return result;
 }
 async function bulk(action){
  const users=[...s.selected].sort(),dates=[...s.dates].sort(),count=users.length*dates.length;if(!count)return;
  if(count>=6&&!await confirm(`${action==='block'?'Block recipe access':'Restore scheduled access'} for ${users.length} Staff across ${dates.length} dates?\n\n${summarizeDates(dates)}\n\n${count} Staff-Date ${action==='block'?'blocks':'changes'} will apply.`,{title:action==='block'?'Block Recipe Access?':'Restore Scheduled Access?',confirmLabel:action==='block'?'Confirm Block':'Confirm Restore',danger:action==='block'}))return;
  const fingerprint=JSON.stringify({users,dates,action});if(s.pendingCalendar?.fingerprint!==fingerprint)s.pendingCalendar={fingerprint,request_id:crypto.randomUUID()};
  await saved('staff_calendar',{users,dates,action,request_id:s.pendingCalendar.request_id},result=>{s.pendingCalendar=null;s.lastAction={id:result.batch_id,message:`Recipe access ${action==='block'?'blocked':'restored'} for ${users.length} Staff across ${dates.length} ${dates.length===1?'date':'dates'}.`};});
 }
 function editStaff(id){
  const p=data.staff.find(p=>p.user_id===id);if(!p)return;
  const choices=(kind)=>kind==='categories'?data.categories:data.recipes;
  const choiceRows=(kind)=>choices(kind).map(c=>`<label class="staff-scope-choice" data-scope-label="${esc(c.name.toLowerCase())}"><input type="checkbox" name="scope_id" value="${c.id}" ${p.scope_mode===kind&&p.scope_ids.includes(c.id)?'checked':''}>${esc(c.name)}</label>`).join('');
  dialog(`Recipe Access · ${p.name}`,`<form id="staff-person-form"><input type="hidden" name="user_id" value="${id}"><div class="recipe-fields two"><label>Name<input name="display_name" value="${esc(p.display_name)}" placeholder="${esc(p.email)}" maxlength="100"></label><label>Access mode<select name="mode">${Object.entries(modeLabels).map(([key,label])=>`<option value="${key}" ${p.mode===key?'selected':''}>${label}</option>`).join('')}</select></label><label>Recipe scope<select name="scope_mode"><option value="all" ${p.scope_mode==='all'?'selected':''}>All Approved Production Recipes</option><option value="categories" ${p.scope_mode==='categories'?'selected':''}>Selected Categories</option><option value="recipes" ${p.scope_mode==='recipes'?'selected':''}>Selected Recipes</option></select></label><div><label class="recipe-inline-check"><input type="checkbox" name="can_view_rd" ${p.can_view_rd?'checked':''}>Can view R&D</label><label class="recipe-inline-check"><input type="checkbox" name="show_brands" ${p.show_brands?'checked':''}>Show specified ingredient brands</label></div></div><div data-scope-picker ${p.scope_mode==='all'?'hidden':''}><label>Find a category or recipe<input type="search" data-scope-search placeholder="Search selection"></label><div class="staff-scope-options">${p.scope_mode==='all'?'':choiceRows(p.scope_mode)}</div></div><p class="recipe-muted">Scope applies to both Final and permitted R&D recipes. Required linked components are included within those recipes. Categories include their subcategories.</p><h3>Base Schedule</h3><label class="recipe-inline-check"><input type="checkbox" name="custom_hours" ${p.hours?'checked':''}>Use staff-specific hours</label><fieldset data-custom-hours ${p.hours?'':'disabled'}>${hoursFields(p.hours||data.hours,'person')}</fieldset><p class="recipe-muted">Asia/Manila · Scheduled hours are ${p.hours?'customized for this account':esc(hoursSummary(data.hours))}. Use the Access Calendar for date blocks.</p><p data-staff-form-error class="recipe-error" role="alert"></p><button type="submit" class="primary">Save Staff Access</button></form>`);
  const form=document.querySelector('#staff-person-form');
  form.elements.scope_mode.addEventListener('change',()=>{const kind=form.elements.scope_mode.value;form.querySelector('[data-scope-picker]').hidden=kind==='all';form.querySelector('.staff-scope-options').innerHTML=kind==='all'?'':choiceRows(kind);form.querySelector('[data-scope-search]').value='';});
  form.elements.custom_hours.addEventListener('change',()=>{form.querySelector('[data-custom-hours]').disabled=!form.elements.custom_hours.checked;});
  form.querySelector('[data-scope-search]').addEventListener('input',event=>{const q=event.target.value.toLowerCase();for(const node of form.querySelectorAll('[data-scope-label]'))node.hidden=!node.dataset.scopeLabel.includes(q);});
  form.addEventListener('submit',async event=>{
   event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
   try{const values=new FormData(form);await api('staff_save',{user_id:id,revision:p.revision,display_name:values.get('display_name'),mode:values.get('mode'),scope_mode:values.get('scope_mode'),scope_ids:values.getAll('scope_id'),hours:values.has('custom_hours')?readHours(form,'person'):null,can_view_rd:values.has('can_view_rd'),show_brands:values.has('show_brands')});closeDialog();await load();notify('Staff access updated.');}
   catch(error){if(form.isConnected)form.querySelector('[data-staff-form-error]').textContent=error.message;else {s.error='Staff access was saved, but the overview could not refresh. Refresh status to verify.';render();}}finally{submit.disabled=false;}
  });
 }
 async function click(event){
  const tab=event.target.closest('[data-staff-tab]'),date=event.target.closest('[data-staff-date]'),button=event.target.closest('[data-staff-action]');
  if(!tab&&!date&&!button||pending)return;
  try{
   s.error='';
   if(tab){s.tab=tab.dataset.staffTab;if(s.tab==='activity')await loadActivity();render();return;}
   if(date){const day=date.dataset.staffDate;s.dates.has(day)?s.dates.delete(day):s.dates.add(day);render();root.querySelector(`[data-staff-date="${day}"]`)?.focus({preventScroll:true});return;}
   const action=button.dataset.staffAction;
   if(action==='select-all'){s.selected=new Set(data.staff.filter(p=>p.active&&p.mode!=='blocked').map(p=>p.user_id));render();return;}
   if(action==='clear-staff'){s.selected.clear();render();return;}
   if(action==='clear-dates'){s.dates.clear();render();return;}
   if(action==='edit-staff'){editStaff(button.dataset.id);return;}
   if(action==='accounts'){disposed=true;await openAccounts();return;}
   if(action==='staff-activity'){s.activityUser=button.dataset.id;s.tab='activity';await loadActivity();render();return;}
   pending=true;button.disabled=true;
   if(action==='previous-month'||action==='next-month'){const d=utcDay(`${s.month}-01`);d.setUTCMonth(d.getUTCMonth()+(action==='next-month'?1:-1));s.month=isoDay(d).slice(0,7);await load();}
   else if(action==='today'){s.month=manilaInput(data.server_now).slice(0,7);await load();}
   else if(action==='refresh')await load();
   else if(action==='block'||action==='restore')await bulk(action);
   else if(action==='undo'){const id=s.lastAction?.id;if(id)await saved('staff_undo',{batch_id:id},()=>{s.lastAction=null;notify('Calendar change undone.');});}
   else if(action==='block-account'||action==='restore-account'){
    const person=data.staff.find(p=>p.user_id===button.dataset.id),blocked=action==='block-account';
    if(await confirm(blocked?`Block all Kitchen Recipe access for ${person.name}? This overrides temporary access until you restore the account.`:`Restore ${person.name} to Scheduled access? Their calendar, normal hours and recipe scope will apply.`,{confirmLabel:blocked?'Block account':'Restore Scheduled Access',danger:blocked}))await saved('staff_set_mode',{users:[person.user_id],mode:blocked?'blocked':'scheduled'});
   }else if(action==='end-override')await saved('staff_revoke_override',{ids:[button.dataset.id]});
   else if(action==='more-activity'){await loadActivity({append:true});render();}
  }catch(error){s.error=error.message;render();}finally{const wasPending=pending;pending=false;if(button)button.disabled=false;if(wasPending&&!disposed&&root.querySelector('[data-staff-access]'))render();}
 }
 async function change(event){
  const input=event.target;
  if(input.hasAttribute('data-staff-person')){input.checked?s.selected.add(input.dataset.staffPerson):s.selected.delete(input.dataset.staffPerson);render();}
  else if(input.hasAttribute('data-staff-filter')){s.staffFilter=input.value;render();}
  else if(input.hasAttribute('data-staff-activity-filter')){s.activityUser=input.value;try{await loadActivity();render();}catch(error){s.error=error.message;render();}}
 }
 async function submit(event){
  const form=event.target;if(!['staff-date-range','staff-default-hours','staff-override-form'].includes(form.id))return;event.preventDefault();if(pending)return;
  const button=form.querySelector('[type=submit]');pending=true;button.disabled=true;s.error='';
  try{
   if(form.id==='staff-date-range'){
    const values=new FormData(form),from=String(values.get('from')),to=String(values.get('to'));if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||to<from)throw Error('Choose a start date followed by an end date.');
    const count=Math.round((utcDay(to)-utcDay(from))/86400000)+1;if(count>366)throw Error('Select a range of up to 366 dates.');
    s.rangeFrom=from;s.rangeTo=to;for(let i=0;i<count;i++)s.dates.add(addCalendarDays(from,i));render();
   }else if(form.id==='staff-default-hours'){
    const hours=readHours(form);if(await confirm('Update the normal access hours for all Scheduled staff who use the default schedule?',{confirmLabel:'Save Default Hours'}))await saved('staff_save_defaults',{revision:data.revision,hours});
   }else{
    if(!s.selected.size)throw Error('Select staff first.');const values=Object.fromEntries(new FormData(form));
    if(s.selected.size>=3&&!await confirm(`Apply ${values.kind==='allow'?'Temporary Allow Anytime':'Temporary Block'} to ${s.selected.size} Staff?\n\n${selectedNames()}\n\n${values.starts_local.replace('T',' ')} to ${values.ends_local.replace('T',' ')} · Asia/Manila`,{confirmLabel:'Apply Override',danger:values.kind==='block'}))return;
    await saved('staff_override',{users:[...s.selected],...values},()=>{s.overrideDraft=null;});notify('Temporary override saved. It will expire automatically.');
   }
  }catch(error){s.error=error.message;render();}finally{pending=false;button.disabled=false;if(!disposed&&root.querySelector('[data-staff-access]'))render();}
 }
 await load();return {dispose(){disposed=true;},refresh:load,state:s};
}
