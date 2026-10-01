import {createRequire} from 'node:module';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
export async function recipeBrowserHarness(){
 const require=createRequire(import.meta.url),dbRequire=createRequire(join(resolve(process.env.PGLITE_PACKAGE_ROOT||'../newsletter-test-deps'),'package.json'));
 const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
 const {PGlite}=dbRequire('@electric-sql/pglite'),{pgcrypto}=dbRequire('@electric-sql/pglite/contrib/pgcrypto');
 const root=resolve(import.meta.dirname,'../..'),origin='https://recipe-audit.test',out=join(root,'tests/artifacts/recipe-audit');await mkdir(out,{recursive:true});
 const db=new PGlite({extensions:{pgcrypto}});await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));
 for(const name of(await readdir(join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(join(root,'supabase/migrations',name),'utf8'));
 const h=await makeHarness(db),timings=[],errors=[];let queue=Promise.resolve(),failAction=null;
 function api(user,action,payload={}){
  const run=async()=>{const start=performance.now();try{if(failAction===action){failAction=null;throw Error('Connection interrupted. Try again.');}return await h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);}finally{timings.push({action,ms:performance.now()-start});}};
  queue=queue.then(run,run);return queue;
 }
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 async function pageFor(user,width=1440){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.exposeFunction('auditRecipeApi',(action,payload)=>api(user,action,payload));
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:`export const ready=Promise.resolve(),auth={getSession:async()=>({data:{session:window.auditSignedOut?null:{user:{id:${JSON.stringify(user)}}}}}),onAuthStateChange:callback=>{window.auditAuthEvent=event=>{if(event==='SIGNED_OUT')window.auditSignedOut=true;callback(event);};return {data:{subscription:{unsubscribe(){}}}};}};export const recipeApi=(action,payload={})=>window.auditRecipeApi(action,payload);export const recipeFileUrl=async()=>'';export const uploadRecipeFile=async()=>{throw Error('No upload fixture in this suite')};`});
   const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({body:await readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'}[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404});}
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {page,context};
 }
 return {h,db,api,pageFor,origin,out,errors,timings,failNext:action=>{failAction=action;},close:async()=>{await browser.close();await queue.catch(()=>{});await db.close();}};
}
