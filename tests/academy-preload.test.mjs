import assert from 'node:assert/strict';
import {createAcademyImageCache,preloadAcademyBatch} from '../assets/ordering/academy-loading.js';
const photos=Array.from({length:70},(_,i)=>({asset_id:'selected-'+i}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let calls=[],downloaded=[],active=0,maximum=0;
const cache=createAcademyImageCache(async refs=>{calls.push(refs.map(p=>p.asset_id));return Object.fromEntries(refs.map(p=>[p.asset_id,{url:'https://test/'+p.asset_id}]));});
function makeImage(){let timer,live=false;return {set src(url){downloaded.push(url);live=true;active++;maximum=Math.max(maximum,active);timer=setTimeout(()=>{live=false;active--;this.onload?.();},15);},removeAttribute(){clearTimeout(timer);if(live){active--;live=false;}}};}
let loader=preloadAcademyBatch(cache,photos,{makeImage});
for(let i=0;i<40&&!downloaded.some(s=>s.endsWith('-25'));i++)await sleep(150);
assert.equal(calls[0].length,24);assert.ok(downloaded.some(s=>s.endsWith('-25')),'Later photos are downloaded in the background');assert.equal(maximum,2);
loader.prioritize(photos[55]);await sleep(500);assert.ok(downloaded.some(s=>s.endsWith('-56')),'Upcoming swipe photos jump ahead of sequential warming');
loader.dispose();const count=downloaded.length;await sleep(350);assert.equal(downloaded.length,count,'Disposal stops background downloads');assert.equal(active,0);
calls=[];downloaded=[];
const limitedCache=createAcademyImageCache(async refs=>{calls.push(refs.map(p=>p.asset_id));return Object.fromEntries(refs.map(p=>[p.asset_id,{url:'https://test/'+p.asset_id}]));});
loader=preloadAcademyBatch(limitedCache,photos,{makeImage,connection:{saveData:true}});
await sleep(2800);assert.equal(downloaded.length,24,'Data saver preloads only the first page');
loader.prioritize(photos[40]);await sleep(500);assert.ok(downloaded.some(s=>s.endsWith('-41')),'Swiping still warms nearby photos with Data saver');loader.dispose();
console.log('PASS album preloading: first-page priority, bounded concurrency, swipe look-ahead, cancellation and Data saver');
