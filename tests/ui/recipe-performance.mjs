import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
const t=await recipeBrowserHarness(),{h,api,pageFor,origin}=t,results=[];
const call=(action,payload)=>api(h.ids.owner,action,payload);
const out=new URL('../../work/recipe-audit/',import.meta.url);await mkdir(out,{recursive:true});
const stats=values=>{const s=values.slice().sort((a,b)=>a-b);return {samples:s.length,p50_ms:+s[Math.floor(s.length*.5)].toFixed(2),p95_ms:+s[Math.min(s.length-1,Math.ceil(s.length*.95)-1)].toFixed(2),max_ms:+s.at(-1).toFixed(2)};};
async function measure(name,fn,n=10){const times=[];let value;await fn();for(let i=0;i<n;i++){const start=performance.now();value=await fn();times.push(performance.now()-start);}const row={name,...stats(times),response_bytes:Buffer.byteLength(JSON.stringify(value)??'')};results.push(row);console.log(JSON.stringify(row));return value;}
try{
 let first;
 for(let i=0;i<500;i++){
  const d=blankRecipe();d.name=`Performance cake ${String(i).padStart(4,'0')}`;const v=d.variants[0];v.yield={quantity:'6',unit:'pcs'};v.groups[0].ingredients=Array.from({length:12},(_,j)=>({id:'ingredient-'+j,name:'Ingredient '+j,quantity:'94',unit:'g',cost_snapshot:{amount:'750',quantity:'1.5',unit:'kg',currency:'PHP'}}));v.methods[0].steps[0].instruction='Mix and bake.';v.costing={mode:'saleable',labor_percent:'20',saleable_yield:'6',sale_unit:'each',selling_price:'150',price_basis:'unit'};
  const saved=await call('create',{document:d,status:'final'});first??=saved;
  await call('save_resource',{kind:i<400?'ingredient':'supplier',name:`Performance ${i<400?'ingredient':'supplier'} ${i}`,data:{default_unit:'g'}});
 }
 console.log('Seeded 500 recipes, 6000 ingredient rows, 400 ingredients and 100 suppliers in isolated PostgreSQL.');
 const library=await measure('Recipe library API',()=>call('list',{}));assert.equal(library.total,500);assert.equal(library.rows.length,30);
 await measure('Recipe opening API',()=>call('get',{id:first.id}));
 await measure('Ingredient search API',()=>call('resources',{kind:'ingredient',query:'Performance ingredient 39'}));
 await measure('Supplier search API',()=>call('resources',{kind:'supplier',query:'Performance supplier 49'}));
 await measure('Current costing API',()=>call('costing',{id:first.id,source:'current',factor:'1.15'}));
 await measure('Production recipe API',()=>call('get',{id:first.id,kitchen:true}));
 await measure('Version history API',()=>call('versions',{id:first.id}));
 const overview=await measure('Costing overview API',()=>call('costing_overview',{sort:'lowest_margin'}));assert.equal(overview.total,500);assert.equal(overview.rows.length,24);assert.ok(overview.rows.every(r=>!r.summary.lines));
 const {page,context}=await pageFor(h.ids.owner,820);
 await measure('Tablet library navigation and render',async()=>{await page.goto(origin+'/recipes.html');await page.locator('.recipe-card').filter({hasText:'Performance cake 0000'}).getByRole('button',{name:'Open recipe',exact:true}).waitFor();return null;},5);
 await page.locator('.recipe-card').filter({hasText:'Performance cake 0000'}).getByRole('button',{name:'Open recipe',exact:true}).click();await page.locator('[data-saved-cost-card] [data-cost-value=base_cost]').waitFor();
 let target=2;await measure('Tablet scaling through rendered cost update',async()=>{target=target===2?3:2;await page.locator('[data-scale=target]').fill(String(target));await page.locator('[data-scale=target]').press('Tab');await page.waitForFunction(value=>document.querySelector('[data-saved-cost-card] [data-cost-value=base_cost]')?.textContent===value,new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(564*target));return null;});
 await page.getByRole('button',{name:'Library',exact:true}).click();
 await measure('Tablet costing overview and return to library',async()=>{await page.getByRole('button',{name:'Costing Overview',exact:true}).click();await page.locator('[data-cost-product]').first().waitFor();const count=await page.locator('[data-cost-product]').count();await page.getByRole('button',{name:'Recipes',exact:true}).click();await page.getByRole('button',{name:'Open recipe',exact:true}).first().waitFor();return count;},5);
 assert.deepEqual(t.errors,[]);await context.close();
 await writeFile(new URL('performance-results.json',out),JSON.stringify({environment:'Isolated PGlite PostgreSQL + headless Chrome on this Windows workstation; no production network latency or multi-session load included.',dataset:{recipes:500,ingredient_rows:6000,ingredients:400,suppliers:100},results},null,2));
}finally{await t.close();}
