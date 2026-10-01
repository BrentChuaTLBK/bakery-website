import {prepareProductImage} from './product-image.js';
import {academyErrorMessage} from './academy-errors.js?v=academy-audit-1';

// The student view and the unsaved Admin preview share the same markup.
export function createAnnouncementView({esc,date,photo,safeHref,link}){
 return {
  card:a=>`<article class="ap-card ap-announcement ${a.read?'is-read':'is-unread'}"><div class="ap-card-content"><p class="ap-category">${date(a.publish_at)} <span class="ap-read-state">${a.read?'Read':'Unread'}</span></p><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p><button type="button" class="ap-button secondary small" data-announcement="${esc(a.id||'preview')}">Read announcement →</button></div></article>`,
  body:(a,image)=>`${image??(a.thumbnail_id?photo(a.thumbnail_id,a.title):'')}<div class="ap-copy">${esc(a.content)}</div>${safeHref(a.cta_url)?link(a.cta||'Learn more',safeHref(a.cta_url),true):''}`,
 };
}

export function bindAnnouncementPreview({form,record,view,dialog,hydrate,esc,registerCleanup}){
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
  for(const name of ['title','summary','content','publish_at','cta','cta_url'])a[name]=form.elements[name].value;
  a.title=a.title.trim()||'Untitled announcement';
  a.publish_at=a.publish_at?new Date(a.publish_at).toISOString():new Date().toISOString();
  const file=form.elements.photo.files[0];
  trigger.disabled=true;trigger.textContent='Preparing preview…';form.querySelector('[data-preview-error]')?.remove();
  try{
   const prepared=file?await prepareProductImage(file):null;
   if(disposed||!form.isConnected)return;
   if(prepared)photoUrl=URL.createObjectURL(prepared);
   const image=photoUrl?`<img class="ap-photo" src="${esc(photoUrl)}" alt="${esc(a.title)}">`:undefined;
   active=dialog('Announcement preview','<p class="ap-muted">Only you can see this preview. Changes here have not been saved or published.</p><div class="ap-actions" role="group" aria-label="Preview view"><button type="button" class="ap-button" data-preview-view="card" aria-pressed="true">Student card</button><button type="button" class="ap-button secondary" data-preview-view="full" aria-pressed="false">Full announcement</button></div><div class="ap-preview-content" data-preview-content></div><div class="ap-actions"><button type="button" class="ap-button secondary" data-preview-back>Back to editing</button></div>');
   const modal=active,host=modal.querySelector('[data-preview-content]');
   modal.classList.add('ap-announcement-preview');
   const show=mode=>{
    host.innerHTML=mode==='card'?view.card(a):`<h3>${esc(a.title)}</h3>${view.body(a,image)}`;
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
