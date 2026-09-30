import {recipeZip} from '../../../assets/ordering/recipe-archive.js';
import {RecipeBackupError} from '../recipe-backup/google.ts';
const utf8=new TextEncoder();
export function buildAcademyArchive(start:any,dispatch:any,_read?:unknown,signal=AbortSignal.timeout(340000)){
 const context={job_id:start.job_id,lease_token:start.lease_token};
 const manifest:any={format:'tlb-academy-backup',version:1,generated_at:start.generated_at,record_count:start.record_count,files_included:false,tables:start.tables,entries:[],
 exclusions:['Uploaded image and attachment bytes (metadata only).','Passwords, sessions, authentication/API secrets and newsletter unsubscribe tokens.','Production recipes, costing, supplier data and unrelated orders.']};
 async function* tableRows(table:string){yield utf8.encode('[');let after=0,first=true;while(true){if(signal.aborted)throw new RecipeBackupError('network');const page=await dispatch('page',{...context,table,after,limit:10});if(!page.rows.length)break;for(const row of page.rows){after=row.sequence;yield utf8.encode((first?'':',')+JSON.stringify(row.data));first=false;}}yield utf8.encode(']');}
 async function* entries(){
 yield {path:'README.txt',bytes:'TLB Academy recovery archive\n\nThis snapshot includes Academy curricula, instructors, modules, enrollments and history, independent student recipes and versions, announcements, upcoming classes, newsletter preferences, gallery and moderation state, submissions, message/thread records and attachment metadata, audit history and broadcast records.\n\nUPLOADED IMAGES AND ATTACHMENTS ARE NOT INCLUDED. Keep a separate private Storage backup. Media cannot be reconstructed from this archive alone.\n\nPasswords, sessions, API secrets and unsubscribe tokens are excluded. Restore to an isolated database first, reconcile existing Auth/Admin IDs, and regenerate unsubscribe tokens. The production-recipe source reference is provenance only; student documents are independent. Never restore over production for testing.\n\nVerify every SHA-256 in manifest.json. Reconcile counts and foreign keys, then test access controls before switching systems.\n'};
 for(const table of start.tables)yield {path:`Database Exports/${table}.json`,stream:tableRows(table)};
 yield {path:'manifest.json',bytes:JSON.stringify(manifest,null,2)};
 }
 let count=0;return recipeZip(entries(),{timestamp:new Date(start.generated_at),onEntry:async(entry:any)=>{if(entry.path!=='manifest.json')manifest.entries.push(entry);if(++count%10===0)await dispatch('progress',{...context,entries:count});}});
}
