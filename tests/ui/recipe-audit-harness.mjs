import {createRequire} from 'node:module';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
import {unwrapRecipeResult} from '../backend/recipe-staff-fixture.mjs';
export async function recipeBrowserHarness({engine='chromium'}={}){
 const require=createRequire(import.meta.url),dbRequire=createRequire(join(resolve(process.env.PGLITE_PACKAGE_ROOT||'../newsletter-test-deps'),'package.json'));
 const playwright=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
 const {PGlite}=dbRequire('@electric-sql/pglite'),{pgcrypto}=dbRequire('@electric-sql/pglite/contrib/pgcrypto');
 const root=resolve(import.meta.dirname,'../..'),origin='https://recipe-audit.test',out=join(root,'tests/artifacts/recipe-audit');await mkdir(out,{recursive:true});
 const db=new PGlite({extensions:{pgcrypto}});await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));
 for(const name of(await readdir(join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort())await db.exec((await readFile(join(root,'supabase/migrations',name),'utf8')).replace(/\r\n/g,'\n'));
 await db.exec("create or replace function tlb.recipe_staff_now() returns timestamptz language sql volatile security invoker set search_path='' as $$ select '2026-10-01T06:00:00Z'::timestamptz $$");
 const h=await makeHarness(db),timings=[],errors=[],requests=[];let queue=Promise.resolve(),failAction=null;
 function api(user,action,payload={},raw=false){
  const run=async()=>{const start=performance.now();try{if(failAction===action){failAction=null;throw Error('Connection interrupted. Try again.');}const response=await h.as(user,async()=>(await db.query("with value as materialized(select public.recipe_api($1,$2::jsonb) result) select result,nullif(current_setting('response.headers',true),'') headers,nullif(current_setting('response.status',true),'') status from value",[action,JSON.stringify(payload)])).rows[0]);requests.push({user,action,payload,result:response.result,headers:response.headers,status:Number(response.status||200)});return raw?response:unwrapRecipeResult(response.result);}finally{timings.push({action,ms:performance.now()-start});}};
  queue=queue.then(run,run);return queue;
 }
 const browser=await playwright[engine].launch({...engine==='chromium'?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{},headless:true});
 async function pageFor(user,width=1440,{network=false,...contextOptions}={}){
  const context=await browser.newContext({viewport:{width,height:1000},...contextOptions});await context.exposeFunction('auditRecipeApi',(action,payload)=>api(user,action,payload,true).then(response=>response.result));
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.protocol==='blob:')return route.continue();
   if(network&&u.origin==='https://esm.sh'&&u.pathname.startsWith('/@supabase/supabase-js@'))return route.fulfill({contentType:'text/javascript',body:`export function createClient(){const callbacks=[];const auth={initialize:async()=>({error:null}),getSession:async()=>({data:{session:window.auditSignedOut?null:{access_token:'fixture-${user}',user:{id:${JSON.stringify(user)}}}}}),onAuthStateChange:callback=>{callbacks.push(callback);window.auditAuthEvent=event=>{if(event==='SIGNED_OUT')window.auditSignedOut=true;for(const c of callbacks)c(event);};return {data:{subscription:{unsubscribe(){}}}};}};return {auth};}`});
   if(u.origin!==origin)return route.abort();
   if(network&&u.pathname==='/assets/ordering/config.js')return route.fulfill({contentType:'text/javascript',body:`export const config={supabaseUrl:${JSON.stringify(origin)},supabasePublishableKey:'sb_publishable_fixture'};`});
   if(network&&u.pathname==='/rest/v1/rpc/recipe_api'){
    const {p_action,p_payload}=route.request().postDataJSON();
    try{const response=await api(user,p_action,p_payload,true),headers=Object.assign({'Content-Type':'application/json'},...JSON.parse(response.headers||'[]'));return route.fulfill({status:Number(response.status||200),headers,body:JSON.stringify(response.result)});}
    catch(error){return route.fulfill({status:error.code==='42501'?403:503,contentType:'application/json',body:JSON.stringify({message:error.message,code:error.code})});}
   }
   if(!network&&u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:`export const ready=Promise.resolve(),auth={getSession:async()=>({data:{session:window.auditSignedOut?null:{user:{id:${JSON.stringify(user)}}}}}),onAuthStateChange:callback=>{window.auditAuthEvent=event=>{if(event==='SIGNED_OUT')window.auditSignedOut=true;callback(event);};return {data:{subscription:{unsubscribe(){}}}};}};export const recipeApi=(action,payload={})=>window.auditRecipeApi(action,payload);export const recipeFileUrl=async()=>'';export const uploadRecipeFile=async()=>{throw Error('No upload fixture in this suite')};`});
   const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();
   try{return route.fulfill({body:await readFile(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'}[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404});}
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {page,context};
 }
 return {h,db,api,pageFor,origin,out,errors,timings,requests,run:fn=>{queue=queue.then(fn,fn);return queue;},failNext:action=>{failAction=action;},close:async()=>{await browser.close();await queue.catch(()=>{});await db.close();}};
}
