import {credentials,endpoint,HttpError,json,readBody,uuid,verifiedUser} from '../_shared/server.ts';
export function validateWebP(bytes:Uint8Array){
 const fail=()=>{throw new HttpError(400,'Choose a valid, static WebP photo without camera metadata.');};
 const text=(a:number,b:number)=>new TextDecoder().decode(bytes.subarray(a,b));
 if(bytes.length<20||text(0,4)!=='RIFF'||text(8,12)!=='WEBP')fail();
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(4,true)+8!==bytes.length)fail();
 let offset=12,width=0,height=0,frames=0;
 while(offset+8<=bytes.length){const kind=text(offset,offset+4),size=view.getUint32(offset+4,true),start=offset+8,end=start+size;if(end>bytes.length)fail();
  if(kind==='VP8 '){if(size<10||(bytes[start]&1)!==0||bytes[start+3]!==0x9d||bytes[start+4]!==1||bytes[start+5]!==0x2a)fail();width=view.getUint16(start+6,true)&0x3fff;height=view.getUint16(start+8,true)&0x3fff;frames++;}
  else if(kind==='VP8L'){if(size<5||bytes[start]!==0x2f)fail();const n=view.getUint32(start+1,true);width=(n&0x3fff)+1;height=((n>>>14)&0x3fff)+1;frames++;}
  else if(kind==='VP8X'){if(size!==10||(bytes[start]&0x0e)!==0)fail();}
  else if(kind==='ICCP'){if(size>65536)fail();} // Canvas may retain a small sRGB colour profile.
  else if(kind!=='ALPH')fail();
  offset=end+(size%2);
 }
 if(offset!==bytes.length||frames!==1||width<1||height<1||width>4096||height>4096)fail();return {width,height};
}
async function rpc(name:string,body:any,authorization?:string){const {url,key}=credentials();const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:authorization||`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await response.json().catch(()=>null);if(!response.ok)throw new HttpError(403,'This upload is not available to your account.');return data;}
export const handle=endpoint(async(request,headers)=>{
 const user=await verifiedUser(request,true),id=uuid(new URL(request.url).searchParams.get('id'),'Photo ID');
 const record=await rpc('academy_portal_upload_check',{p_id:id},request.headers.get('authorization')!);
 if(request.headers.get('content-type')!=='image/webp')throw new HttpError(400,'Upload a converted WebP photo.');
 const bytes=await readBody(request,5242880),dimensions=validateWebP(bytes);
 if(bytes.length!==record.size_bytes||dimensions.width!==record.width||dimensions.height!==record.height)throw new HttpError(400,'Photo dimensions or size do not match the upload.');
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(record.uploaded){if(record.sha256!==sha256)throw new HttpError(409,'This photo is already uploaded.');return json({id,uploaded:true},200,headers);}
 const {url,key}=credentials();
 const response=await fetch(`${url}/storage/v1/object/academy-student-media/${record.path}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'image/webp','Cache-Control':'no-store','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000)});
 if(!response.ok){
  // A response can be lost after storage accepted the immutable upload. Verify
  // the existing bytes before acknowledging a retry; never overwrite them.
  const existing=await fetch(`${url}/storage/v1/object/authenticated/academy-student-media/${record.path}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
  if(!existing.ok)throw new HttpError(502,'Photo storage is unavailable. Please retry.');
  const saved=await readBody(new Request('https://local.test',{method:'POST',body:existing.body,duplex:'half'} as any),5242880);
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',saved))].map(b=>b.toString(16).padStart(2,'0')).join('');if(hash!==sha256)throw new HttpError(409,'This upload already contains another photo.');
 }
 return json(await rpc('academy_portal_confirm_upload',{p_id:id,p_user:user,p_sha256:sha256}),200,headers);
});
