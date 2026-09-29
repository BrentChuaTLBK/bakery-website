import assert from 'node:assert/strict';
import {buildProofArchive} from '../../supabase/functions/order-backup/archive.ts';
import {backupZip,crc32} from '../../assets/ordering/backup-zip.js';
import {generateKeyPairSync} from 'node:crypto';
import {backupSheets,recoverBackupRows,buildBackupWorkbook,validateBackup} from '../../assets/ordering/order-backup.js';
import {sheetRequests,spreadsheetId,createGoogleSheets,BackupError} from '../../supabase/functions/order-backup/google.ts';
import {syncBackup,handle} from '../../supabase/functions/order-backup/handler.ts';
const o={id:'test-1',reference:'TLB-TEST',fulfillment_date:'2026-09-30',payment_status:'paid',paid_amount_cents:12000,fulfillment_status:'confirmed',source:'direct_message',method:'delivery',data:{buyer:{name:'=IMPORTXML("https://invalid.test")',phone:'09170000000'},total_cents:12000,delivery_cents:0,deferred_delivery:true,delivery_payment_status:'pending',items:[{name:'Box',quantity:2,unit_price_cents:6000,selection_labels:[{label:'Matcha',quantity:2}],description:'🍰'.repeat(20000)}]},payments:[],history:[],allocations:[]};
const snapshot={format:'tlb-order-backup',version:1,scope:'paid_active',generated_at:'2026-09-30T00:00:00Z',orders:[o]};
const sheets=['Orders','Items','Recovery'].map((title,sheetId)=>({properties:{sheetId,title,gridProperties:{rowCount:100,columnCount:26}}}));
const defs=backupSheets(snapshot);assert.equal(defs[0].rows[0][13],120);assert.match(defs[0].rows[0][12],/2 × Matcha/);
const noContact={...snapshot,orders:[{...o,data:{...o.data,buyer:{},contact_phone:'BUSINESS-PHONE',contact_email:'shop@example.test'}}]};
assert.deepEqual(backupSheets(noContact)[0].rows[0].slice(4,7),['','','']);
assert.deepEqual(recoverBackupRows(defs[2].rows,snapshot.generated_at).orders,[o]);
assert.throws(()=>recoverBackupRows(defs[2].rows.slice(1),snapshot.generated_at),/Missing/);
assert.throws(()=>recoverBackupRows([...defs[2].rows,defs[2].rows[0]],snapshot.generated_at),/Conflicting/);
assert.throws(()=>validateBackup({...snapshot,orders:[o,o]}),/duplicate/);
const requests=sheetRequests(snapshot,sheets),writes=requests.filter(r=>r.updateCells);
assert.equal(writes.length,3);assert.equal(writes[0].updateCells.range.endRowIndex,100);
assert.deepEqual(writes[0].updateCells.rows[5].values[4].userEnteredValue,{stringValue:o.data.buyer.name});
assert.ok(!JSON.stringify(requests).includes('formulaValue'));
assert.throws(()=>sheetRequests(snapshot,sheets.slice(1)),/configuration/);
assert.equal(sheetRequests({...snapshot,orders:[]},sheets).filter(r=>r.updateCells)[0].updateCells.rows[5].values[0].userEnteredValue.stringValue,'No orders in this backup.');
assert.equal(spreadsheetId('https://docs.google.com/spreadsheets/d/12345678901234567890/edit'),'12345678901234567890');assert.throws(()=>spreadsheetId('https://evil.test'),/configuration/);
let finishes=[];
const start={archive_file_id:'12345678901234567890archive',lease_token:'lease',revision:1,spreadsheet_id:'12345678901234567890',snapshot};
const dispatch=async(action,payload)=>action==='begin'?start:(finishes.push(payload),{pending:!!payload.error});
assert.equal((await syncBackup({writeArchive:async()=>{},write:async()=>{throw Error('provider-secret');}},dispatch)).ok,false);
assert.equal(finishes[0].error,'network');assert.ok(!JSON.stringify(finishes).includes('provider-secret'));
assert.equal((await syncBackup({writeArchive:async()=>{},write:async()=>{}},dispatch)).ok,true);assert.equal(finishes[1].revision,1);
assert.equal((await syncBackup({write:()=>{throw Error('must not run');}},async()=>({skipped:'unchanged'}))).skipped,'unchanged');
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),secret=JSON.stringify({type:'service_account',client_email:'test@fixture.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
let calls=[],tokens=0,fail=false;
const google=createGoogleSheets({getEnv:name=>name==='GA_SERVICE_ACCOUNT_JSON'?secret:'',request:async(url,options)=>{
 if(url==='https://oauth2.googleapis.com/token'){tokens++;const claims=JSON.parse(Buffer.from(new URLSearchParams(options.body).get('assertion').split('.')[1],'base64url'));assert.equal(claims.scope,'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive');return Response.json({access_token:'fixture',token_type:'Bearer',expires_in:3600});}
 calls.push({url,...options});
 if(fail)return Response.json({error:{details:[{reason:'SERVICE_DISABLED'}]}},{status:403});
 return Response.json(options.method==='GET'?{spreadsheetId:start.spreadsheet_id,sheets}:{spreadsheetId:start.spreadsheet_id,replies:JSON.parse(options.body).requests.map(()=>({}))});
}});
await google.write(start.spreadsheet_id,snapshot);await google.verify(start.spreadsheet_id);assert.equal(tokens,1);assert.equal(calls.filter(c=>c.method==='POST').length,1);
fail=true;await assert.rejects(google.verify(start.spreadsheet_id),/api_disabled/);
globalThis.Deno={env:{get:()=>''}};
assert.equal((await handle(new Request('https://example.test',{method:'POST',body:'{}'}))).status,401);
assert.equal((await handle(new Request('https://example.test',{method:'POST',headers:{'x-worker-token':'wrong'},body:'{}'}))).status,401);
// Independent JSZip parser verifies CRCs and byte-for-byte image recovery.
const {createRequire}=await import('node:module'),{join}=await import('node:path');
const JSZip=createRequire(import.meta.url)(process.env.ZIP_PACKAGE_ROOT?join(process.env.ZIP_PACKAGE_ROOT,'jszip'):'jszip');
assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
assert.throws(()=>backupZip([{name:'../outside.png',bytes:new Uint8Array()}]),/filename/);
assert.throws(()=>backupZip([{name:'a',bytes:'a'},{name:'a',bytes:'b'}]),/filename/);
assert.throws(()=>backupZip([{name:'a',bytes:'a'}],10),/too large/);
assert.equal(Object.keys((await JSZip.loadAsync(backupZip([]),{checkCRC32:true})).files).length,0);
const pixel=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64'));
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',path=id+'/receipt.png',deliveryPath=id+'/delivery.png';
const proofSnapshot={...snapshot,orders:[{...o,id,proof_path:path,payment_status:'under_review',fulfillment_status:'pending_confirmation',payments:[{proof_path:path}],delivery_payments:[{proof_path:deliveryPath}]}]};
const reads=[];const archive=await buildProofArchive(proofSnapshot,async path=>{reads.push(path);return pixel;});
assert.deepEqual(reads,[path,deliveryPath]);assert.equal(archive.proof_count,2);
const zip=await JSZip.loadAsync(archive.bytes,{checkCRC32:true});
const savedProofs=JSON.parse(await zip.file('orders.json').async('text'));
assert.equal(savedProofs.orders[0].payment_status,'under_review');assert.equal(savedProofs.proof_files.length,2);
for(const proof of savedProofs.proof_files){assert.ok(proof.archive_path.startsWith('proofs/TLB-TEST/'));assert.deepEqual(await zip.file(proof.archive_path).async('uint8array'),pixel);assert.equal(proof.sha256.length,64);}
await assert.rejects(buildProofArchive({...proofSnapshot,orders:[{...proofSnapshot.orders[0],proof_path:'https://attacker.test/a.png'}]},async()=>{throw Error('must not fetch');}),/proof_missing/);
await assert.rejects(buildProofArchive(proofSnapshot,async()=>new Uint8Array([0,1,2])),/proof_missing/);
await assert.rejects(buildProofArchive(proofSnapshot,async()=>new Uint8Array(5*1024*1024+1)),/proof_missing/);
const empty=await buildProofArchive({...snapshot,orders:[]});assert.equal(empty.proof_count,0);
assert.ok(!Object.keys((await JSZip.loadAsync(empty.bytes)).files).some(x=>x.startsWith('proofs/')));
let wrote=false;
assert.equal((await syncBackup({writeArchive:async()=>{wrote=true;},write:async()=>{wrote=true;}},dispatch,false,async()=>{throw new BackupError('proof_missing');})).ok,false);
assert.equal(wrote,false);assert.equal(finishes.at(-1).error,'proof_missing');
const steps=[];
await syncBackup({writeArchive:async()=>{steps.push('archive');throw Error('offline');},write:async()=>{steps.push('sheet');}},dispatch);
assert.deepEqual(steps,['archive']);assert.equal(finishes.at(-1).error,'network');
// A Drive upload is acknowledged only after ID, byte count and checksum match.
let driveMismatch=false,driveRequests=[];
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',archive.bytes)).toString('hex');
const drive=createGoogleSheets({getEnv:()=>secret,request:async(url,options)=>{
 if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture',token_type:'Bearer',expires_in:3600});
 driveRequests.push({url,...options});
 if(options.method==='PATCH')return new Response(null,{headers:{location:`https://www.googleapis.com/upload/drive/v3/files/${start.archive_file_id}?upload_id=test`}});
 assert.deepEqual(options.body,archive.bytes);return Response.json({id:start.archive_file_id,size:archive.bytes.length,sha256Checksum:driveMismatch?'wrong':hash});
}});
await drive.writeArchive(start.archive_file_id,archive.bytes);assert.deepEqual(driveRequests.map(x=>x.method),['PATCH','PUT']);
driveMismatch=true;await assert.rejects(drive.writeArchive(start.archive_file_id,archive.bytes),/network/);
const redirecting=createGoogleSheets({getEnv:()=>secret,request:async(url)=>url==='https://oauth2.googleapis.com/token'?Response.json({access_token:'fixture',token_type:'Bearer',expires_in:3600}):new Response(null,{headers:{location:'https://attacker.test/upload'}})});
await assert.rejects(redirecting.writeArchive(start.archive_file_id,archive.bytes),/network/);
// Owner-only binary download; archive references always come from the database.
const actualFetch=globalThis.fetch;let owner=true,storageReads=0;
globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'}[name]||'')}};
globalThis.fetch=async(url,options)=>{
 if(url.endsWith('/auth/v1/user'))return Response.json({id});
 if(url.includes('/rpc/order_backup_service')){
  const request=JSON.parse(options.body);assert.equal(request.p_payload.user_id,id);
  if(request.p_action==='owner_access')return owner?Response.json({allowed:true}):Response.json({code:'42501'},{status:403});
  assert.equal(request.p_action,'download');return Response.json(proofSnapshot);
 }
 assert.ok(url.startsWith('https://fixture.supabase.co/storage/v1/object/authenticated/payment-proofs/'+id+'/'));storageReads++;return new Response(pixel);
};
try{
 const request=()=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer fixture-user'},body:JSON.stringify({action:'download',scope:'paid_active',orders:[{proof_path:'https://attacker.test'}]})});
 owner=false;assert.equal((await handle(request())).status,403);assert.equal(storageReads,0);
 owner=true;const response=await handle(request());assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');assert.equal(response.headers.get('cache-control'),'no-store');
 const downloaded=await JSZip.loadAsync(await response.arrayBuffer(),{checkCRC32:true});assert.deepEqual(JSON.parse(await downloaded.file('orders.json').async('text')).orders,proofSnapshot.orders);assert.equal(storageReads,2);
}finally{globalThis.fetch=actualFetch;}
if(process.env.EXCELJS_PATH){
 const {createRequire}=await import('node:module'),ExcelJS=createRequire(import.meta.url)(process.env.EXCELJS_PATH);
 const wb=buildBackupWorkbook(snapshot,ExcelJS),buffer=await wb.xlsx.writeBuffer(),saved=new ExcelJS.Workbook();await saved.xlsx.load(buffer);
 assert.equal(saved.getWorksheet('Orders').getCell('E6').value,o.data.buyer.name);assert.equal(saved.getWorksheet('Orders').getCell('N6').value,120);
 const recovery=saved.getWorksheet('Recovery'),rows=[];for(let i=6;i<=recovery.rowCount;i++)rows.push(recovery.getRow(i).values.slice(1));
 assert.deepEqual(recoverBackupRows(rows,snapshot.generated_at).orders,[o]);
}
console.log('PASS order backup: permissions, literal cells, chunk recovery, Excel round trip, atomic Sheets writes, OAuth scope, retries and authentication');
