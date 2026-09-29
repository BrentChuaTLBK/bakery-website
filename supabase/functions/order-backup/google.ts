import {env} from '../_shared/server.ts';
import {backupSheets} from '../../../assets/ordering/order-backup.js';

export class BackupError extends Error {constructor(public code:string){super(code);}}
export const backupError=(e:unknown)=>e instanceof BackupError?e.code:'network';
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const utf8=new TextEncoder(),segment=(v:unknown)=>encode(utf8.encode(JSON.stringify(v)));
export function spreadsheetId(value:unknown) {
 if(typeof value!=='string')throw new BackupError('configuration');
 const id=value.startsWith('https://docs.google.com/spreadsheets/d/')?value.split('/')[5]:value;
 if(!/^[A-Za-z0-9_-]{20,150}$/.test(id))throw new BackupError('configuration');return id;
}
export function sheetRequests(snapshot:any,sheets:any[]) {
 const requests:any[]=[{updateSpreadsheetProperties:{properties:{timeZone:'Asia/Manila'},fields:'timeZone'}}];
 for(const def of backupSheets(snapshot)) {
  const sheet=sheets.find(s=>s.properties?.title===def.name);
  if(!sheet)throw new BackupError('configuration');
  const id=sheet.properties.sheetId, columns=def.headers.length;
  const values=[[def.title],[def.stamp],[def.note],[],def.headers,...(def.rows.length?def.rows:[['No orders in this backup.']])];
  if(values.length>40000)throw new BackupError('too_large');
  const count=Math.max(sheet.properties.gridProperties?.rowCount||0,values.length);
  requests.push({updateSheetProperties:{properties:{sheetId:id,gridProperties:{rowCount:count,columnCount:Math.max(columns,sheet.properties.gridProperties?.columnCount||0),frozenRowCount:5,hideGridlines:true}},fields:'gridProperties'}});
  // Empty remaining cells in the same atomic batch that writes the new snapshot.
  requests.push({updateCells:{range:{sheetId:id,startRowIndex:0,endRowIndex:count,startColumnIndex:0,endColumnIndex:columns},
   rows:values.map(row=>({values:row.map(value=>({userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:String(value??'')}}))})),fields:'userEnteredValue'}});
  requests.push({repeatCell:{range:{sheetId:id,startRowIndex:4,endRowIndex:values.length,startColumnIndex:0,endColumnIndex:columns},cell:{userEnteredFormat:{wrapStrategy:'WRAP',verticalAlignment:'TOP',textFormat:{fontFamily:'Arial',fontSize:11},backgroundColor:{red:1,green:1,blue:1}}},fields:'userEnteredFormat'}});
  requests.push({repeatCell:{range:{sheetId:id,startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:columns},cell:{userEnteredFormat:{backgroundColor:{red:0.463,green:0.294,blue:0.145},textFormat:{bold:true,foregroundColor:{red:1,green:1,blue:1}},verticalAlignment:'MIDDLE',horizontalAlignment:'CENTER'}},fields:'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment,userEnteredFormat.horizontalAlignment'}});
  requests.push({updateBorders:{range:{sheetId:id,startRowIndex:4,endRowIndex:values.length,startColumnIndex:0,endColumnIndex:columns},...Object.fromEntries(['top','bottom','left','right','innerHorizontal','innerVertical'].map(k=>[k,{style:'SOLID',color:{red:0.85,green:0.79,blue:0.72}}]))}});
  for(const col of def.money)requests.push({repeatCell:{range:{sheetId:id,startRowIndex:5,endRowIndex:values.length,startColumnIndex:col,endColumnIndex:col+1},cell:{userEnteredFormat:{numberFormat:{type:'CURRENCY',pattern:'"₱"#,##0.00'},horizontalAlignment:'RIGHT'}},fields:'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment'}});
  for(const col of def.dates)requests.push({repeatCell:{range:{sheetId:id,startRowIndex:5,endRowIndex:values.length,startColumnIndex:col,endColumnIndex:col+1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'mmm d, yyyy'}}},fields:'userEnteredFormat.numberFormat'}});
  if(def.name!=='Recovery')requests.push({autoResizeDimensions:{dimensions:{sheetId:id,dimension:'ROWS',startIndex:5,endIndex:values.length}}});
  requests.push({setBasicFilter:{filter:{range:{sheetId:id,startRowIndex:4,endRowIndex:values.length,startColumnIndex:0,endColumnIndex:columns}}}});
 }
 if(utf8.encode(JSON.stringify(requests)).length>5_000_000)throw new BackupError('too_large');
 return requests;
}

export function createGoogleSheets({getEnv=env,request=fetch,now=()=>Date.now()}={}) {
 let cached:{secret:string,value:string,until:number}|null=null;
 function account(){
  const secret=getEnv('GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON')||getEnv('GA_SERVICE_ACCOUNT_JSON');
  try{const a=JSON.parse(secret);if(a.type!=='service_account'||!a.client_email?.endsWith('.iam.gserviceaccount.com')||!a.private_key)throw Error();return {secret,...a};}catch{throw new BackupError('configuration');}
 }
 async function token(){
  const a=account();if(cached?.secret===a.secret&&cached.until>now())return cached.value;
  const endpoint='https://oauth2.googleapis.com/token',issued=Math.floor(now()/1000);
  let key;try{key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(a.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);}catch{throw new BackupError('configuration');}
  const unsigned=`${segment({alg:'RS256',typ:'JWT'})}.${segment({iss:a.client_email,scope:'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',aud:endpoint,iat:issued,exp:issued+3600})}`;
  const signature=encode(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,utf8.encode(unsigned))));
  const response=await request(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`}),signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||typeof data?.access_token!=='string'||data.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=60)throw new BackupError('access');
  cached={secret:a.secret,value:data.access_token,until:now()+(Math.min(data.expires_in,3600)-60)*1000};return cached.value;
 }
 async function call(id:string,method='GET',body?:any){
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId(id)}${method==='POST'?':batchUpdate':'?fields=spreadsheetId,sheets(properties)'}`;
  const response=await request(url,{method,redirect:'error',headers:{Authorization:`Bearer ${await token()}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok){
   if(response.status===401)cached=null;
   const disabled=data?.error?.details?.some((d:any)=>d.reason==='SERVICE_DISABLED')||data?.error?.errors?.some((d:any)=>d.reason==='accessNotConfigured');
   throw new BackupError(disabled?'api_disabled':response.status===429?'quota':[401,403,404].includes(response.status)?'access':'network');
  }
  if(!data)throw new BackupError('network');return data;
 }
 return {
  async writeArchive(id:string,bytes:Uint8Array){
   spreadsheetId(id);
   const auth={Authorization:`Bearer ${await token()}`};
   const check=async(response:Response)=>{
    const data=await response.json().catch(()=>null);
    if(!response.ok){if(response.status===401)cached=null;const disabled=data?.error?.details?.some((d:any)=>d.reason==='SERVICE_DISABLED')||data?.error?.errors?.some((d:any)=>d.reason==='accessNotConfigured');throw new BackupError(disabled?'api_disabled':response.status===429?'quota':[401,403,404].includes(response.status)?'access':'network');}
    return data;
   };
   // Use a resumable update of one user-owned file; service accounts have no My Drive quota.
   const start=await request(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=resumable&fields=id,size,sha256Checksum`,{method:'PATCH',redirect:'error',headers:{...auth,'Content-Type':'application/json','X-Upload-Content-Type':'application/zip','X-Upload-Content-Length':String(bytes.length)},body:JSON.stringify({mimeType:'application/zip'}),signal:AbortSignal.timeout(15000)});
   if(!start.ok)await check(start);
   const location=start.headers.get('location');let upload:URL;try{upload=new URL(location||'');}catch{throw new BackupError('network');}
   if(upload.origin!=='https://www.googleapis.com'||!upload.pathname.startsWith('/upload/drive/v3/files/'))throw new BackupError('network');
   const result=await check(await request(upload.href,{method:'PUT',redirect:'error',headers:{...auth,'Content-Type':'application/zip'},body:bytes,signal:AbortSignal.timeout(45000)}));
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(result?.id!==id||Number(result.size)!==bytes.length||result.sha256Checksum!==hash)throw new BackupError('network');
  },
  info(){try{const a=account();return {configured:true,service_account_email:a.client_email,cloud_project:a.project_id};}catch{return {configured:false};}},
  async verify(id:string){const data=await call(id);for(const name of ['Orders','Items','Recovery'])if(!data.sheets?.some((s:any)=>s.properties?.title===name))throw new BackupError('configuration');return data;},
  async write(id:string,snapshot:any){
   const data=await call(id);const requests=sheetRequests(snapshot,data.sheets||[]);
   const result=await call(id,'POST',{requests});
   if(result.spreadsheetId!==id||!Array.isArray(result.replies)||result.replies.length!==requests.length)throw new BackupError('network');
  }
 };
}
