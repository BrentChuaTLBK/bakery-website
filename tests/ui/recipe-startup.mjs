import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,sep,extname} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),origin='https://recipe-startup.test';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const checks=[];
async function run(mode){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 const errors=[],clients=[];let clientRequested;const clientRequest=new Promise(resolve=>{clientRequested=resolve;});page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/assets/ordering/client.js'){
   clients.push(u.search);clientRequested();
   // A returning visitor may have the pre-recipe client cached without these exports.
   if(!u.search||mode==='missing-export')return route.fulfill({contentType:'text/javascript',body:'export const ready=Promise.resolve(),auth=null;'});
   const session=mode==='signed-out'?'null':'{user:{id:"recipe-test"}}';
   return route.fulfill({contentType:'text/javascript',body:`export const ready=${mode==='stalled'?'new Promise(()=>{})':'Promise.resolve()'},auth={getSession:async()=>({data:{session:${session}}})};export const recipeApi=async action=>action==='bootstrap'?{role:'owner',categories:[],settings:{}}:{rows:[],total:0};export const uploadRecipeFile=async()=>({}),recipeFileUrl=async()=>'';`});
  }
  if(mode==='module-failure'&&u.pathname==='/assets/ordering/recipes.js')return route.fulfill({status:503,body:'Temporarily unavailable'});
  const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto(origin+'/recipes.html',{waitUntil:'domcontentloaded'});
 if(mode==='stalled'){await clientRequest;await page.clock.fastForward(21000);}
 if(['stalled','module-failure','missing-export'].includes(mode)){
  await page.getByRole('button',{name:'Reload recipe library'}).waitFor();
  assert.equal(await page.getByText('Opening your recipe library…').count(),0);
  assert.equal(await page.getByRole('link',{name:'Open account',exact:true}).getAttribute('href'),'account.html?next=recipes.html');
 }else if(mode==='signed-out')await page.getByRole('link',{name:'Sign in',exact:true}).waitFor();
 else {await page.getByRole('button',{name:'+ New recipe',exact:true}).waitFor();assert.deepEqual(clients,['?v=recipe-system-2']);}
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 checks.push(mode);await context.close();
}
try{for(const mode of ['cached-client','signed-out','missing-export','module-failure','stalled'])await run(mode);await mkdir(join(root,'tests/artifacts/recipe-startup'),{recursive:true});await writeFile(join(root,'tests/artifacts/recipe-startup/results.json'),JSON.stringify({checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));}
finally{await browser.close();}
