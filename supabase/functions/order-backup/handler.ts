import {credentials,endpoint,HttpError,json,readJson,verifiedUser} from '../_shared/server.ts';
import {createGoogleSheets,backupError,spreadsheetId} from './google.ts';
import {buildProofArchive} from './archive.ts';
const google=createGoogleSheets();
async function rpc(name:string,body:any){
 const {url,key}=credentials();
 const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new HttpError(data?.code==='42501'?403:503,'Order backup access could not be completed.');return data;
}
const service=(action:string,payload:Record<string,unknown>={})=>rpc('order_backup_service',{p_action:action,p_payload:payload});
export async function syncBackup(client=google,dispatch=service,force=false,archive=buildProofArchive){
 const start=await dispatch('begin',{force});if(start.skipped)return start;
 let error:string|null=null,proof_count=0;
 try{
  spreadsheetId(start.archive_file_id);
  const copy=await archive({...start.snapshot,archive_file_id:start.archive_file_id});proof_count=copy.proof_count;
  await client.writeArchive(start.archive_file_id,copy.bytes);
  await client.write(start.spreadsheet_id,copy.snapshot);
 }catch(e){error=backupError(e);}
 const connection=await dispatch('finish',{lease_token:start.lease_token,revision:start.revision,order_count:start.snapshot.orders.length,proof_count,error});
 return {ok:!error,connection};
}
export const handle=endpoint(async(request,headers)=>{
 const token=request.headers.get('x-worker-token');
 if(token!==null){
  if(!/^[a-f0-9]{64}$/.test(token)||await rpc('tlb_backup_worker_authorized',{p_token:token})!==true)throw new HttpError(401,'Backup worker authorization required.');
  return json(await syncBackup(),200,headers);
 }
 const user_id=await verifiedUser(request,true);
 const access=await service('owner_access',{user_id});
 if(access?.allowed!==true)throw new HttpError(403,'Owner access required.');
 const input=await readJson(request);
 if(input.action==='download'){
  try{
   const snapshot=await service('download',{user_id,scope:input.scope||'paid_active'});
   const copy=await buildProofArchive(snapshot);
   headers.set('Content-Type','application/zip');headers.set('Content-Disposition','attachment; filename="TLB-orders-and-proofs.zip"');
   return new Response(copy.bytes,{status:200,headers});
  }catch(e){return json({error:'The complete proof backup could not be created. No partial ZIP was downloaded.',code:backupError(e)},503,headers);}
 }
 if(input.action==='info')return json({...google.info(),connection:access.connection},200,headers);
 if(input.action==='sync')return json(await syncBackup(google,service,true),200,headers);
 if(input.action==='connect'){
  try{
   const id=spreadsheetId(input.spreadsheet_id);await google.verify(id);
   await service('connect',{user_id,spreadsheet_id:id,archive_file_id:input.archive_file_id?spreadsheetId(input.archive_file_id):undefined});
   return json(await syncBackup(google,service,true),200,headers);
  }catch(e){return json({error:'Google backup connection could not be completed.',code:backupError(e)},503,headers);}
 }
 throw new HttpError(400,'Choose a backup action.');
});
