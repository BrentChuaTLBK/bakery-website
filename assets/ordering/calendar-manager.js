import {accountingDatePicker,bindAccountingDates,setAccountingDate} from './accounting-date-picker.js?v=branded-calendars-1';
import {calendarMonth,shiftedMonth,todayInManila,calendarArea,calendarName,calendarPhone,calendarAddress,filteredCalendarOrders,calendarCopy,calendarSocial,calendarAmount,calendarItemLines} from './order-calendar.js?v=summary-1';

const errors={access:'Google Calendar access needs attention. Check that the service account can make changes to events.',api_disabled:'Enable Google Calendar API to resume syncing.',configuration:'Finish the Google Calendar connection.',network:'Google Calendar is temporarily unavailable. Changes are saved and will retry automatically.',quota:'Google is limiting requests. Saved changes will retry automatically.',conflict:'A Google event could not be matched safely. Please contact the shop owner.'};
const dateLabel=value=>new Intl.DateTimeFormat('en-PH',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(value+'T12:00:00Z'));
const timeLabel=value=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit',month:'short',day:'numeric'}).format(new Date(value));
export function mountCalendar(root,{api,calendarConnection,role,connected,openOrder,toast,esc,filters={}}){
 if(!connected){root.innerHTML='<p class="notice">Sign in with your TLB staff account to use the order calendar.</p>';return {refresh(){},destroy(){}};}
 const today=todayInManila(),params=new URLSearchParams(location.hash.split('?')[1]||''),initialDate=params.get('date');
 if(!filters.month){Object.assign(filters,{month:today.slice(0,7),selected:today,view:'calendar',method:'',area:'',search:''});if(/^\d{4}-\d{2}-\d{2}$/.test(initialDate||'')){try{calendarMonth(initialDate.slice(0,7));filters.month=initialDate.slice(0,7);filters.selected=initialDate;}catch{}}}
 let orders=[],connection=null,info=null,stopped=false,timer=null,requestId=0,busy=false,loaded=false,initialOrder=params.get('order');
 const owner=role==='owner',q=selector=>root.querySelector(selector);
 root.innerHTML=`<div class="view-heading"><div><p class="eyebrow">TLB FULFILLMENT</p><h1>Order calendar</h1><p class="muted">Paid orders, including completed orders. Pickups in green; deliveries in blue, grouped by area. Completed orders stay visible in gray.</p></div><div class="row-actions"><button class="button button-secondary" data-calendar-action="refresh">Refresh</button><button class="button button-secondary" data-calendar-action="sync">Sync now</button></div></div>
 <section class="panel order-calendar-status"><div data-calendar-status role="status">Loading calendar…</div>${owner?'<details class="calendar-connection"><summary>Google Calendar connection</summary><div data-calendar-connection>Loading connection details…</div></details>':''}</section>
 <section class="panel calendar-controls"><div class="calendar-month-nav"><button class="button button-secondary" data-calendar-action="previous" aria-label="Previous month">←</button><h2 data-calendar-month></h2><button class="button button-secondary" data-calendar-action="next" aria-label="Next month">→</button><button class="button button-secondary" data-calendar-action="today">Today</button></div>
 <div class="calendar-filter-row"><label class="field">Find an order<input type="search" data-calendar-filter="search" placeholder="Name, phone, area or order number" value="${esc(filters.search)}"></label><label class="field">Fulfillment<select data-calendar-filter="method"><option value="">Pickup & delivery</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select></label><label class="field">Delivery area<select data-calendar-filter="area"><option value="">All areas</option></select></label>${accountingDatePicker('calendar_date','Jump to date',filters.selected,today,{attrs:'data-calendar-date required'})}</div>
 <div class="calendar-view-row"><div class="calendar-view-switch" role="group" aria-label="Calendar view"><button class="button button-secondary" data-calendar-action="calendar">Calendar</button><button class="button button-secondary" data-calendar-action="agenda">Month agenda</button></div><div class="calendar-legend"><span class="calendar-kind pickup">Pickup</span><span class="calendar-kind delivery">Delivery</span><span class="calendar-kind completed">✓ Completed</span><span data-calendar-total></span></div></div></section>
 <div data-calendar-error role="alert"></div><div class="order-calendar-layout"><section class="panel calendar-month-panel" aria-label="Month calendar"><div class="calendar-weekdays" aria-hidden="true">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-days" data-calendar-days></div></section><section class="calendar-agenda" data-calendar-agenda aria-label="Scheduled orders"></section></div>`;
 bindAccountingDates(root);
 q('[data-calendar-filter="method"]').value=filters.method;
 const copyButton=(o,field,label)=>`<button class="calendar-copy" type="button" data-calendar-copy="${field}" data-calendar-id="${esc(o.id)}">${label}</button>`;
 function card(o){
  const delivery=o.method==='delivery',completed=o.status==='completed',status=completed?'✓ Completed':o.status.replaceAll('_',' ');
  const customer=o.buyer?.name||calendarName(o),phone=o.buyer?.phone||calendarPhone(o),social=calendarSocial(o);
  const row=(label,value,field)=>'<div><dt>'+esc(label)+'</dt><dd><span>'+esc(value||'Not provided')+'</span>'+(value&&field?copyButton(o,field,'Copy '+(field==='social'?'social':field==='address'?'address':field==='name'?'name':'phone')):'')+'</dd></div>';
  return '<article class="panel calendar-order '+(delivery?'delivery':'pickup')+(completed?' is-completed':'')+'" data-calendar-order="'+esc(o.id)+'">'+
   '<div class="calendar-order-heading"><div><span class="calendar-kind '+o.method+'">'+(delivery?'Delivery':'Pickup')+'</span><button class="calendar-order-link" data-calendar-open="'+esc(o.id)+'">'+esc(o.reference)+'</button></div><span class="badge'+(completed?' calendar-completed-badge':'')+'">'+esc(status)+'</span></div>'+
   '<div class="calendar-person"><h4>'+esc(customer)+'</h4>'+copyButton(o,'customer_name','Copy name')+'</div>'+
   '<dl class="calendar-details">'+row('Phone number',phone,'buyer_phone')+row('Social media',social,social==='Not provided'?null:'social')+
   (delivery?(calendarName(o)!==customer?row('Recipient',calendarName(o),'name'):'')+(calendarPhone(o)&&calendarPhone(o)!==phone?row('Recipient phone',calendarPhone(o),'phone'):'')+row('Delivery address',calendarAddress(o),'address'):'')+'</dl>'+
   '<p class="calendar-items"><strong>Order details</strong><br>'+calendarItemLines(o).map(esc).join('<br>')+'</p><p class="calendar-amount"><span>Amount</span><strong>'+esc(calendarAmount(o))+'</strong></p>'+
   (delivery&&o.instructions?'<p class="calendar-instructions"><strong>Delivery instructions:</strong> '+esc(o.instructions)+'</p>':'')+
   '<div class="calendar-order-footer"><button class="button button-secondary" data-calendar-copy="all" data-calendar-id="'+esc(o.id)+'">Copy '+(delivery?'delivery':'pickup')+' details</button><small>'+(!connection?.connected?'Dashboard calendar':o.sync_state==='synced'?'Synced to Google':o.sync_state==='retrying'?'Google update retrying':'Google update pending')+'</small></div></article>';
 }
 function status(){if(!connection)return;let text=!connection.connected?'Google Calendar is not connected yet. The TLB schedule is available below.':connection.last_error?(errors[connection.last_error]||errors.network):connection.pending?`${connection.pending} Google Calendar ${connection.pending===1?'update':'updates'} pending. Updates run automatically.`:connection.last_success_at?`Google Calendar synced · ${timeLabel(connection.last_success_at)} PHT`:'Google Calendar connected. Initial sync is pending.';
  q('[data-calendar-status]').innerHTML=`<div><strong>${connection.last_error?'Google Calendar needs attention':connection.connected?'Google Calendar connected':'TLB calendar'}</strong><p>${esc(text)}</p><small>Update schedules in TLB. Sync normally runs within a minute, including when this dashboard is closed.</small></div>${connection.calendar_id?`<a class="button button-secondary" href="https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(connection.calendar_id)}" target="_blank" rel="noopener noreferrer">Open Google Calendar ↗</a>`:''}`;
 }
 function draw(){
  const focus=document.activeElement?.getAttribute('data-calendar-day'),range=calendarMonth(filters.month);
  const validAreas=orders.filter(o=>o.method==='delivery').map(calendarArea);if(loaded&&!validAreas.includes(filters.area))filters.area='';
  const filtered=filteredCalendarOrders(orders,filters);
  q('[data-calendar-month]').textContent=range.label;q('[data-calendar-total]').textContent=`${filtered.length} ${filtered.length===1?'order':'orders'}`;
  setAccountingDate(root,'calendar_date',filters.selected);
  for(const view of ['calendar','agenda'])q(`[data-calendar-action="${view}"]`).setAttribute('aria-pressed',String(filters.view===view));
  q('.calendar-month-panel').hidden=filters.view==='agenda';q('.order-calendar-layout').classList.toggle('agenda-only',filters.view==='agenda');
  const areas=[...new Set(orders.filter(o=>o.method==='delivery').map(calendarArea))].sort((a,b)=>a.localeCompare(b));
  const options='<option value="">All areas</option>'+areas.map(area=>`<option value="${esc(area)}">${esc(area)}</option>`).join('');
  if(q('[data-calendar-filter="area"]').innerHTML!==options)q('[data-calendar-filter="area"]').innerHTML=options;
  if(loaded&&!areas.includes(filters.area))filters.area='';q('[data-calendar-filter="area"]').value=filters.area;
  q('[data-calendar-filter="area"]').disabled=filters.method==='pickup';
  let days=Array.from({length:range.offset},()=>'<span class="calendar-blank" aria-hidden="true"></span>').join('');
  for(let n=1;n<=range.days;n++){const date=`${filters.month}-${String(n).padStart(2,'0')}`,rows=filtered.filter(o=>o.date===date),pending=rows.filter(o=>o.status!=='completed'),pickups=pending.filter(o=>o.method==='pickup').length,deliveries=pending.length-pickups,completed=rows.length-pending.length;
   days+=`<button class="order-calendar-day ${date===filters.selected?'selected':''} ${date===today?'today':''}" data-calendar-day="${date}" aria-pressed="${date===filters.selected}" aria-label="${esc(dateLabel(date))}; ${pickups} pending pickups; ${deliveries} pending deliveries; ${completed} completed orders"><span class="calendar-day-number">${n}</span><span class="calendar-day-counts">${pickups?`<span class="pickup"><span aria-hidden="true">P</span> ${pickups}</span>`:''}${deliveries?`<span class="delivery"><span aria-hidden="true">D</span> ${deliveries}</span>`:''}${completed?`<span class="completed" title="${completed} completed orders"><span aria-hidden="true">✓</span> ${completed}</span>`:''}</span></button>`;
  }q('[data-calendar-days]').innerHTML=days;
  const visible=filters.view==='agenda'?filtered:filtered.filter(o=>o.date===filters.selected);
  let markup=`<div class="calendar-agenda-heading"><h2>${esc(filters.view==='agenda'?range.label:dateLabel(filters.selected))}</h2><span class="badge">${visible.length} ${visible.length===1?'order':'orders'}</span></div>`;
  if(!visible.length)markup+=`<div class="panel empty-state"><h3>${loaded?'No matching orders':'Loading orders…'}</h3><p>${loaded?'Paid, confirmed pickup and delivery orders appear here.':''}</p></div>`;
  for(const date of [...new Set(visible.map(o=>o.date))]){
   if(filters.view==='agenda')markup+=`<h3 class="calendar-agenda-date">${esc(dateLabel(date))}</h3>`;
   const rows=visible.filter(o=>o.date===date),deliveries=rows.filter(o=>o.method==='delivery'),pickups=rows.filter(o=>o.method==='pickup');
   if(pickups.length)markup+=`<h3 class="calendar-group-heading pickup">Pickups · ${pickups.length}</h3>${pickups.map(card).join('')}`;
   for(const area of [...new Set(deliveries.map(calendarArea))]){const group=deliveries.filter(o=>calendarArea(o)===area);markup+=`<h3 class="calendar-group-heading delivery">${esc(area)} · ${group.length} ${group.length===1?'delivery':'deliveries'}</h3>${group.map(card).join('')}`;}
  }
  q('[data-calendar-agenda]').innerHTML=markup;status();
  if(focus)q(`[data-calendar-day="${focus}"]`)?.focus({preventScroll:true});
 }
 function setupConnection(){if(!owner||!info)return;const id=connection?.calendar_id||'';
  q('[data-calendar-connection]').innerHTML=`<p>Use a private calendar for TLB. Share it with the service account below using <strong>Make changes to events</strong>, then connect its Calendar ID.</p>${info.service_account_email?`<p class="calendar-service-account"><code>${esc(info.service_account_email)}</code><button class="calendar-copy" data-calendar-action="copy-service">Copy service account</button></p>`:'<p class="notice">A Google service account must first be saved in the backend.</p>'}<form data-calendar-connect><label class="field">Calendar ID or embed link<input name="calendar_id" required maxlength="2048" value="${esc(id)}" placeholder="From Google Calendar settings → Integrate calendar" ${id?'readonly':''}></label><button class="button" type="submit" ${!info.configured?'disabled':''}>${id?'Check connection':'Connect calendar'}</button><p data-calendar-connect-result role="status"></p></form><p class="help-text">Orders appear as all-day entries on their fulfillment date. Customer invitations are not sent.</p>`;
 }
 function schedule(){clearTimeout(timer);if(!stopped&&!document.hidden)timer=setTimeout(refresh,15000);}
 async function refresh(){const current=++requestId;clearTimeout(timer);try{
  const range=calendarMonth(filters.month),result=await api('calendar_list',{from:range.from,to:range.to});if(stopped||current!==requestId)return;
  if(!Array.isArray(result?.orders))throw Error('Calendar data could not be loaded.');
  orders=result.orders;connection=result.connection;loaded=true;q('[data-calendar-error]').textContent='';draw();
  if(initialOrder){const id=initialOrder;initialOrder=null;if(/^[a-f0-9-]{36}$/i.test(id))await openOrder(id);}
 }catch(error){if(!stopped&&current===requestId)q('[data-calendar-error]').innerHTML=`<p class="notice danger">${esc(error.message||'Could not refresh the calendar.')} ${loaded?'The last loaded schedule is shown.':''}</p>`;}finally{if(!stopped&&current===requestId)schedule();}}
 async function copy(value){if(!value)return;try{await navigator.clipboard.writeText(value);toast('Copied.');}catch{const area=document.createElement('textarea');area.value=value;area.style.cssText='position:fixed;left:-9999px';document.body.append(area);area.select();const done=document.execCommand('copy');area.remove();toast(done?'Copied.':'Copy was blocked. Select the details and copy them manually.',done?undefined:'error');}}
 async function click(event){const element=event.target.closest('button');if(!element||!root.contains(element))return;
  if(element.dataset.calendarCopy){const order=orders.find(o=>o.id===element.dataset.calendarId);if(order)await copy(calendarCopy(order,element.dataset.calendarCopy));return;}
  if(element.dataset.calendarOpen){openOrder(element.dataset.calendarOpen);return;}
  if(element.dataset.calendarDay){filters.selected=element.dataset.calendarDay;draw();return;}
  const action=element.dataset.calendarAction;if(!action)return;
  if(action==='copy-service'){await copy(info.service_account_email);return;}
  if(action==='refresh'){await refresh();return;}
  if(action==='sync'){if(busy)return;busy=true;element.disabled=true;try{connection=await api('calendar_sync_now');if(stopped)return;status();toast(connection.connected?'Calendar sync requested.':'Connect Google Calendar first.');}catch(error){toast(error.message,'error');}finally{busy=false;element.disabled=false;}return;}
  if(['calendar','agenda'].includes(action)){filters.view=action;draw();return;}
  if(action==='today'){filters.month=today.slice(0,7);filters.selected=today;}else if(action==='previous'||action==='next'){filters.month=shiftedMonth(filters.month,action==='next'?1:-1);filters.selected=filters.month+'-01';}else return;
  orders=[];loaded=false;draw();await refresh();
 }
 function input(event){const field=event.target.dataset.calendarFilter;if(field){filters[field]=event.target.value;if(field==='method'&&filters.method==='pickup')filters.area='';draw();}}
 async function change(event){if(event.target.matches('[data-calendar-date]')&&/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){filters.selected=event.target.value;const month=filters.selected.slice(0,7);if(month!==filters.month){filters.month=month;orders=[];loaded=false;draw();await refresh();}else draw();}}
 async function submit(event){if(!event.target.matches('[data-calendar-connect]'))return;event.preventDefault();if(busy)return;busy=true;const form=event.target,button=form.querySelector('button'),result=form.querySelector('[data-calendar-connect-result]');button.disabled=true;result.textContent='Checking Google Calendar access…';try{const response=await calendarConnection('connect',{calendar_id:new FormData(form).get('calendar_id')});if(stopped)return;connection=response.connection;setupConnection();status();await refresh();toast('Google Calendar connected.');}catch(error){result.textContent=error.message;}finally{busy=false;button.disabled=false;}}
 function visibility(){clearTimeout(timer);if(!document.hidden)refresh();}
 root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',change);root.addEventListener('submit',submit);document.addEventListener('visibilitychange',visibility);
 draw();refresh();if(owner)calendarConnection('connection_info').then(value=>{if(stopped)return;info=value;connection=value.connection||connection;setupConnection();status();}).catch(error=>{if(!stopped)q('[data-calendar-connection]').textContent=error.message;});
 return {refresh,destroy(){stopped=true;requestId++;clearTimeout(timer);root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',change);root.removeEventListener('submit',submit);document.removeEventListener('visibilitychange',visibility);}};
}
