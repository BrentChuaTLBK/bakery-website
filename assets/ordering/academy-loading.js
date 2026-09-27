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
