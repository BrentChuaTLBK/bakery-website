import {credentials,endpoint,HttpError,readJson,uuid,verifiedUser} from '../_shared/server.ts';

type Media = {path:string;mime_type:string;size_bytes:number;access:{allowed:boolean;role:string}};
async function authorize(request:Request,input:Record<string,unknown>):Promise<Media>{
 await verifiedUser(request,true);
 const {url,key}=credentials();
 const response=await fetch(`${url}/rest/v1/rpc/recipe_api`,{
  method:'POST',headers:{apikey:key,Authorization:request.headers.get('authorization')||'','Content-Type':'application/json'},
  body:JSON.stringify({p_action:'media_authorize',p_payload:input}),signal:AbortSignal.timeout(10000),cache:'no-store',
 });
 const data=await response.json().catch(()=>null);
 if(!response.ok||data?.error||data?.access?.allowed!==true||data?.access?.role!=='kitchen')throw new HttpError(403,'Kitchen photo access is unavailable.');
 return data;
}
async function imageBytes(media:Media):Promise<Uint8Array>{
 const {url,key}=credentials();
 const path=media.path.split('/').map(encodeURIComponent).join('/');
 const response=await fetch(`${url}/storage/v1/object/recipe-files/${path}`,{
  headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000),cache:'no-store',
 });
 if(!response.ok)throw new HttpError(503,'The kitchen photo could not be loaded.');
 return new Uint8Array(await response.arrayBuffer());
}

export function createKitchenMediaHandler(dependencies={authorize,imageBytes}){
 return async(request:Request,headers:Headers):Promise<Response>=>{
  const body=await readJson(request),input={
   recipe_id:uuid(body.recipe_id,'Recipe'),file_id:uuid(body.file_id,'Photo'),version_id:uuid(body.version_id,'Version'),
   root_id:body.root_id?uuid(body.root_id,'Recipe context'):null,root_version:body.root_version?uuid(body.root_version,'Recipe context version'):null,
   rd:body.rd===true,
  };
  const media=await dependencies.authorize(request,input);
  if(!['image/jpeg','image/png','image/webp','image/heic'].includes(media.mime_type)||!Number.isSafeInteger(media.size_bytes)||media.size_bytes<=0||media.size_bytes>25*1024*1024)throw new HttpError(403,'Only authorized kitchen photos are available.');
  const bytes=await dependencies.imageBytes(media);
  if(bytes.byteLength!==media.size_bytes)throw new HttpError(503,'The kitchen photo could not be verified.');
  // A slow transfer must not finish with an expired permission. No signed URL,
  // storage path, or persistent download token is returned to the device.
  await dependencies.authorize(request,input);
  headers.set('Content-Type',media.mime_type);headers.set('Content-Disposition','inline');
  headers.set('Cache-Control','no-store, private, max-age=0');headers.set('Pragma','no-cache');
  headers.set('Vary','Origin, Authorization');headers.set('X-Content-Type-Options','nosniff');
  return new Response(bytes,{status:200,headers});
 };
}
export const handle=endpoint(createKitchenMediaHandler());
