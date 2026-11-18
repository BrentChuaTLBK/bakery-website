// Browser tests use local fixtures only, without Google, Supabase or live users.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
const require=createRequire(import.meta.url);
const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://google-signin.test';
const client=await readFile(join(root,'assets/ordering/client.js'),'utf8');
const helpers=client.slice(client.indexOf('export function money('));
const mock=`
const fragment=new URLSearchParams(location.hash.slice(1));
export const authLink={received:fragment.has('access_token'),failed:fragment.has('error'),type:fragment.get('type'),recovery:fragment.get('type')==='recovery'};
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
export const ready=Promise.resolve(),configured=true,initializationError=null;
const user=()=>window.testUser||null;
export const auth={getUser:async()=>({data:{user:user()}}),getSession:async()=>({data:{session:user()?{user:user(),access_token:'fixture'}:null}}),onAuthStateChange:()=>({}),
signInWithOAuth:async value=>{window.oauthCalls=(window.oauthCalls||[]).concat([value]);if(window.oauthFails)return {error:new Error('Fixture failure')};location.assign('/google-provider');return {data:{},error:null}},
signInWithPassword:async value=>{window.passwordCalls=(window.passwordCalls||[]).concat([value]);return {error:null}},
signOut:async()=>({error:null})};
export async function api(action){if(action==='my_orders')return [{id:'existing-order',reference:'TLB-EXISTING',total_cents:10000,fulfillment_date:'2026-10-20',method:'pickup',payment_status:'paid',fulfillment_status:'confirmed',items:[]}];throw Error('No staff access')}
${helpers}`;
const iphone=process.env.BROWSER_ENGINE==='webkit';
const browser=await (iphone?webkit:chromium).launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
const device=iphone?devices['iPhone 15 Pro Max']:{viewport:{width:390,height:844}};
const errors=[],requests=[],out=resolve(root,'work');await mkdir(out,{recursive:true});
let checks=0;
const check=(name,value)=>{assert.ok(value,name);checks++;};
try{
 async function fixture({settings,oauthFails=false,user=null,remembered=null,recipeRole=null}={}){
  const context=await browser.newContext({...device,serviceWorkers:'block'});
  await context.addInitScript(({oauthFails,user,remembered})=>{
   window.oauthFails=oauthFails;window.testUser=user;
   if(!localStorage.getItem('tlb-checkout-v1'))localStorage.setItem('tlb-checkout-v1','saved checkout fixture');
   if(remembered&&!sessionStorage.getItem('tlb-auth-return-v1'))sessionStorage.setItem('tlb-auth-return-v1',remembered);
  },{oauthFails,user,remembered});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/rest/v1/rpc/recipe_api'){assert.deepEqual(route.request().postDataJSON(),{p_action:'bootstrap',p_payload:{}});assert.equal(route.request().headers().authorization,'Bearer fixture');return route.fulfill({status:recipeRole?200:403,contentType:'application/json',body:JSON.stringify(recipeRole?{role:recipeRole}:{message:'No recipe access'})});}
   if(url.pathname==='/auth/v1/settings')return settings ? settings(route) : route.fulfill({json:{external:{google:true}}});
   if(url.pathname==='/rest/v1/rpc/newsletter_offer')return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,kind:'percent',value:5,valid_days:30,min_subtotal_cents:30000,cap_cents:10000})});
   if(url.pathname==='/functions/v1/newsletter'){const input=route.request().postDataJSON();if(input.action==='subscribe')await route.request().frame().evaluate(()=>window.newsletterSubscribes=(window.newsletterSubscribes||0)+1);return route.fulfill({contentType:'application/json',body:JSON.stringify({status:input.action==='subscribe'?'subscribed':'not_subscribed'})});}
   if(url.origin!==origin){requests.push(url.href);return route.abort()}
   if(url.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:mock});
   if(url.pathname==='/assets/ordering/traffic.js')return route.fulfill({contentType:'text/javascript',body:''});
   if(['/shop.html','/manage.html','/google-provider'].includes(url.pathname))return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local destination</title><p>Returned</p>'});
   try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(url.pathname)]||'application/octet-stream',body:await readFile(join(root,url.pathname))})}
   catch{return route.fulfill({status:404,body:'Not found'})}
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));return {context,page};
 }
 const googleButton=page=>page.getByRole('button',{name:'Sign in with Google',exact:true});
 let enabled=false,settingsReads=0;
 let f=await fixture({settings:route=>{
   settingsReads++;
   return route.fulfill({json:{external:{google:enabled}}});
 }});
 await f.page.goto(origin+'/account.html',{waitUntil:'networkidle'});
 check('Google is available to select before any settings request',await googleButton(f.page).isEnabled()&&settingsReads===0);
 await googleButton(f.page).click();
 await f.page.getByText(/Google sign-in is currently unavailable/).waitFor();
 check('An explicitly disabled provider gives a retry without starting OAuth',await googleButton(f.page).isEnabled()&&await f.page.evaluate(()=>!window.oauthCalls));
 enabled=true;
 await googleButton(f.page).click();
 await f.page.waitForURL(origin+'/google-provider');
 check('A Google-only customer can retry on the same page when the provider returns',settingsReads===2);
 await f.context.close();

 f=await fixture({settings:route=>route.fulfill({status:503,json:{}})});
 await f.page.goto(origin+'/account.html?mode=signup');
 await googleButton(f.page).waitFor();
 check('Google and email signup are both available during a settings outage',await googleButton(f.page).isEnabled()&&await f.page.locator('[name=password]').isEnabled());
 await googleButton(f.page).click();
 await f.page.waitForURL(origin+'/google-provider');
 check('A failed settings lookup still lets Google OAuth start',true);
 await f.context.close();

 let stalledSettings;
 f=await fixture({settings:route=>{stalledSettings=route;}});
 await f.page.goto(origin+'/account.html');
 await googleButton(f.page).click();
 await f.page.waitForURL(origin+'/google-provider',{timeout:12000});
 check('A stalled settings request allows the Google handoff after the timeout',Boolean(stalledSettings));
 await stalledSettings.abort().catch(()=>{});
 await f.context.close();

 f=await fixture();await f.page.goto(origin+'/account.html');
 await googleButton(f.page).waitFor();
 await f.context.setOffline(true);
 await googleButton(f.page).click();
 await f.page.getByText(/You’re offline/).waitFor();
 check('Google stays available to retry while offline',await googleButton(f.page).isEnabled()&&await f.page.evaluate(()=>!window.oauthCalls));
 await f.context.setOffline(false);
 await googleButton(f.page).click();
 await f.page.waitForURL(origin+'/google-provider');
 check('Reconnecting allows Google sign-in without a page reload',true);
 await f.context.close();
 f=await fixture();await f.page.goto(origin+'/account.html?next=shop.html%23checkout',{waitUntil:'networkidle'});
 await f.page.getByRole('button',{name:'Sign in with Google',exact:true}).waitFor();
 check('Google sign-in fits on mobile',await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await f.page.screenshot({path:join(out,iphone?'google-signin-iphone-webkit.png':'google-signin-mobile.png'),fullPage:true});
 await f.page.getByRole('button',{name:'Sign in with Google',exact:true}).click();await f.page.waitForURL(origin+'/google-provider');
 check('Google does not require email/password fields before redirect',new URL(f.page.url()).pathname==='/google-provider');
 check('Checkout and safe return destination survive OAuth launch',await f.page.evaluate(()=>localStorage.getItem('tlb-checkout-v1')==='saved checkout fixture'&&sessionStorage.getItem('tlb-auth-return-v1')==='/shop.html#checkout'));await f.context.close();
 f=await fixture({oauthFails:true});await f.page.goto(origin+'/account.html?mode=signup',{waitUntil:'networkidle'});
 await f.page.getByRole('button',{name:'Sign in with Google',exact:true}).click();
 await f.page.getByText('Google sign-in could not start. Check your connection and try the Google button again.').waitFor();
 const calls=await f.page.evaluate(()=>window.oauthCalls);
 assert.deepEqual(calls,[{provider:'google',options:{redirectTo:origin+'/oauth-callback.html',queryParams:{prompt:'select_account'}}}]);checks++;
 check('OAuth error restores Google and password controls',await f.page.getByRole('button',{name:'Sign in with Google',exact:true}).isEnabled()&&await f.page.locator('[name=password]').isEnabled());
 check('Google signup does not opt into the newsletter',await f.page.locator('[name=newsletter]').isChecked()===false);
 await f.page.locator('[data-mode=signin]').click();await f.page.locator('[name=email]').fill('existing@example.test');await f.page.locator('[name=password]').fill('fixture-password');await f.page.locator('#auth-form button[type=submit]').click();await f.page.waitForURL(origin+'/shop.html');check('Password login remains available after OAuth error',true);await f.context.close();
 const user={id:'same-existing-user',email:'existing@example.test',email_confirmed_at:'2026-09-19T00:00:00Z'};
 for(const recipeRole of ['kitchen','chef']){f=await fixture({user,recipeRole});await f.page.goto(origin+'/account.html');await f.page.getByRole('link',{name:recipeRole==='kitchen'?'Kitchen recipes':'Recipe library',exact:true}).waitFor();check('Recipe-only '+recipeRole+' account has a recipe link without shop staff access',await f.page.locator('#staff-link').isHidden());await f.context.close();}
 f=await fixture({user});await f.context.addInitScript(()=>sessionStorage.setItem('tlb-newsletter-signup-consent',String(Date.now())));await f.page.goto(origin+'/oauth-callback.html#access_token=fixture');await f.page.waitForURL(origin+'/shop.html');check('Explicit Google signup consent suppresses the newsletter popup',await f.page.evaluate(()=>localStorage.getItem('tlb-newsletter-preference'))==='subscribed');await f.context.close();
 for(const destination of ['/shop.html#checkout','/account.html','/manage.html','/manage.html#pos']){
  f=await fixture({user,remembered:destination});await f.page.goto(origin+'/oauth-callback.html#access_token=fixture');await f.page.waitForURL(origin+destination);
  check('Verified Google callback returns to '+destination,await f.page.evaluate(()=>localStorage.getItem('tlb-checkout-v1'))==='saved checkout fixture');
  if(destination==='/account.html'){await f.page.getByText('TLB-EXISTING',{exact:true}).waitFor();check('Existing signed-in account still loads its order history',true)}
  await f.context.close();
 }
 for(const remembered of ['https://evil.invalid','//evil.invalid','/unknown.html','javascript:alert(1)']){
  f=await fixture({user,remembered});await f.page.goto(origin+'/oauth-callback.html#access_token=fixture');await f.page.waitForURL(origin+'/shop.html');check('Unsafe return destination stays on this shop: '+remembered,true);await f.context.close();
 }
 for(const [fragment,callbackUser] of [['',user],['#error=access_denied',user],['#access_token=fixture',null],['#access_token=fixture&type=recovery',user],['#access_token=fixture',{...user,email_confirmed_at:null}]]){
  f=await fixture({user:callbackUser});await f.page.goto(origin+'/oauth-callback.html'+fragment);await f.page.getByRole('heading',{name:'Google sign-in wasn’t completed'}).waitFor();
  check('Incomplete, cancelled, recovery, or unverified callback cannot appear successful',new URL(f.page.url()).pathname==='/oauth-callback.html');await f.context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log(`Google sign-in browser checks passed: ${checks}. No live OAuth calls.`);
}finally{await browser.close()}
