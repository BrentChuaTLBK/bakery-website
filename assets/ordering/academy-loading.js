import {assetIds} from './academy-model.js';

// Page-local only: owner previews and public visits never share cached URLs.
// Storage signs for five minutes; renew a minute early, including request time.
export function createAcademyImageCache(fetchImages,{now=()=>Date.now()}={}){
 const images={},expires=new Map(),pending=new Map();
 const get=id=>expires.get(id)>now()?images[id]:undefined;
 async function load(content,{force=false}={}){
  const ids=assetIds(content),missing=ids.filter(id=>!pending.has(id)&&(force||!get(id))),wait=new Set(ids.map(id=>pending.get(id)).filter(Boolean));
  for(let i=0;i<missing.length;i+=64){
   const group=missing.slice(i,i+64),until=now()+240000;
   const request=Promise.resolve().then(()=>fetchImages(group.map(asset_id=>({asset_id})))).then(fresh=>{
    for(const id of group){if(fresh[id]?.url){images[id]=fresh[id];expires.set(id,until);}else{delete images[id];expires.delete(id);}}
   }).finally(()=>{for(const id of group)pending.delete(id);});
   group.forEach(id=>pending.set(id,request));wait.add(request);
  }
  await Promise.all(wait);
  return Object.fromEntries(ids.filter(id=>get(id)).map(id=>[id,get(id)]));
 }
 return {images,get,load,invalidate:id=>expires.delete(id),snapshot:()=>Object.fromEntries(Object.keys(images).filter(id=>get(id)).map(id=>[id,get(id)]))};
}

export function applyAcademyImage(img,image){
 if(!image?.url)return;
 if(image.width)img.width=image.width;if(image.height)img.height=image.height;
 img.removeAttribute('data-academy-pending');img.removeAttribute('data-academy-failed');
 if(img.getAttribute('src')!==image.url)img.src=image.url;
}

// Warm only the selected album. Two low-priority downloads at a time keep the
// next swipe ready without competing with the hero or a newly selected batch.
export function preloadAcademyBatch(cache,photos,{makeImage=()=>new Image(),connection=globalThis.navigator?.connection}={}){
 const limited=connection?.saveData||/^(slow-)?2g$/.test(connection?.effectiveType||'');
 const warmed=new Map(),running=new Set(),downloads=new Set();
 let queue=[...photos.slice(0,limited?24:photos.length)],active=0,signing=false,timer,disposed=false,failures=0;
 const doc=globalThis.document;
 const ready=p=>cache.get(p.asset_id)?.url===warmed.get(p.asset_id)&&warmed.has(p.asset_id);
 function schedule(delay=180){if(disposed)return;clearTimeout(timer);timer=setTimeout(pump,delay);}
 async function pump(){
  if(disposed||doc?.hidden)return;
  queue=queue.filter(p=>!ready(p)&&!running.has(p.asset_id));
  if(!queue.length||active>=2||signing)return;
  if(!cache.get(queue[0].asset_id)){
   signing=true;const group=queue.slice(0,24);
   try{await cache.load(group);failures=0;}
   catch{failures++;if(failures<=3)schedule(2000);return;}
   finally{signing=false;}
   if(disposed)return;
   // Missing/deleted assets must not create a tight retry loop.
   const missing=new Set(group.filter(p=>!cache.get(p.asset_id)).map(p=>p.asset_id));
   queue=queue.filter(p=>!missing.has(p.asset_id));
   if(!queue.length)return;
  }
  while(!disposed&&active<2&&queue.length){
   const p=queue[0],image=cache.get(p.asset_id);
   if(!image){schedule();break;}
   queue.shift();active++;running.add(p.asset_id);
   const img=makeImage();img.decoding='async';img.fetchPriority='low';
   let timeout;
   const done=success=>{clearTimeout(timeout);img.onload=img.onerror=null;downloads.delete(cancel);active--;running.delete(p.asset_id);if(success)warmed.set(p.asset_id,image.url);if(!disposed)schedule();};
   const cancel=()=>{done(false);img.removeAttribute('src');};downloads.add(cancel);
   img.onload=()=>done(true);img.onerror=()=>done(false);timeout=setTimeout(cancel,15000);img.src=image.url;
  }
 }
 function prioritize(photo){
  const index=photos.findIndex(p=>p.asset_id===photo.asset_id);if(index<0||disposed)return;
  const near=[...photos.slice(index+1,index+9),...photos.slice(Math.max(0,index-2),index)];
  const ids=new Set(near.map(p=>p.asset_id));queue=[...near,...queue.filter(p=>!ids.has(p.asset_id))];failures=0;schedule(0);
 }
 const visible=()=>{if(!doc.hidden)schedule(0);};doc?.addEventListener('visibilitychange',visible);
 schedule(100);
 return {prioritize,dispose(){disposed=true;clearTimeout(timer);queue=[];for(const cancel of [...downloads])cancel();doc?.removeEventListener('visibilitychange',visible);}};
}

// Resolve private image links near the viewport, not for every album in a class.
export function bindAcademyLazyImages(root,cache){
 const queued=new Set(),seen=new WeakSet(),retried=new Map();let timer=null,disposed=false;
 const note=document.createElement('p');note.className='academy-photo-status';note.hidden=true;note.setAttribute('role','status');
 note.innerHTML='Some photos could not load. <button type="button" class="academy-photo-retry">Try again</button>';
 root.querySelector('#bakers-in-action')?.append(note);
 function paint(img){const image=cache.get(img.dataset.academyAsset);if(image)applyAcademyImage(img,image);return !!image;}
 async function flush(){
  timer=null;const imgs=[...queued].filter(img=>img.isConnected&&!img.closest('[hidden]'));queued.clear();if(disposed||!imgs.length)return;
  try{
   await cache.load(imgs.map(img=>({asset_id:img.dataset.academyAsset})));
   if(disposed)return;
   for(const img of imgs)if(img.isConnected&&!paint(img)){img.dataset.academyFailed='';note.hidden=false;}
  }catch{if(!disposed){imgs.forEach(img=>img.dataset.academyFailed='');note.hidden=false;}}
 }
 function enqueue(img){if(disposed||img.closest('[hidden]')||paint(img))return;queued.add(img);if(timer===null)timer=setTimeout(flush,20);}
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){enqueue(e.target);observer.unobserve(e.target);}},{rootMargin:'200px 0px'}):null;
 function observe(scope=root){
  for(const img of scope.querySelectorAll('img[data-academy-asset]')){
   if(img.closest('[hidden]')||seen.has(img))continue;seen.add(img);
   if(!paint(img)){if(observer)observer.observe(img);else enqueue(img);}
  }
 }
 async function failed(e){
  const img=e.target,id=img.dataset?.academyAsset;if(img.tagName!=='IMG'||!id||img.hasAttribute('data-academy-pending'))return;
  if(Date.now()-(retried.get(id)||0)<60000){img.dataset.academyFailed='';note.hidden=false;return;}
  retried.set(id,Date.now());
  try{await cache.load({asset_id:id},{force:true});if(!disposed)for(const same of root.querySelectorAll('img[data-academy-asset]'))if(same.dataset.academyAsset===id&&!paint(same)){same.dataset.academyFailed='';note.hidden=false;}}
  catch{if(!disposed){img.dataset.academyFailed='';note.hidden=false;}}
 }
 note.querySelector('button').onclick=()=>{note.hidden=true;for(const img of root.querySelectorAll('[data-academy-failed]')){cache.invalidate(img.dataset.academyAsset);img.removeAttribute('data-academy-failed');seen.delete(img);}observe();};
 root.addEventListener('error',failed,true);observe();
 return {observe,dispose(){disposed=true;observer?.disconnect();if(timer!==null)clearTimeout(timer);queued.clear();root.removeEventListener('error',failed,true);note.remove();}};
}
