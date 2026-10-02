import {prepareProductImage} from './product-image.js?v=approved-20261002-1';
import {academyErrorMessage} from './academy-errors.js?v=academy-audit-1';

// The student view and the unsaved Admin preview share the same markup.
export function createAnnouncementView({esc,date,photo,safeHref,link}){
 return {
  card:(a,image)=>`<article class="ap-card ap-announcement ${a.read?'is-read':'is-unread'} ${a.important?'is-important':''}">${image??(a.thumbnail_id?photo(a.thumbnail_id,a.title):'')}<div class="ap-card-content"><p class="ap-category">${a.important?'<strong class="ap-importance">Important</strong> ':''}${date(a.publish_at)} <span class="ap-read-state">${a.read?'Read':'Unread'}</span></p><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p><button type="button" class="ap-button secondary small" data-announcement="${esc(a.id||'preview')}">Read announcement →</button></div></article>`,
  body:(a,image)=>`${image??(a.thumbnail_id?photo(a.thumbnail_id,a.title):'')}<div class="ap-copy">${esc(a.content)}</div>${safeHref(a.cta_url)?link(a.cta||'Learn more',safeHref(a.cta_url),true):''}`,
 };
}

export function bindAnnouncementPreview({form,record,view,dialog,hydrate,esc,registerCleanup,upcoming=false}){
 const trigger=document.createElement('button');trigger.type='button';trigger.className='ap-button secondary';trigger.textContent='Preview';
 form.querySelector('button[type=submit]').before(trigger);
 let disposed=false,active=null,photoUrl=null;
 const release=()=>{if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;};
 registerCleanup(()=>{disposed=true;active?.close();release();});
 trigger.onclick=async()=>{
  if(active?.open)return;
  const a={...record,read:false};
  // Read controls directly: a saved record awaiting a photo retry has disabled
  // text fields, which FormData would otherwise omit.
  for(const name of (upcoming?['title','description','products','schedule','starts_at','cta','inquiry_url']:['title','summary','content','publish_at','cta','cta_url']))a[name]=form.elements[name].value;
  if(upcoming){a.products=a.products.split('\n').map(s=>s.trim()).filter(Boolean);a.starts_at=a.starts_at?new Date(a.starts_at).toISOString():null;}
  a.title=a.title.trim()||(upcoming?'Untitled upcoming class':'Untitled announcement');
  a.publish_at=a.publish_at?new Date(a.publish_at).toISOString():new Date().toISOString();
  if(!upcoming&&form.elements.important)a.important=form.elements.important.checked;
  const file=form.elements.photo.files[0];
  trigger.disabled=true;trigger.textContent='Preparing preview…';form.querySelector('[data-preview-error]')?.remove();
  try{
   const prepared=file?await prepareProductImage(file):null;
   if(disposed||!form.isConnected)return;
   if(prepared)photoUrl=URL.createObjectURL(prepared);
   const image=photoUrl?`<img class="ap-photo" src="${esc(photoUrl)}" alt="${esc(a.title)}">`:undefined;
   active=dialog(upcoming?'Upcoming class preview':'Announcement preview','<p class="ap-muted">Only you can see this preview. Changes here have not been saved or published.</p><div class="ap-actions" role="group" aria-label="Preview view"><button type="button" class="ap-button" data-preview-view="card" aria-pressed="true">Student card</button><button type="button" class="ap-button secondary" data-preview-view="full" aria-pressed="false">Full announcement</button></div><div class="ap-preview-content" data-preview-content></div><div class="ap-actions"><button type="button" class="ap-button secondary" data-preview-back>Back to editing</button></div>');
   const modal=active,host=modal.querySelector('[data-preview-content]');
   modal.classList.add('ap-announcement-preview');if(upcoming)modal.querySelector('[aria-label="Preview view"]').remove();
   const show=mode=>{
    host.innerHTML=upcoming?view.card(a,image):mode==='card'?view.card(a,image):`<h3>${esc(a.title)}</h3>${view.body(a,image)}`;
    modal.querySelectorAll('[data-preview-view]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.previewView===mode));b.classList.toggle('secondary',b.dataset.previewView!==mode);});
    const read=host.querySelector('[data-announcement]');if(read)read.onclick=()=>{show('full');modal.querySelector('[data-preview-view="full"]').focus();};
    // Trying the CTA must preserve the unsaved editor in this tab.
    host.querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer';});
    hydrate(host);
   };
   modal.querySelectorAll('[data-preview-view]').forEach(b=>b.onclick=()=>show(b.dataset.previewView));
   modal.querySelector('[data-preview-back]').onclick=()=>modal.close();
   modal.addEventListener('close',()=>{release();active=null;if(!disposed&&trigger.isConnected)trigger.focus();},{once:true});
   show('card');
  }catch(error){
   release();if(disposed||!form.isConnected)return;
   const message=document.createElement('p');message.dataset.previewError='';message.role='alert';message.className='ap-field-error';message.tabIndex=-1;message.textContent=academyErrorMessage(error);trigger.before(message);message.focus();
  }finally{trigger.disabled=false;trigger.textContent='Preview';}
 };
}

export function createUpcomingView({esc,date,photo,safeHref,link}){
 const inquiryHref=c=>{const href=safeHref(c.inquiry_url);if(!href)return '';try{const url=new URL(href,location.origin);if([location.origin,'https://thelittlebakerkitchen.com','https://www.thelittlebakerkitchen.com'].includes(url.origin)&&/^\/contact(?:us\.html|\/?)$/.test(url.pathname)){if(c.id)url.searchParams.set('academy_class',c.id);url.searchParams.set('title',c.title);}return url.href;}catch{return href;}};
 return {card:(c,image)=>`<article class="ap-card ap-upcoming-card">${image??(c.thumbnail_id?photo(c.thumbnail_id,c.title):'')}<div class="ap-card-content"><p class="ap-schedule"><span>When</span><strong>${esc(c.schedule||date(c.starts_at)||'Schedule to be announced')}</strong></p><h3>${esc(c.title)}</h3><p class="ap-muted">${esc(c.description)}</p>${c.products.length?`<p class="ap-small"><strong>What you will make</strong></p><ul class="ap-product-list">${c.products.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:''}${inquiryHref(c)?link(c.cta||'Inquire about this class',inquiryHref(c),true):''}</div></article>`};
}
export function bindUpcomingPreview(config){bindAnnouncementPreview({...config,upcoming:true});}
