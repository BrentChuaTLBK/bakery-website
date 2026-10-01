import {api,configured,escapeHtml as esc} from './client.js?v=approved-20261002-1';

const date=value=>value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
let current=null,pending=false,timer,countdownTimer,signature='',screenSignature='';
let serverTime=NaN,receivedAt=0,checkedEnd=null,refreshFailed=false;
const now=()=>Number.isFinite(serverTime)?serverTime+performance.now()-receivedAt:Date.now();
const reopening=()=>current?.active?Date.parse(current.ends_at):NaN;
const cake=`<svg class="maintenance-cake" viewBox="0 0 128 92" fill="none" aria-hidden="true"><ellipse cx="64" cy="77" rx="48" ry="9" fill="#eee2d0"/><path d="M22 70c8 13 76 13 84 0" stroke="#b69160" stroke-width="1.5" stroke-linecap="round"/><path d="m33 41 47-10 17 15v23c-18 8-44 10-64 1Z" fill="#f0d7a9" stroke="#9e7547" stroke-width="1.5" stroke-linejoin="round"/><path d="m33 41 17 15 47-10-17-15Z" fill="#875333" stroke="#70412a" stroke-width="1.5" stroke-linejoin="round"/><path d="m50 56 1 20M41 62l3 1m18 0 3-1m13-3 3-1m4 8 3-1" stroke="#c59e69" stroke-width="1.5" stroke-linecap="round"/><path d="m44 40 9 5m10-7 8 5m8-6 7 5" stroke="#bb8650" stroke-width="3" stroke-linecap="round"/><path d="M52 26c-7-7 7-9 0-16m15 14c-7-7 7-9 0-16" stroke="#ba9464" stroke-width="1.5" stroke-linecap="round"/><path d="M102 22v10m-5-5h10M21 40v6m-3-3h6" stroke="#b58b53" stroke-width="1.5" stroke-linecap="round"/></svg>`;

function updateCountdown(){
 const countdown=document.querySelector('[data-maint-countdown]');
 if(!countdown||document.querySelector('#site-maintenance-screen').hidden)return;
 const end=reopening();if(!Number.isFinite(end))return;
 const total=Math.max(0,Math.ceil((end-now())/1000));
 const parts={days:Math.floor(total/86400),hours:Math.floor(total/3600)%24,minutes:Math.floor(total/60)%60,seconds:total%60};
 for(const [unit,value] of Object.entries(parts)){
  const digit=countdown.querySelector(`[data-maint-${unit}]`),text=String(value).padStart(2,'0');
  if(digit.textContent!==text)digit.textContent=text;
 }
 countdown.querySelector('[data-maint-day-cell]').hidden=parts.days===0;
 countdown.classList.toggle('has-days',parts.days>0);
 const status=document.querySelector('[data-maint-reopening-status]');
 const message=total>0?'This page will reopen automatically.':refreshFailed?'We’re checking the connection. Please bear with us.':'Checking that the shop is ready…';
 if(status.textContent!==message)status.textContent=message;
 if(total===0&&checkedEnd!==end&&!pending){checkedEnd=end;refresh();}
}

function updateManualStatus(){
 const status=document.querySelector('[data-maint-manual-status]');
 if(!status)return;
 const message=refreshFailed?'We couldn’t check just now. We’ll try again shortly.':'This page will reopen automatically when we’re ready.';
 if(status.textContent!==message)status.textContent=message;
}

function render(){
 if(!current)return;
 let banner=document.querySelector('#site-maintenance-banner');
 if(!banner){banner=document.createElement('aside');banner.id='site-maintenance-banner';banner.setAttribute('aria-label','Website maintenance');document.body.prepend(banner);}
 banner.hidden=!current.active&&!current.announce;
 const time=current.starts_at?`${date(current.starts_at)}${current.ends_at?' – '+date(current.ends_at):''} · Manila time`:'';
 banner.innerHTML=`<strong>${current.active?'Website maintenance':'Planned maintenance'}</strong><span>${esc(current.message)}</span>${time?`<span>${esc(time)}</span>`:''}${current.active&&current.uploads_paused?'<span>Payment-proof uploads and deadlines are paused.</span>':''}`;
 const file=location.pathname.split('/').pop().replace(/\.html$/,'')||'index';
 const existingOrder=file==='shop'&&new URLSearchParams(location.hash.slice(1)).has('order');
 const block=Boolean(current.active&&['index','index_test','aboutus','pastries','customorders','dessertbar','partycarts','academy','academy-class','blogs','blogpost','testimonials','shop',''].includes(file)&&!existingOrder);
 let screen=document.querySelector('#site-maintenance-screen');
 if(!screen){screen=document.createElement('section');screen.id='site-maintenance-screen';screen.setAttribute('aria-label','Website maintenance');document.body.append(screen);}
 screen.hidden=!block;document.body.classList.toggle('site-under-maintenance',block);
 clearInterval(countdownTimer);
 if(block){
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  const nextScreen=JSON.stringify([current.message,current.ends_at,current.uploads_paused]);
  // Keep focused links and controls intact during periodic status checks.
  if(nextScreen!==screenSignature){
   screenSignature=nextScreen;
   const scheduled=Number.isFinite(reopening());
   screen.innerHTML=`<header class="maintenance-brand"><span class="maintenance-wordmark">TLB Kitchen</span><span class="maintenance-brand-description">BAKED WITH A LITTLE LOVE</span></header><div class="maintenance-wrap"><main class="maintenance-content" aria-labelledby="maintenance-title"><p class="maintenance-eyebrow"><span aria-hidden="true"></span>A LITTLE PAUSE</p>${cake}<h1 id="maintenance-title">A little care<br>behind the scenes.</h1><p class="maintenance-message">${esc(current.message)}</p>${scheduled?`<div class="maintenance-reopening"><p class="maintenance-countdown-label">BACK TO SOMETHING SWEET IN</p><div class="maintenance-countdown" data-maint-countdown role="timer" aria-live="off" aria-label="Time until scheduled reopening">${['days','hours','minutes','seconds'].map(unit=>`<div class="maintenance-time-cell" ${unit==='days'?'data-maint-day-cell hidden':''}><span data-maint-${unit}>00</span><small>${unit}</small></div>`).join('')}</div><p class="maintenance-schedule">Scheduled to reopen<br><time datetime="${esc(current.ends_at)}">${esc(date(current.ends_at))}</time><span> · Manila time</span></p><p class="maintenance-auto" data-maint-reopening-status role="status"></p></div>`:'<div class="maintenance-manual"><span class="maintenance-pause-mark" aria-hidden="true"><span></span><span></span></span><p class="maintenance-countdown-label">A MOMENT OF CARE</p><h2>We’ll be back soon.</h2><p class="maintenance-manual-message">We’ll be back as soon as our updates are complete.</p><p class="maintenance-auto" data-maint-manual-status role="status"></p></div>'}<div class="maintenance-order-note"><p>Your existing orders are still here.</p>${current.uploads_paused?'<p>Payment-proof uploads are paused.<br>Your remaining upload time is protected.</p>':''}</div><div class="maintenance-actions"><a class="maintenance-account" href="account.html">Your account & orders <span aria-hidden="true">↗</span></a><a class="maintenance-contact" href="contactus.html">Contact our kitchen</a></div><button type="button" data-maint-check>Check again <span aria-hidden="true">↻</span></button></main><p class="maintenance-signoff">Baked with a little love.</p></div>`;
   screen.querySelector('[data-maint-check]').onclick=refresh;
  }
  updateCountdown();updateManualStatus();
  if(Number.isFinite(reopening()))countdownTimer=setInterval(updateCountdown,1000);
 }
 const next=JSON.stringify([current.active,current.uploads_paused]);
 if(next!==signature){signature=next;window.dispatchEvent(new CustomEvent('tlb-maintenance-change',{detail:current}));}
}

function scheduleRefresh(){
 clearTimeout(timer);
 const time=now();
 const boundary=[current?.starts_at,current?.ends_at].map(Date.parse).filter(t=>Number.isFinite(t)&&t>time).sort((a,b)=>a-b)[0];
 const expired=current?.active&&Number.isFinite(reopening())&&reopening()<=time;
 timer=setTimeout(refresh,Math.max(1000,Math.min(expired?5000:30000,Number.isFinite(boundary)?boundary-time+150:30000)));
}

async function refresh(){
 if(!configured||pending)return;pending=true;
 const button=document.querySelector('[data-maint-check]');if(button)button.disabled=true;
 try{
  current=await api('site_status');serverTime=Date.parse(current.server_time);receivedAt=performance.now();refreshFailed=false;
  render();
 }catch{refreshFailed=true;updateCountdown();updateManualStatus();}
 finally{pending=false;const check=document.querySelector('[data-maint-check]');if(check)check.disabled=false;scheduleRefresh();}
}
window.addEventListener('hashchange',render);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
refresh();
