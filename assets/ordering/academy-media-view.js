// Authenticated, view-scoped photo loading. Failed photos recover in place.
export function createPortalMedia({api,download}){
 let epoch=0,observer=null;const cache=new Map(),formats=new Map(),loading=new Set(),queue=new Set(),urls=new Set(),failures=new Map(),states=new WeakMap(),inspectionScopes=new WeakSet();
 const denied=error=>['42501','ACADEMY_MEDIA_DENIED'].includes(error?.code)||[401,403,404].includes(Number(error?.status))||/private media denied|not available to your account/i.test(error?.message||'');
 const targets=id=>[...document.querySelectorAll('img[data-media-id]')].filter(n=>n.dataset.mediaId===id&&n.isConnected);
 const invalidate=id=>{const url=cache.get(id);if(url){URL.revokeObjectURL(url);urls.delete(url);cache.delete(id);}formats.delete(id);};
 function failure(id,error){
  invalidate(id);const terminal=denied(error);failures.set(id,(failures.get(id)||0)+1);
  for(const node of targets(id)){
   const state=states.get(node)||{};states.set(node,state);state.failed=true;node.removeAttribute('src');node.alt=terminal?'Photo no longer available':'Photo unavailable';node.classList.add('ap-photo-unavailable');state.box?.remove();
   const box=document.createElement('div');box.className='ap-photo-recovery';box.setAttribute('role','status');box.textContent=terminal?'This photo is no longer available to your account.':'This photo could not load.';
   if(!terminal){const retry=document.createElement('button');retry.type='button';retry.className='ap-button secondary small';retry.textContent='Retry photo';box.append(retry);retry.onclick=async()=>{if(loading.has(id))return;retry.disabled=true;retry.textContent='Retrying…';const current=epoch;await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**Math.min(failures.get(id)-1,3),8000)));if(current!==epoch||!node.isConnected)return;state.failed=false;await load([id]);};}
   (node.closest('button')||node).after(box);state.box=box;
  }
 }
 function originalPreview(node,state){state.box?.remove();const box=document.createElement('div');box.className='ap-photo-recovery';box.setAttribute('role','status');box.textContent='Original HEIC photo saved. Preview unavailable on this device.';(node.closest('button')||node).after(box);state.box=box;}
 function show(id,url){for(const node of targets(id)){const state=states.get(node)||{};states.set(node,state);state.failed=false;state.box?.remove();state.box=null;node.classList.remove('ap-photo-unavailable');node.alt=state.alt||node.alt;
  // Keep a useful saved-file state even on engines that do not dispatch an
  // image error for an unsupported HEIC codec. A successful decode removes it.
  if(formats.get(id)==='image/heic')originalPreview(node,state);
  node.onload=()=>{if(node.naturalWidth&&cache.get(id)===url){state.box?.remove();state.box=null;}};
  node.onerror=()=>{
  if(!node.isConnected||cache.get(id)!==url)return;
  if(formats.get(id)==='image/heic'){
   state.failed=true;node.onerror=null;node.removeAttribute('src');node.alt='Original HEIC photo';node.classList.add('ap-photo-unavailable');state.box?.remove();
   originalPreview(node,state);
  }else failure(id,new Error('The photo could not be decoded.'));
 };node.src=url;if(formats.get(id)==='image/heic'&&node.decode)node.decode().catch(()=>{if(node.src===url)node.onerror?.();});}}
 async function bytes(record,current){
  formats.set(record.id,record.mime_type||(/\.heic$/i.test(record.path)?'image/heic':'image/webp'));
  if(cache.has(record.id)){show(record.id,cache.get(record.id));return;}
  const blob=await download(record.path);if(current!==epoch||!targets(record.id).length)return;
  const url=URL.createObjectURL(blob);urls.add(url);cache.set(record.id,url);show(record.id,url);
 }
 async function load(ids){
  ids=ids.filter(id=>!loading.has(id));if(!ids.length)return;ids.forEach(id=>loading.add(id));const current=epoch;
  try{
   const records=await api('media',{ids});if(current!==epoch)return;
   const found=new Set(records.map(r=>r.id));for(const id of ids)if(!found.has(id))failure(id,{code:'ACADEMY_MEDIA_DENIED'});
   await Promise.all(records.map(async record=>{try{await bytes(record,current);}catch(error){if(current===epoch)failure(record.id,error);}}));
  }catch(error){if(current===epoch&&error.code!=='ACADEMY_STALE')ids.forEach(id=>failure(id,error));}
  finally{if(current===epoch)ids.forEach(id=>loading.delete(id));}
 }
 function flush(){const ids=[...new Set([...queue].filter(n=>n.isConnected&&!n.src&&!states.get(n)?.failed).map(n=>n.dataset.mediaId))];queue.clear();for(let i=0;i<ids.length;i+=50)load(ids.slice(i,i+50));}
 function hydrate(scope){
  for(const node of scope.querySelectorAll('img[data-media-id]')){
   if(node.src||states.get(node)?.failed)continue;if(!states.has(node))states.set(node,{alt:node.alt});
   if(cache.has(node.dataset.mediaId)){show(node.dataset.mediaId,cache.get(node.dataset.mediaId));continue;}
   const enqueue=()=>{queue.add(node);queueMicrotask(flush);};
   if(!('IntersectionObserver' in window)){enqueue();continue;}
   observer ||= new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){observer.unobserve(e.target);queue.add(e.target);}queueMicrotask(flush);},{rootMargin:'180px'});observer.observe(node);
  }
 }
 function clear(){epoch++;observer?.disconnect();observer=null;queue.clear();loading.clear();failures.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear();cache.clear();formats.clear();}
 function bindInspection(scope,ui){
  for(const node of scope.querySelectorAll('img[data-media-id]')){
   if(node.closest('button'))continue;
   const button=document.createElement('button');button.type='button';button.className='ap-inspect-photo';button.dataset.inspectPhoto=node.dataset.mediaId;button.setAttribute('aria-label','Inspect '+(node.alt||'photo'));
   node.before(button);button.append(node);const label=document.createElement('span');label.textContent='Inspect photo';button.append(label);
  }
  if(inspectionScopes.has(scope))return;inspectionScopes.add(scope);
  let modal=null,disposed=false,stop=null;
  ui.registerCleanup(()=>{disposed=true;stop?.();modal?.close();});
  scope.addEventListener('click',async event=>{
   const trigger=event.target.closest('[data-inspect-photo]');if(!trigger||modal?.open||disposed)return;
   const images=[...scope.querySelectorAll('[data-inspect-photo]')],ids=images.map(n=>n.dataset.inspectPhoto);let index=ids.indexOf(trigger.dataset.inspectPhoto),version=0,checking=false;
   modal=ui.dialog('Inspect photo','<p class="ap-small" data-inspect-count role="status"></p><div class="ap-inspect-stage" data-inspect-stage></div><div class="ap-actions"><button type="button" class="ap-button secondary" data-inspect-prev>Previous photo</button><button type="button" class="ap-button secondary" data-inspect-next>Next photo</button></div>');
   const viewer=modal;viewer.classList.add('ap-photo-viewer');const stage=viewer.querySelector('[data-inspect-stage]'),count=viewer.querySelector('[data-inspect-count]');
   const isCurrent=t=>!disposed&&viewer.open&&modal===viewer&&t===version;
   const confirm=async id=>{const records=await api('media',{ids:[id]});const record=records.find(r=>r.id===id);if(!record)throw Object.assign(new Error('This photo is no longer available to your account.'),{code:'ACADEMY_MEDIA_DENIED'});return record;};
   const closeDenied=error=>{failure(ids[index],error);viewer.close();ui.notice(denied(error)?'This photo is no longer available to your account.':'The photo could not be checked. Please try again.',true);};
   const showImage=async next=>{
    index=next;const current=++version;stage.innerHTML='<p role="status">Opening photo…</p>';count.textContent=`Photo ${index+1} of ${ids.length}`;
    const focused=document.activeElement,previous=viewer.querySelector('[data-inspect-prev]'),nextButton=viewer.querySelector('[data-inspect-next]');previous.disabled=index===0;nextButton.disabled=index===ids.length-1;
    if((focused===previous||focused===nextButton)&&focused.disabled)(previous.disabled?nextButton:previous).focus();
    try{const record=await confirm(ids[index]);if(!isCurrent(current))return;stage.innerHTML=ui.photo(record.id,images[index].querySelector('img').alt,'ap-inspected-image');const node=stage.querySelector('img');states.set(node,{alt:node.alt});await bytes(record,epoch);}
    catch(error){if(isCurrent(current)&&error.code!=='ACADEMY_STALE')closeDenied(error);}
   };
   const recheck=async()=>{if(checking||!viewer.open||document.visibilityState==='hidden')return;checking=true;const current=version;try{await confirm(ids[index]);}catch(error){if(isCurrent(current)&&error.code!=='ACADEMY_STALE')closeDenied(error);}finally{checking=false;}};
   const visibility=()=>{if(document.visibilityState==='visible')recheck();};
   const interval=setInterval(recheck,15000);window.addEventListener('focus',recheck);document.addEventListener('visibilitychange',visibility);
   stop=()=>{clearInterval(interval);window.removeEventListener('focus',recheck);document.removeEventListener('visibilitychange',visibility);};
   viewer.addEventListener('close',()=>{version++;stop?.();modal=null;if(!disposed&&trigger.isConnected)trigger.focus();},{once:true});
   viewer.querySelector('[data-inspect-prev]').onclick=()=>showImage(Math.max(0,index-1));viewer.querySelector('[data-inspect-next]').onclick=()=>showImage(Math.min(ids.length-1,index+1));
   viewer.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'&&index>0){e.preventDefault();showImage(index-1);}if(e.key==='ArrowRight'&&index<ids.length-1){e.preventDefault();showImage(index+1);}});
   await showImage(index);
  });
 }
 return {hydrate,clear,bindInspection};
}
