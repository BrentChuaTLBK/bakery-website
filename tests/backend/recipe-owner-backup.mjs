import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {digestBytes} from '../../assets/ordering/recipe-archive.js';
import {buildRecipeArchive} from '../../supabase/functions/recipe-backup/archive.ts';
import {readRecipeArchive} from '../../assets/ordering/recipe-recovery.js';
import {rehearseRecipeRestore} from '../../scripts/restore-recipe-backup.mjs';

// Archive worker imports use Node's TypeScript transform flag, like the existing
// backup suites. Keep this separate from ordinary plain-Node recipe contracts.
export default async function({check}){
 const require=createRequire(process.env.PGLITE_PACKAGE_ROOT?join(resolve(process.env.PGLITE_PACKAGE_ROOT),'package.json'):import.meta.url),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}}),project=resolve(import.meta.dirname,'../..');
 try{
  await db.exec(await readFile(join(project,'tests/backend/bootstrap.sql'),'utf8'));
  for(const name of (await readdir(join(project,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort())await db.exec((await readFile(join(project,'supabase/migrations',name),'utf8')).replace(/\r\n/g,'\n'));
  const h=await makeHarness(db),{owner,staff:chef,customer:kitchen}=h.ids;
  const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
  for(const [user,permission] of [[chef,'chef'],[kitchen,'kitchen']])await api('save_access',{user_id:user,permission});
  const bytes=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6v8AAAAASUVORK5CYII=','base64'));
  const file=await api('reserve_file',{filename:'owner-final.png',mime_type:'image/png',size_bytes:bytes.length,sha256:digestBytes(bytes)});
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:bytes.length,mimetype:'image/png'})]);await api('confirm_file',{id:file.id});
  const doc=name=>{const d=blankRecipe();d.name=name;d.variants[0].yield={quantity:'1',unit:'cake'};d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Mix.';return d;};
  const shared=await api('create',{document:doc('Shared backup Final'),status:'final'}),privateDoc=doc('OWNERVISIBILITYRESTOREDXYZ');privateDoc.files=[{id:file.id,visibility:'kitchen'}];
  const privateFinal=await api('create',{document:privateDoc,status:'final',visibility:'owner'});
 await check('owner backups preserve owner-only Finals and isolated restore does not reopen them to Chef or Kitchen',async()=>{
  const service=(action,payload={})=>h.as(null,async()=>(await db.query('select public.recipe_backup_service($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result,'service_role');
  for(const user of [chef,kitchen])await assert.rejects(()=>h.as(user,()=>db.query("select public.recipe_backup_api('status','{}')")),/owner|Authorized/);
  const start=await service('begin',{kind:'download',user_id:owner}),chunks=[];for await(const chunk of buildRecipeArchive(start,service,async()=>bytes))chunks.push(chunk);
  const archive=new Blob(chunks),recovered=await readRecipeArchive(archive);
  assert.equal(recovered.tables.recipes.find(r=>r.id===privateFinal.id).visibility,'owner');assert.equal(recovered.tables.recipes.find(r=>r.id===shared.id).visibility,'staff');
  const require=createRequire(process.env.PGLITE_PACKAGE_ROOT?join(resolve(process.env.PGLITE_PACKAGE_ROOT),'package.json'):import.meta.url),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
  const isolated=new PGlite({extensions:{pgcrypto}});
  try{
   assert.equal((await rehearseRecipeRestore(archive,{db:isolated})).relationships,true);
   assert.equal((await isolated.query('select visibility from tlb.recipes where id=$1',[privateFinal.id])).rows[0].visibility,'owner');
   const restoredApi=async(action,payload={},user=owner)=>{
    await isolated.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,role:'authenticated'})]);await isolated.exec('set role authenticated');
    try{return unwrapRecipeResult((await isolated.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);}finally{await isolated.exec('reset role');}
   };
   const restoredChef=randomUUID(),restoredKitchen=randomUUID();for(const [user,permission] of [[restoredChef,'chef'],[restoredKitchen,'kitchen']]){await isolated.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,`restored-${user}@example.test`]);await restoredApi('save_access',{user_id:user,permission});await restoredApi('save_rd_access',{user_id:user,can_view_rd:true});}
   await restoredApi('staff_set_mode',{users:[restoredKitchen],mode:'always'});
   assert.equal((await restoredApi('get',{id:privateFinal.id})).visibility,'owner');
   for(const user of [restoredChef,restoredKitchen]){assert.equal((await restoredApi('list',{query:privateFinal.document.name},user)).total,0);await assert.rejects(()=>restoredApi('get',{id:privateFinal.id},user),/access|not found|not available/i);assert.equal((await restoredApi('get',{id:shared.id},user)).id,shared.id);}
  }finally{await isolated.close();await service('finish',{job_id:start.job_id,lease_token:start.lease_token,sha256:digestBytes(new Uint8Array(await archive.arrayBuffer())),size_bytes:archive.size});}
 })();
 }finally{await db.close();}
}
