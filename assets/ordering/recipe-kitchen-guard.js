// A server-issued lease limits how long sensitive DOM may remain visible.
// Durations use performance.now(): changing a device date/timezone cannot extend
// the lease. Every recipe/scaling/media request is independently authorized.
export function createKitchenGuard({call,getState,onLock,onResume,onPermissionChange,notify}){
 let policy=null,deadline=0,expiryTimer,pollTimer,pending=null,locked=false,stopped=false,sequence=0;
 const events=new Map();
 const isStaff=()=>getState().role==='kitchen';
 const context=()=>{
  const state=getState(),r=state.record;
  return r?{id:r.id,version_id:r.version_id,root_id:r.root_id,root_version:r.root_version,rd:state.rd}:{rd:state.rd};
 };
 const clearTimers=()=>{clearTimeout(expiryTimer);clearTimeout(pollTimer);};
 function schedule(delay=10000){clearTimeout(pollTimer);if(!stopped&&!document.hidden)pollTimer=setTimeout(()=>check(),delay);}
 function lock(reason='verification_required',details=policy){
  if(!isStaff()&&details?.role!=='kitchen')return;
  clearTimers();sequence++;locked=true;deadline=0;
  document.body.classList.add('recipe-staff-protected');onLock(reason,details);
  schedule(30000);
 }
 function accept(result,started=performance.now()){
  const next=result?.access;
  if(!next){if(isStaff())lock('verification_required');return !isStaff();}
  const staff=next.role==='kitchen'||result.role==='kitchen';
  document.body.classList.toggle('recipe-staff-protected',staff);
  policy=next;clearTimeout(expiryTimer);
  if(!staff){locked=false;deadline=Infinity;schedule(15000);return true;}
  if(next.allowed!==true){lock(next.reason,next);return false;}
  const lease=Number(next.lease_ms);if(!Number.isFinite(lease)||lease<=0||lease>15000){lock('verification_required',next);return false;}
  deadline=started+lease;
  if(deadline<=performance.now()){lock('verification_required',next);return false;}
  locked=false;stopped=false;
  expiryTimer=setTimeout(()=>{lock('verification_required');check();},Math.max(0,deadline-performance.now()));
  // Long leases poll before expiry. Short leases close at the exact boundary;
  // polling rapidly just before a scheduled close would add needless traffic.
  schedule(lease>=4000?Math.min(10000,Math.max(1000,lease-1500)):lease+50);
  return true;
 }
 function start(setup,started=performance.now()){
  stopped=false;if(setup.access)return accept(setup,started);
  if(setup.role==='kitchen'){lock('verification_required');return false;}
  document.body.classList.remove('recipe-staff-protected');schedule(15000);return true;
 }
 async function check(){
  if(stopped||document.hidden||!getState().role)return false;if(pending)return pending;
  const token=sequence,started=performance.now(),previous=policy,wasLocked=locked,state=getState();
  pending=(async()=>{
   try{
    const result=await call('access_check',context());if(token!==sequence||stopped)return false;
    if(result?.error){const error=Error(result.message);Object.assign(error,result);throw error;}
    const role=result?.role||result?.access?.role;
    if(!role)throw Error('Access verification is unavailable.');
    if(role!==state.role||Boolean(result.can_view_rd)!==Boolean(state.can_view_rd)){
     clearTimers();sequence++;await onPermissionChange(result);return true;
    }
    if(!accept(result,started))return false;
    if(isStaff()&&(wasLocked||(previous?.revision&&previous.revision!==result.access.revision))){await onResume({permissionsChanged:previous?.revision!==result.access.revision});}
    return true;
   }catch(error){
    if(token!==sequence||stopped)return false;
    if(isStaff()&&error.reason==='rd_denied'){
     lock('rd_denied',error.access||policy);
     // The protected request is denied before resolving its recipe. Recheck
     // account capabilities without an R&D context so Final access can resume.
     try{const fresh=await call('access_check',{});if(fresh?.role&&!fresh.error){await onPermissionChange(fresh);return true;}}catch{}
     return false;
    }
    if(isStaff())lock(error.reason||'connection_required',error.access||policy);
    else if(/Authorized recipe|permission denied|sign in|JWT|session/i.test(error.message)){clearTimers();sequence++;await onPermissionChange({role:null,can_view_rd:false});}
    else schedule(15000);
    return false;
   }finally{pending=null;}
  })();return pending;
 }
 function failure(error){
  if(!isStaff())return;
  if(error.access?.allowed===true&&['export_denied','action_denied','rd_denied'].includes(error.reason))return;
  lock(error.reason||'connection_required',error.access||policy);
 }
 function suspend(reason='verification_required'){
  if(isStaff())lock(reason);else clearTimeout(pollTimer);
 }
 function securityEvent(event){
  if(!isStaff())return;const last=events.get(event)||-Infinity;if(performance.now()-last<30000)return;
  events.set(event,performance.now());call('client_security_event',{event}).catch(()=>{});
 }
 function isRecipeTarget(event){return Boolean(event.target?.closest?.('#recipe-main,#recipe-dialog,.recipe-print-root'));}
 for(const type of ['copy','cut','contextmenu','dragstart'])document.addEventListener(type,event=>{
  if(!isStaff()||!isRecipeTarget(event)||event.target.closest('input,textarea,select'))return;
  event.preventDefault();securityEvent(type==='cut'?'copy':type==='dragstart'?'drag':type);
 },true);
 document.addEventListener('keydown',event=>{if(isStaff()&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='p'){event.preventDefault();securityEvent('print');notify('Printing is disabled for Kitchen Staff.');}},true);
 window.addEventListener('beforeprint',()=>securityEvent('print'));
 window.addEventListener('offline',()=>suspend('connection_required'));
 window.addEventListener('online',()=>check());
 window.addEventListener('pagehide',()=>suspend());
 window.addEventListener('pageshow',()=>{if(isStaff())suspend();check();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else check();});
 window.addEventListener('focus',()=>{if(isStaff()&&deadline<=performance.now())suspend();check();});
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('tlb-recipe-access-changed'):null;
 if(channel)channel.onmessage=event=>{if(event.data==='permissions-changed'){if(isStaff())suspend();check();}};
 return {accept,start,check,failure,suspend,context,securityEvent,
  changed(){channel?.postMessage('permissions-changed');},
  get locked(){return locked;},get policy(){return policy;},
  stop(){stopped=true;sequence++;clearTimers();policy=null;deadline=0;locked=false;},
 };
}

export function kitchenLockMarkup(reason,policy,esc){
 const hours=policy?.hours;
 const time=value=>{if(!value)return '';const [h,m]=value.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;};
 const screens={
  outside_hours:['Kitchen Recipes Are Currently Locked','Your Recipe access is currently outside your authorized working hours.'],
  date_blocked:['Kitchen Recipe Access Unavailable Today',"Recipe access has been disabled for your account for today’s production schedule."],
  account_blocked:['Recipe Access Unavailable','Your Kitchen Recipe access is currently disabled.'],
  temporary_block:['Recipe Access Unavailable','Your Kitchen Recipe access is temporarily unavailable.'],
  recipe_denied:['Recipe Access Unavailable','This recipe or version is no longer available to your account.'],
  connection_required:['Kitchen Recipes Are Currently Locked','Reconnect to verify your Kitchen Recipe access. Recipes are unavailable offline.'],
  verification_required:['Kitchen Recipe Access Closed','Verify your access to continue viewing Kitchen Recipes.'],
 };
 const [title,message]=screens[reason]||screens.account_blocked;
 return `<section class="recipe-empty kitchen-access-closed" data-kitchen-locked="${esc(reason)}"><div class="kitchen-lock-symbol" aria-hidden="true">▣</div><h1>${title}</h1><p>${message}</p>${reason==='outside_hours'&&hours?`<p class="kitchen-access-hours">${hours.enabled?`Today’s Recipe access hours: <strong>${time(hours.start)}–${time(hours.end)}</strong>`:'No Recipe access hours are scheduled today.'}<span>Asia/Manila</span></p>`:''}<p class="recipe-muted">Please contact an Administrator if access is required.</p><div class="recipe-actions"><button type="button" class="primary" data-action="verify-kitchen-access">Check Access</button><a class="recipe-button" href="account.html">My Account</a></div></section>`;
}
