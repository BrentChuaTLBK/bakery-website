import {esc,plain,classLink,orderedClasses,dateLabel,enquiryUrl,instagramUrl,missingContent} from './academy-model.js';

export function academyPhoto(photo,images,label,{hero=false,placeholder=false}={}){
 const image=images[photo?.asset_id];
 if(!image?.url)return placeholder?`<div class="academy-placeholder" role="img" aria-label="${esc(label)} photo pending"><img src="assets/img/brands/Hatblack.png" alt=""><span>${esc(label)}</span><small>Photo to be added</small></div>`:'';
 return `<img class="academy-photo" data-academy-asset="${esc(photo.asset_id)}" src="${esc(image.url)}" alt="${esc(photo.alt||label)}" width="${image.width}" height="${image.height}" style="object-position:${Number(photo.focal_x??50)}% ${Number(photo.focal_y??50)}%" ${hero?'fetchpriority="high"':'loading="lazy"'} decoding="async">`;
}
function enquiry(settings){const href=enquiryUrl(settings.enquiry_url);return href?`<section class="academy-enquiry"><div><h2>${esc(settings.enquiry_heading||'Your next sweet adventure?')}</h2>${settings.enquiry_text?`<p>${plain(settings.enquiry_text)}</p>`:''}</div><a class="academy-button" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Enquire about classes <span aria-hidden="true">↗</span></a></section>`:'';}
let instagramScript;
export function bindAcademyInteractions(root,{content,images,batchId='',onBatch}={}){
 let active=[],index=0,opener=null;
 const dialog=document.createElement('dialog');dialog.className='academy-lightbox';dialog.setAttribute('aria-label','Academy photo gallery');
 dialog.innerHTML='<button type="button" class="academy-light-close" aria-label="Close photo gallery">Close ×</button><div class="academy-light-stage"><button type="button" data-light-step="-1" aria-label="Previous photo">‹</button><img alt=""><button type="button" data-light-step="1" aria-label="Next photo">›</button></div><p data-light-caption></p><p data-light-count aria-live="polite"></p>';
 root.append(dialog);
 function show(){const p=active[index],image=images[p.asset_id],element=dialog.querySelector('img');element.dataset.academyAsset=p.asset_id;element.src=image?.url||'';element.alt=p.alt||p.caption||content.title;dialog.querySelector('[data-light-caption]').textContent=p.caption||'';dialog.querySelector('[data-light-count]').textContent=`${index+1} of ${active.length}`;}
 dialog.querySelector('.academy-light-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>opener?.focus());
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();const step=e.target.closest('[data-light-step]');if(step){index=(index+Number(step.dataset.lightStep)+active.length)%active.length;show();}});
 dialog.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();index=(index+(e.key==='ArrowLeft'?-1:1)+active.length)%active.length;show();}});
 let startX=null;dialog.addEventListener('pointerdown',e=>{startX=e.clientX;});dialog.addEventListener('pointerup',e=>{if(startX!==null&&Math.abs(e.clientX-startX)>50){index=(index+(e.clientX<startX?1:-1)+active.length)%active.length;show();}startX=null;});
 root.onclick=async e=>{
  const batch=e.target.closest('[data-academy-batch]');if(batch){onBatch?.(batch.dataset.academyBatch);return;}
  const button=e.target.closest('[data-academy-gallery]');
  if(button){const key=button.dataset.academyGallery;const item=key.startsWith('creation-')?content.creations.find(c=>'creation-'+c.id===key):content.batches.find(b=>'batch-'+b.id===key);active=(item?.photos||[]).filter(p=>!key.startsWith('creation-')||!batchId||!p.batch_id||p.batch_id===batchId);if(!active.length)return;index=Number(button.dataset.photoIndex);opener=button;show();dialog.showModal();return;}
  const video=e.target.closest('[data-instagram-load]');if(!video)return;
  const card=video.closest('[data-instagram-card]'),status=card.querySelector('[data-instagram-status]'),slot=card.querySelector('[data-instagram-embed]');video.disabled=true;status.textContent='Loading from Instagram…';
  try{
   const url=instagramUrl(video.dataset.instagramLoad);slot.innerHTML=`<blockquote class="instagram-media" data-instgrm-permalink="${esc(url)}" data-instgrm-version="14"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Watch on Instagram</a></blockquote>`;
   if(!instagramScript)instagramScript=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://www.instagram.com/embed.js';s.async=true;s.onload=resolve;s.onerror=()=>{instagramScript=null;s.remove();reject(Error());};document.head.append(s);});
   await instagramScript;window.instgrm?.Embeds?.process();status.textContent='If the video does not load, use Watch on Instagram.';video.hidden=true;
  }catch{status.textContent='Instagram could not load here. Use Watch on Instagram below.';video.disabled=false;}
 };
}
