import {credentials,endpoint,HttpError,json,readJson,verifiedUser} from '../_shared/server.ts';
import {calendarError,createGoogleCalendar} from './google.ts';

const google=createGoogleCalendar();
async function service(action:string,payload:Record<string,unknown>={}){
 const {url,key}=credentials();
 const response=await fetch(`${url}/rest/v1/rpc/shop_calendar_service`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_payload:payload}),signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new HttpError(data?.code==='42501'?403:503,'Calendar access could not be completed.');
 return data;
}
async function workerAuthorized(token:string){
 const {url,key}=credentials();
 const response=await fetch(`${url}/rest/v1/rpc/tlb_calendar_worker_authorized`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_token:token}),signal:AbortSignal.timeout(8000)});
 return response.ok&&(await response.json())===true;
}
export async function syncCalendar(client=google,dispatch=service){
 const info=client.info();
 await dispatch('calendar_configuration',{configured:info.configured,service_account_email:info.service_account_email});
 const start=await dispatch('calendar_begin');
 if(!start.connected||start.busy)return start;
 const lease={lease_token:start.lease_token};
 let failure:string|null=null,updated=0,requeued=0;
 try{
  const scanned=await client.changes(start.calendar_id,start.sync_token,start.page_token);
  if(scanned.reset)await dispatch('calendar_scan_reset',lease);
  else await dispatch('calendar_scan',{...lease,...scanned});
  const jobs=await dispatch('calendar_jobs',lease);
  if(!Array.isArray(jobs))throw Error('Invalid calendar queue');
  for(const job of jobs){
   const context={...lease,order_id:job.order_id,event_id:job.event_id,revision:job.revision};
   try{
    const result=await client.sync(start.calendar_id,job);
    if(result.recreate){await dispatch('calendar_recreate',context);requeued++;}
    else {await dispatch('calendar_ack',{...context,etag:result.etag||null});updated++;}
   }catch(error){failure=calendarError(error);await dispatch('calendar_fail',{...context,error:failure});}
  }
 }catch(error){failure=calendarError(error);}
 const connection=await dispatch('calendar_finish',{...lease,error:failure});
 return {updated,requeued,connection};
}

export const handle=endpoint(async(request,headers)=>{
 const token=request.headers.get('x-worker-token');
 if(token!==null){
  if(!/^[a-f0-9]{64}$/.test(token)||!await workerAuthorized(token))throw new HttpError(401,'Calendar worker authorization required.');
  return json(await syncCalendar(),200,headers);
 }
 const user_id=await verifiedUser(request,true);
 const access=await service('calendar_owner_access',{user_id});
 if(access?.allowed!==true)throw new HttpError(403,'Owner access required.');
 const input=await readJson(request);
 if(input.action==='connection_info')return json({...google.info(),connection:access.connection},200,headers);
 if(input.action==='connect'){
  try{
   const checked=await google.verify(input.calendar_id);
   return json({connection:await service('calendar_connect',{user_id,calendar_id:checked.calendar_id})},200,headers);
  }catch(error){
   const code=calendarError(error);
   const messages={access:'Share this calendar with the service account using “Make changes to events.”',api_disabled:'Enable Google Calendar API in the service account’s Google Cloud project.',configuration:'Check the Calendar ID and the saved Google service account configuration.',quota:'Google is limiting calendar requests. Please try again shortly.',conflict:'An event conflicts with this connection. Please contact the shop owner.',network:'Google Calendar could not be reached. Please try again shortly.'};
   return json({error:messages[code],code},code==='configuration'?400:503,headers);
  }
 }
 throw new HttpError(400,'Choose a calendar connection action.');
});
