// Loopback-only preview with real Postgres migrations and persistent local data.
// No live Supabase connection, accounts, orders, uploads or email sends are used.
import {createServer} from 'node:http';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),dir=resolve(process.env.ACADEMY_PREVIEW_DIR||join(root,'work/academy-preview-data'));
const require=createRequire(process.env.PGLITE_PACKAGE_ROOT?join(process.env.PGLITE_PACKAGE_ROOT,'package.json'):import.meta.url);
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
await mkdir(dir,{recursive:true});await mkdir(join(dir,'photos'),{recursive:true});
const db=new PGlite(join(dir,'database'),{extensions:{pgcrypto}});
const owner='ac000000-0000-4000-8000-000000000001',staff='ac000000-0000-4000-8000-000000000002',session=randomUUID();
if(!(await db.query("select to_regclass('tlb.academy_classes') as existing")).rows[0].existing){
 await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));
 for(const file of(await readdir(join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(join(root,'supabase/migrations',file),'utf8'));
 await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'academy-owner@example.test',now()),($2,'academy-staff@example.test',now())",[owner,staff]);
 await db.query("insert into tlb.staff(user_id,role) values($1,'owner'),($2,'staff')",[owner,staff]);
 await db.exec('grant select,insert on storage.objects to authenticated;grant select on storage.objects to anon;');
 await db.exec("update tlb.academy_classes set draft=draft||jsonb_build_object('category_label',case draft->>'slug' when '2nd-summer-baking-camp' then 'Baking camp' when 'cookies-and-brownies' then 'Baking class' else 'Decorating class' end)");
}
// Reapply this idempotent draft migration when restarting the local preview.
// Existing local class content and images are retained by ON CONFLICT clauses.
await db.exec(await readFile(join(root,'supabase/migrations/20260926023820_academy_content.sql'),'utf8'));
let queue=Promise.resolve();
function access(user,fn){const result=queue.then(()=>db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[user||'',JSON.stringify({sub:user,role:user?'authenticated':'anon'})]);await tx.exec('set local role '+(user?'authenticated':'anon'));return fn(tx);}));queue=result.catch(()=>{});return result;}
const original=await readFile(join(root,'assets/ordering/client.js'),'utf8'),helpers=original.slice(original.indexOf('export function money('));
const exports=[...original.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g)].map(m=>m[1]);
const special=new Set(['configured','ready','auth','api','academyApi','academyUpload','academySignedUrls']);
const helpersNames=new Set([...helpers.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g)].map(m=>m[1]));
const adapter=`export const configured=true,ready=Promise.resolve();
const request=async(action,payload={})=>{const r=await fetch('/__preview/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
export const auth={getSession:async()=>({data:{session:await request('session')}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})};
export const api=(action,payload)=>request('shop:'+action,payload);
export const academyApi=(action,payload)=>request('academy:'+action,payload);
export async function academyUpload(file,id){const r=await fetch('/__preview/upload/'+id,{method:'POST',headers:{'Content-Type':file.type},body:file});if(!r.ok)throw Error((await r.json()).error);}
export const academySignedUrls=paths=>request('images',{paths});
${exports.filter(n=>!special.has(n)&&!helpersNames.has(n)).map(n=>`export async function ${n}(){throw Error('This action is not available in the isolated Academy preview.');}`).join('\n')}
${helpers}`;
const port=Number(process.env.PORT||4175),origin='http://127.0.0.1:'+port;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.ico':'image/x-icon'};
async function body(req,max){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('Upload is too large.');chunks.push(chunk);}return Buffer.concat(chunks);}
const server=createServer(async(req,res)=>{
 const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
 try{
  if(req.headers.host!=='127.0.0.1:'+port)return send({error:'Loopback preview only.'},403);
  const url=new URL(req.url,origin),path=decodeURIComponent(url.pathname),cookie=req.headers.cookie||'',user=cookie.includes('academy_preview='+session)?owner:cookie.includes('academy_preview=staff-'+session)?staff:null;
  if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==origin)return send({error:'Origin not allowed.'},403);
  if(path==='/__preview/owner'||path==='/__preview/staff'||path==='/__preview/logout'){
   res.writeHead(302,{'set-cookie':`academy_preview=${path.endsWith('/owner')?session:path.endsWith('/staff')?'staff-'+session:''}; HttpOnly; SameSite=Strict; Path=/`,'location':path.endsWith('/logout')?'/academy.html':'/manage.html#academy','cache-control':'no-store'});return res.end();
  }
  if(path==='/__preview/api'){
   const {action,payload={}}=JSON.parse((await body(req,2_500_000)).toString());
   if(action==='session')return send(user?{user:{id:user}}:null);
   if(action==='shop:admin_bootstrap'){if(!user)return send({error:'Sign in to preview Academy admin.'},403);return send({role:user===owner?'owner':'staff',products:[],categories:[],orders:[],inventory:[],zones:[],staff:[],promos:[],settings:{paused:false}});}
   if(action.startsWith('academy:'))return send(await access(user,async tx=>(await tx.query('select public.academy_api($1,$2::jsonb) result',[action.slice(8),JSON.stringify(payload)])).rows[0].result));
   if(action==='images'){const rows=[];if(!Array.isArray(payload.paths)||payload.paths.length>1000)throw Error('Invalid image request.');for(const p of payload.paths){const allowed=await access(user,async tx=>(await tx.query('select public.academy_media_readable($1) allowed',[p])).rows[0].allowed);if(allowed)rows.push({path:p,signedUrl:'/__preview/photo/'+p});else rows.push({path:p,error:'Private image'});}return send(rows);}
   return send({error:'This preview only supports Academy. Other website features use the existing live system.'},400);
  }
  if(path.startsWith('/__preview/upload/')){
   if(user!==owner)return send({error:'Only the owner may upload Academy photos.'},403);
   const id=path.split('/').pop();if(!/^[0-9a-f-]{36}$/.test(id)||req.method!=='POST'||req.headers['content-type']!=='image/webp')throw Error('Upload a converted WebP image.');
   const bytes=await body(req,5242880);if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw Error('Invalid WebP image.');
   await writeFile(join(dir,'photos',id+'.webp'),bytes,{flag:'wx'});
   await access(user,tx=>tx.query("insert into storage.objects(bucket_id,name,owner) values('academy-photos',$1,$2)",[id+'.webp',owner]));return send({success:true});
  }
  if(path.startsWith('/__preview/photo/')){
   const name=path.split('/').pop();if(!/^[0-9a-f-]{36}\.webp$/.test(name))return send({error:'Photo not found.'},404);
   const allowed=await access(user,async tx=>(await tx.query('select public.academy_media_readable($1) allowed',[name])).rows[0].allowed);
   if(!allowed)return send({error:'Photo is private.'},403);res.writeHead(200,{'content-type':'image/webp','cache-control':'private, no-store'});return res.end(await readFile(join(dir,'photos',name)));
  }
  if(path==='/assets/ordering/client.js'){res.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'});return res.end(adapter);}
  if(path==='/assets/ordering/config.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end("export const config={supabaseUrl:'',supabasePublishableKey:''};");}
  if(!(path.startsWith('/assets/')||/^\/[a-z-]+\.html$/.test(path)))return send({error:'Not available in preview.'},404);
  const file=resolve(root,'.'+path);if(!file.startsWith(root+sep))return send({error:'Not found.'},404);
  let bytes=await readFile(file);
  if(path.endsWith('.html')){let html=bytes.toString();html=html.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>');html=html.replace(/<body([^>]*)>/,'<body$1><div style="background:#e9d7b6;color:#392719;padding:9px 20px;font:13px Arial;text-align:center">Local Academy preview · changes stay on this computer · <a href="/__preview/owner">Open owner admin</a> · <a href="academy.html?preview=1">Draft preview</a> · <a href="academy.html">Published preview</a></div>');bytes=Buffer.from(html);}
  res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes);
 }catch(error){if(!res.headersSent)send({error:error.code==='ENOENT'?'Not found.':error.message},error.code==='ENOENT'?404:400);else res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log('Academy preview ready: '+origin+'/__preview/owner'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await db.close();process.exit();}));
