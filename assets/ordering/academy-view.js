import {esc,plain,classLink,orderedClasses,dateLabel,enquiryUrl,missingContent} from './academy-model.js';

export function academyPhoto(photo,images,label,{hero=false,placeholder=false,deferred=false}={}){
 const image=images[photo?.asset_id];
 if(!image?.url&&deferred&&photo?.asset_id)return `<img class="academy-photo" data-academy-asset="${esc(photo.asset_id)}" data-academy-pending src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E" alt="${esc(photo.alt||label)}" width="800" height="800" style="object-position:${Number(photo.focal_x??50)}% ${Number(photo.focal_y??50)}%" loading="lazy" decoding="async">`;
 if(!image?.url)return placeholder?`<div class="academy-placeholder" role="img" aria-label="${esc(label)} photo pending"><img src="assets/img/brands/Hatblack.png" alt=""><span>${esc(label)}</span><small>Photo to be added</small></div>`:'';
 return `<img class="academy-photo" data-academy-asset="${esc(photo.asset_id)}" src="${esc(image.url)}" alt="${esc(photo.alt||label)}" width="${image.width}" height="${image.height}" style="object-position:${Number(photo.focal_x??50)}% ${Number(photo.focal_y??50)}%" ${hero?'fetchpriority="high"':'loading="lazy"'} decoding="async">`;
}
function enquiry(settings){const href=enquiryUrl(settings.enquiry_url);return href?`<section class="academy-enquiry"><div><h2>${esc(settings.enquiry_heading||'Your next sweet adventure?')}</h2>${settings.enquiry_text?`<p>${plain(settings.enquiry_text)}</p>`:''}</div><a class="academy-button" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Enquire about classes <span aria-hidden="true">↗</span></a></section>`:'';}
export function bindAcademyInteractions(root,{content,images,batchId='',onBatch,onMore,loadPhoto}={}){
 let active=[],index=0,opener=null,requestId=0;
 const dialog=document.createElement('dialog');dialog.className='academy-lightbox';dialog.setAttribute('aria-label','Academy photo gallery');
 dialog.innerHTML='<button type="button" class="academy-light-close" aria-label="Close photo gallery">Close ×</button><div class="academy-light-stage"><button type="button" data-light-step="-1" aria-label="Previous photo">‹</button><img alt="" draggable="false"><button type="button" data-light-step="1" aria-label="Next photo">›</button></div><p data-light-status role="status"></p><p data-light-caption></p><p data-light-count aria-live="polite"></p>';
 root.append(dialog);
 async function show(force=false){
  const id=++requestId,p=active[index],element=dialog.querySelector('img'),status=dialog.querySelector('[data-light-status]');
  element.dataset.academyAsset=p.asset_id;element.removeAttribute('src');element.alt=p.alt||p.caption||content.title;element.hidden=true;
  dialog.querySelector('[data-light-caption]').textContent=p.caption||'';dialog.querySelector('[data-light-count]').textContent=`${index+1} of ${active.length}`;
  status.textContent='Loading photo…';
  element.onload=()=>{if(id===requestId)status.textContent='';};
  element.onerror=()=>{if(id===requestId)status.innerHTML='This photo could not load. <button type="button" data-light-retry>Try again</button>';};
  try{const image=loadPhoto?await loadPhoto(p,{force}):images[p.asset_id];if(id!==requestId||!dialog.isConnected)return;if(!image?.url)throw Error('Unavailable');element.src=image.url;element.hidden=false;if(element.complete&&element.naturalWidth)status.textContent='';}
  catch{if(id===requestId&&dialog.isConnected){status.innerHTML='This photo could not load. <button type="button" data-light-retry>Try again</button>';}}
 }
 dialog.querySelector('.academy-light-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{requestId++;opener?.focus({preventScroll:true});});
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();if(e.target.closest('[data-light-retry]'))show(true);const step=e.target.closest('[data-light-step]');if(step){index=(index+Number(step.dataset.lightStep)+active.length)%active.length;show();}});
 dialog.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();index=(index+(e.key==='ArrowLeft'?-1:1)+active.length)%active.length;show();}});
 const stage=dialog.querySelector('.academy-light-stage');let swipe=null;
 stage.addEventListener('pointerdown',e=>{if(e.target.closest('button')||!e.isPrimary||e.button!==0)return;swipe={x:e.clientX,y:e.clientY,id:e.pointerId};stage.setPointerCapture(e.pointerId);});
 stage.addEventListener('pointerup',e=>{if(!swipe||e.pointerId!==swipe.id)return;const dx=e.clientX-swipe.x,dy=e.clientY-swipe.y;swipe=null;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.25){index=(index+(dx<0?1:-1)+active.length)%active.length;show();}});
 stage.addEventListener('pointercancel',()=>swipe=null);
 root.onclick=e=>{
  if(e.target.closest('[data-academy-top]')){root.querySelector('h1')?.focus({preventScroll:true});window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;}
  const more=e.target.closest('[data-academy-more]');
  if(more){const grid=[...root.querySelectorAll('[data-academy-thumbnails]')].find(g=>g.dataset.academyThumbnails===more.dataset.academyMore);if(!grid)return;const hidden=[...grid.querySelectorAll('figure[hidden]')];hidden.slice(0,24).forEach(f=>f.hidden=false);const remaining=Math.max(0,hidden.length-24),total=grid.children.length;more.parentElement.querySelector('[data-academy-visible-count]').textContent=`Showing ${total-remaining} of ${total}`;if(!remaining){more.hidden=true;grid.querySelector('figure:last-child button')?.focus({preventScroll:true});}onMore?.(grid);return;}
  const batch=e.target.closest('[data-academy-batch]');if(batch){onBatch?.(batch.dataset.academyBatch);return;}
  const button=e.target.closest('[data-academy-gallery]');
  if(button){const key=button.dataset.academyGallery;const item=key.startsWith('creation-')?content.creations.find(c=>'creation-'+c.id===key):content.batches.find(b=>'batch-'+b.id===key);active=(item?.photos||[]).filter(p=>!key.startsWith('creation-')||!batchId||!p.batch_id||p.batch_id===batchId);if(!active.length)return;index=Number(button.dataset.photoIndex);opener=button;show();dialog.showModal();return;}

 };
}
