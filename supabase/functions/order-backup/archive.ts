import {credentials} from '../_shared/server.ts';
import {imageType,MAX_IMAGE_BYTES} from '../_shared/images.ts';
import {BackupError} from './google.ts';
import {validateBackup,proofPaths} from '../../../assets/ordering/order-backup.js';
import {backupZip} from '../../../assets/ordering/backup-zip.js';

export async function fetchProof(path:string,signal:AbortSignal){
 const {url,key}=credentials();
 const response=await fetch(`${url}/storage/v1/object/authenticated/payment-proofs/${path}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
 if(!response.ok||!response.body)throw new BackupError('proof_missing');
 if(Number(response.headers.get('content-length'))>MAX_IMAGE_BYTES)throw new BackupError('too_large');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_IMAGE_BYTES){await reader.cancel();throw new BackupError('too_large');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export async function buildProofArchive(snapshot:any,read=fetchProof){
 validateBackup(snapshot);
 const files:any[]=[],manifest:any[]=[],signal=AbortSignal.timeout(60000);let size=0;
 // Strict order-owned paths: never fetch an arbitrary URL or another order's proof.
 for(const order of snapshot.orders)for(const path of proofPaths(order)){
  if(!/^[0-9a-f-]{36}\/[-A-Za-z0-9_]{1,150}\.(png|jpg|jpeg|webp|heic|heif)$/i.test(path)||path.split('/')[0]!==order.id)throw new BackupError('proof_missing');
  if(signal.aborted)throw new BackupError('network');
  const bytes=await read(path,signal);size+=bytes.length;if(size>45*1024*1024)throw new BackupError('too_large');
  try{imageType(bytes);}catch{throw new BackupError('proof_missing');}
  const reference=String(order.reference).replace(/[^A-Za-z0-9_-]/g,'_');
  const archive_path=`proofs/${reference}/${order.id}-${path.split('/')[1]}`;
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  files.push({name:archive_path,bytes});manifest.push({order_id:order.id,reference:order.reference,source_path:path,archive_path,bytes:bytes.length,sha256});
 }
 const copy={...snapshot,proof_files:manifest,limitations:['Operational order recovery data, not a full database restore.','Attached payment proofs are included as original image files. Customer access tokens are excluded.']};
 files.unshift({name:'orders.json',bytes:JSON.stringify(copy,null,2)},{name:'README.txt',bytes:`TLBK active order backup\nSaved: ${snapshot.generated_at}\nOrders: ${snapshot.orders.length}\nProof images: ${manifest.length}\n\norders.json contains order details and an image manifest with SHA-256 checksums.\nMatch images in proofs/ to their order reference using proof_files in orders.json.\nOnly images attached to these orders or their payment records are included.\nKeep this file private. This is a recovery copy, not an automatic database restore.\n`});
 try{return {bytes:backupZip(files),snapshot:copy,proof_count:manifest.length};}catch{throw new BackupError('too_large');}
}
