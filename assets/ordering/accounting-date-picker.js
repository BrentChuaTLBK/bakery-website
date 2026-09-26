import {calendarMonthDays, calendarKeyDate, isCalendarDate, shiftCalendarMonth} from './date-calendar.js?v=daily-quantities-1';

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const valid=(value,mode)=>isCalendarDate(mode==='month'?value+'-01':value);
const label=(value,mode)=>mode==='month'?`${MONTHS[Number(value.slice(5,7))-1]} ${value.slice(0,4)}`:`${MONTHS[Number(value.slice(5,7))-1]} ${Number(value.slice(8))}, ${value.slice(0,4)}`;
const withinBounds=(value,picker)=>!value||( (!picker.dataset.minDate||value>=picker.dataset.minDate.slice(0,value.length))&&(!picker.dataset.maxDate||value<=picker.dataset.maxDate.slice(0,value.length)) );
let sequence=0;

function calendarView(picker, focusDate='') {
 const {month,today,mode}=picker.dataset,selected=picker.querySelector('input[type=hidden]').value;
 const year=month.slice(0,4),title=mode==='month'?year:label(month,'month');
 const toolbar=`<div class="calendar-toolbar"><button type="button" class="calendar-nav" data-date-move="-1" aria-label="Previous ${mode==='month'?'year':'month'}">‹</button><strong aria-live="polite">${title}</strong><button type="button" class="calendar-nav" data-date-move="1" aria-label="Next ${mode==='month'?'year':'month'}">›</button></div>`;
 const jump=`<div class="accounting-calendar-jump">${mode==='date'?`<label>Month<select data-date-month>${MONTHS.map((name,i)=>`<option value="${pad(i+1)}" ${month.slice(5)===pad(i+1)?'selected':''}>${name}</option>`).join('')}</select></label>`:''}<label>Year<input type="text" data-date-year value="${year}" maxlength="4" inputmode="numeric" aria-label="Calendar year"></label></div><p class="accounting-calendar-error" data-date-navigation-error role="alert" hidden></p>`;
 let grid;
 if(mode==='month') grid=`<div class="accounting-month-grid">${MONTHS.map((name,i)=>{const value=year+'-'+pad(i+1);return `<button type="button" class="calendar-day" data-date-value="${value}" aria-label="${name} ${year}" aria-pressed="${selected===value}" ${today.startsWith(value)?'aria-current="date"':''} ${withinBounds(value,picker)?'':'disabled'}>${name.slice(0,3)}</button>`;}).join('')}</div>`;
 else {
  const cells=calendarMonthDays(month),tab=focusDate.startsWith(month)?focusDate:selected.startsWith(month)?selected:today.startsWith(month)?today:month+'-01';
  const rows=[];
  for(let i=0;i<cells.length;i+=7)rows.push(`<tr>${cells.slice(i,i+7).map(date=>date?`<td><button type="button" class="calendar-day" data-date-value="${date}" aria-label="${esc(label(date,'date'))}" aria-pressed="${selected===date}" ${today===date?'aria-current="date"':''} tabindex="${date===tab?'0':'-1'}" ${withinBounds(date,picker)?'':'disabled'}>${Number(date.slice(8))}</button></td>`:'<td></td>').join('')}</tr>`);
  grid=`<table class="calendar-month" aria-label="${title}"><thead><tr>${DAYS.map(d=>`<th scope="col">${d}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
 }
 return toolbar+jump+grid+`<div class="calendar-footer"><button type="button" class="calendar-today" data-date-today>Current ${mode==='month'?'year':'month'}</button>${picker.dataset.optional==='true'?'<button type="button" class="calendar-today" data-date-clear>Clear date</button>':''}<button type="button" class="calendar-today" data-date-close>Close calendar</button></div>`;
}

export function accountingDatePicker(name,title,value,today,{mode='date',optional=false,attrs='',minDate='',maxDate=''}={}) {
 minDate||=attrs.match(/\bmin=["']([^"']*)["']/)?.[1]||'';maxDate||=attrs.match(/\bmax=["']([^"']*)["']/)?.[1]||'';
 if((value!==''&&!valid(value,mode))||!isCalendarDate(today)||(minDate&&!isCalendarDate(minDate))||(maxDate&&!isCalendarDate(maxDate)))throw Error('Choose a valid calendar date.');
 const id='accounting-date-'+(++sequence);
 return `<div class="field accounting-date-field"><span id="${id}-label">${esc(title)}</span><details class="accounting-date-picker" data-mode="${mode}" data-today="${today}" data-month="${(value||today).slice(0,7)}" data-optional="${optional}" data-min-date="${esc(minDate)}" data-max-date="${esc(maxDate)}"><summary aria-labelledby="${id}-label ${id}-value" aria-describedby="${id}-error"><span id="${id}-value" data-date-label>${value?label(value,mode):'Choose a date'}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/></svg></summary><input type="hidden" name="${esc(name)}" value="${value}" ${attrs}><div class="date-calendar accounting-calendar" aria-labelledby="${id}-label"></div></details><p class="accounting-calendar-error" id="${id}-error" data-date-error role="alert" hidden></p></div>`;
}

export function accountingDateTimePicker(name,title,value,today,{optional=false,attrs=''}={}){
 if(value!==''&&!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('Choose a valid date and time.');
 const date=value.slice(0,10),hour=value?value.slice(11,13):'12',minute=value?value.slice(14,16):'00';
 return `<div class="accounting-datetime-field">${accountingDatePicker(name+'__date',title,date,today,{optional,attrs:'data-datetime-date'})}<div class="accounting-datetime-time"><label class="field">Hour<select data-datetime-hour aria-label="${esc(title)} hour">${Array.from({length:24},(_,i)=>`<option value="${pad(i)}" ${hour===pad(i)?'selected':''}>${i%12||12} ${i<12?'AM':'PM'}</option>`).join('')}</select></label><label class="field">Minute<select data-datetime-minute aria-label="${esc(title)} minute">${Array.from({length:60},(_,i)=>`<option value="${pad(i)}" ${minute===pad(i)?'selected':''}>${pad(i)}</option>`).join('')}</select></label></div><input type="hidden" data-datetime-value name="${esc(name)}" value="${esc(value)}" ${attrs}></div>`;
}

function updateDateTime(wrapper){
 const input=wrapper.querySelector('[data-datetime-value]'),date=wrapper.querySelector('[data-datetime-date]').value;
 input.value=date?`${date}T${wrapper.querySelector('[data-datetime-hour]').value}:${wrapper.querySelector('[data-datetime-minute]').value}`:'';
 input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
}

export function validateAccountingDates(root){
 let first;
 for(const picker of root.querySelectorAll('.accounting-date-picker')){
  const input=picker.querySelector('input[type=hidden]');if(input.disabled)continue;
  const okay=(input.value===''&&picker.dataset.optional==='true')||(valid(input.value,picker.dataset.mode)&&withinBounds(input.value,picker));
  const error=picker.parentElement.querySelector('[data-date-error]');error.hidden=okay;error.textContent=okay?'':'Choose a valid date for '+picker.parentElement.querySelector('span').textContent+'.';
  picker.querySelector('summary').setAttribute('aria-invalid',String(!okay));if(!okay)first||=picker;
 }
 if(first){first.querySelector('summary').focus({preventScroll:true});return false;}return true;
}

function positionCalendar(picker){
 if(!picker.open)return;
 const panel=picker.querySelector('.accounting-calendar'),left=picker.getBoundingClientRect().left,width=panel.getBoundingClientRect().width;
 panel.style.left=`${Math.max(16-left,Math.min(0,innerWidth-16-left-width))}px`;
}
function render(picker,focusDate,focusSelector) {
 picker.querySelector('.accounting-calendar').innerHTML=calendarView(picker,focusDate);
 positionCalendar(picker);
 if(focusDate)picker.querySelector(`[data-date-value="${focusDate}"]`)?.focus({preventScroll:true});
 else if(focusSelector)picker.querySelector(focusSelector)?.focus({preventScroll:true});
}

export function setAccountingDate(root,name,value,{notify=false}={}) {
 const input=[...root.querySelectorAll('.accounting-date-picker input[type=hidden]')].find(field=>field.name===name);
 if(!input)throw Error('Calendar field was not found.');
 const picker=input.closest('.accounting-date-picker');
 if(!(value===''&&picker.dataset.optional==='true')&&(!valid(value,picker.dataset.mode)||!withinBounds(value,picker)))throw Error('Choose a valid calendar date.');
 input.value=value;if(value)picker.dataset.month=value.slice(0,7);picker.querySelector('[data-date-label]').textContent=value?label(value,picker.dataset.mode):'Choose a date';
 picker.querySelector('summary').removeAttribute('aria-invalid');picker.parentElement.querySelector('[data-date-error]').hidden=true;
 render(picker);
 if(notify){input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
}

const bound=new WeakSet();let outsideBound=false;
export function bindAccountingDates(root) {
 if(bound.has(root))return;bound.add(root);
 root.addEventListener('submit',event=>{if(event.target.matches('form')&&!validateAccountingDates(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
 root.addEventListener('toggle',event=>{
  const picker=event.target;if(!picker.matches?.('.accounting-date-picker'))return;
  if(!picker.open){if(picker.querySelector('[data-date-year][aria-invalid="true"]'))render(picker);return;}
  root.querySelectorAll('.accounting-date-picker[open]').forEach(other=>{if(other!==picker)other.open=false;});
  // Reopening must not replace a year/month field while the user is editing it.
  if(!picker.querySelector('.accounting-calendar').childElementCount)render(picker);
  positionCalendar(picker);
 },true);
 root.addEventListener('click',event=>{
  const button=event.target.closest('button'),picker=button?.closest('.accounting-date-picker');
  if(!picker||!root.contains(picker)||button.disabled)return;
  event.preventDefault();event.stopPropagation();
  if(root.dataset.busy==='true'||picker.closest('form')?.dataset.busy==='true')return;
  if(button.dataset.dateValue){
   setAccountingDate(root,picker.querySelector('input[type=hidden]').name,button.dataset.dateValue,{notify:true});
   picker.open=false;picker.querySelector('summary').focus({preventScroll:true});
  }else if(button.hasAttribute('data-date-clear')){
   setAccountingDate(root,picker.querySelector('input[type=hidden]').name,'',{notify:true});picker.open=false;picker.querySelector('summary').focus({preventScroll:true});
  }else if(button.dataset.dateMove){
   const next=shiftCalendarMonth(picker.dataset.month,Number(button.dataset.dateMove)*(picker.dataset.mode==='month'?12:1));
   if(!isCalendarDate(next+'-01')||next.slice(0,4)==='0000')return;
   picker.dataset.month=next;render(picker,'',`[data-date-move="${button.dataset.dateMove}"]`);
  }else if(button.hasAttribute('data-date-today')){picker.dataset.month=picker.dataset.today.slice(0,7);render(picker,'','[data-date-today]');}
  else if(button.hasAttribute('data-date-close')){picker.open=false;picker.querySelector('summary').focus({preventScroll:true});}
 });
 root.addEventListener('change',event=>{
  if(event.target.matches('[data-datetime-date],[data-datetime-hour],[data-datetime-minute]')){updateDateTime(event.target.closest('.accounting-datetime-field'));event.stopPropagation();return;}
  const input=event.target,picker=input.closest('.accounting-date-picker');if(!picker)return;
  if(!input.matches('[data-date-year],[data-date-month]'))return;
  const year=picker.querySelector('[data-date-year]').value,month=picker.querySelector('[data-date-month]')?.value||picker.dataset.month.slice(5);
  const value=year.padStart(4,'0')+'-'+month;
  if(!/^[0-9]{1,4}$/.test(year)||Number(year)<1||!isCalendarDate(value+'-01')){const error=picker.querySelector('[data-date-navigation-error]');error.hidden=false;error.textContent='Enter a year from 1 to 9999.';picker.querySelector('[data-date-year]').setAttribute('aria-invalid','true');return;}
  picker.dataset.month=value;render(picker,'',input.hasAttribute('data-date-year')?'[data-date-year]':'[data-date-month]');
 });
 root.addEventListener('keydown',event=>{
  const picker=event.target.closest('.accounting-date-picker');if(!picker)return;
  if(event.key==='Escape'&&picker.open){event.preventDefault();event.stopPropagation();picker.open=false;picker.querySelector('summary').focus({preventScroll:true});return;}
  const button=event.target.closest('[data-date-value]');if(!button||picker.dataset.mode!=='date')return;
  const next=calendarKeyDate(button.dataset.dateValue,event.key,event.shiftKey);if(!next||!isCalendarDate(next)||next.startsWith('0000')||!withinBounds(next,picker))return;
  event.preventDefault();picker.dataset.month=next.slice(0,7);render(picker,next);
 });
 if(!outsideBound){outsideBound=true;document.addEventListener('click',event=>document.querySelectorAll('.accounting-date-picker[open]').forEach(picker=>{if(!picker.contains(event.target))picker.open=false;}));window.addEventListener('resize',()=>document.querySelectorAll('.accounting-date-picker[open]').forEach(positionCalendar));}
}
