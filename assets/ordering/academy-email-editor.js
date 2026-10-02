import {academyEmailLayouts,academyEmailUrl} from './academy-email-layouts.js?v=academy-visual-email-1';
import {uploadNewsletterImage,newsletterImageAccept} from './newsletter-image.js?v=approved-20261002-1';

const fresh=()=>({layout:'invitation',preheader:'',eyebrow:'TLB Academy',headline:'',intro:'',hero_url:'',hero_alt:'',cta_label:'Open Academy',cta_url:'https://thelittlebakerkitchen.com/academy/dashboard',items:[]});
export function mountAcademyEmailEditor(form,{esc,registerCleanup,renderPreview},kind){
 let content=fresh(),disposed=false,busy=false,timer,revision=0;
 const workspace=document.createElement('div');workspace.className='ap-email-workspace';
 form.before(workspace);workspace.append(form);form.classList.add('ap-visual-email-form');
 const preview=document.createElement('aside');preview.className='ap-email-live';preview.setAttribute('aria-label','Live email preview');workspace.append(preview);
 preview.innerHTML='<h3>Live preview</h3><div data-live-email-preview></div>';
 const previewHost=preview.querySelector('[data-live-email-preview]');
 const before=document.createElement('section'),after=document.createElement('section');
 before.className=after.className='ap-email-fields';before.dataset.visualFields='';after.dataset.visualFields='';
 const message=form.elements.body.closest('label');message.before(before);message.after(after);
 form.elements.subject.maxLength=160;form.elements.body.maxLength=10000;form.elements.body.rows=8;
 const payload=()=>({kind,subject:form.elements.subject.value,body:form.elements.body.value,email_content:structuredClone(content)});
 const refresh=()=>{if(disposed)return;clearTimeout(timer);renderPreview(previewHost,payload());};
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(refresh,180);};
 const field=(key,label,value='',max=200,type='text')=>`<label>${label}<input data-email-field="${key}" type="${type}" value="${esc(value)}" maxlength="${max}"${type==='url'?' placeholder="https://…"':''}></label>`;
 const area=(key,label,value='',max=2000)=>`<label>${label}<textarea data-email-field="${key}" rows="3" maxlength="${max}">${esc(value)}</textarea></label>`;
 const photo=(key,label,src,altKey,alt)=>`<div class="ap-email-photo" data-email-photo="${key}"><div class="ap-email-photo-top"><strong>${label}</strong><span>JPG, PNG, WebP or HEIC · up to 25 MB</span></div><div class="ap-email-photo-row"><img data-photo-thumbnail alt="${esc(alt||'Selected email photo')}" hidden><div><button type="button" class="ap-button secondary" data-email-upload="${key}">Upload ${label.toLowerCase()}</button><input type="file" data-email-file="${key}" accept="${newsletterImageAccept}" aria-label="Choose ${label.toLowerCase()}" hidden><button type="button" class="ap-button secondary small" data-email-clear="${key}" hidden>Remove photo</button></div></div><details><summary>Use a photo link</summary>${field(key,'Photo link · HTTPS',src,2048,'url')}</details>${field(altKey,'Photo description',alt,300)}<p class="ap-small ap-muted" data-photo-status role="status"></p></div>`;
 const value=key=>key.startsWith('items.')?content.items[Number(key.split('.')[1])]?.[key.split('.')[2]]:content[key];
 const set=(key,v)=>{if(key.startsWith('items.')){const [,i,k]=key.split('.');if(content.items[Number(i)])content.items[Number(i)][k]=v;}else content[key]=v;};
 function thumbnails(){
  for(const box of form.querySelectorAll('[data-email-photo]')){
   const key=box.dataset.emailPhoto,url=academyEmailUrl(value(key)),img=box.querySelector('img');
   if(url){if(img.getAttribute('src')!==url)img.src=url;img.hidden=false;}else{img.removeAttribute('src');img.hidden=true;}
   box.querySelector('[data-email-clear]').hidden=!value(key);
   const altKey=key==='hero_url'?'hero_alt':key.replace(/image_url$/,'alt');
   box.querySelector(`[data-email-field="${altKey}"]`).required=Boolean(value(key));
   img.alt=value(altKey)||'Selected email photo';
  }
 }
 function render(){
  before.innerHTML=`<div><h3>Email design</h3><p class="ap-small ap-muted">Choose a layout, then add your words and photographs.</p><div class="ap-email-layouts" role="group" aria-label="Email layout">${academyEmailLayouts.map(l=>`<button type="button" class="ap-email-layout" data-email-layout="${l.id}" aria-pressed="${content.layout===l.id}"><span class="ap-email-layout-art ap-art-${l.id}" aria-hidden="true"><i></i><b></b><em></em></span><strong>${l.name}</strong><span>${l.description}</span></button>`).join('')}</div></div>${field('preheader','Inbox preview text',content.preheader,200)}${field('eyebrow','Small heading',content.eyebrow,100)}${field('headline','Headline',content.headline,180)}${area('intro','Introduction',content.intro)}${photo('hero_url','Main photo',content.hero_url,'hero_alt',content.hero_alt)}<p class="ap-small ap-muted">Email photos are public so recipients can view them. Large photos are resized for email.</p>`;
  after.innerHTML=`<section class="ap-email-highlights"><h3>Class highlights</h3><p class="ap-small ap-muted">Add up to four cards for classes, bakes or news.</p><div data-email-items>${content.items.map((item,i)=>`<section class="ap-email-highlight" data-email-item="${i}"><div class="ap-email-highlight-head"><h4>Highlight ${i+1}</h4><div class="ap-actions"><button type="button" class="ap-button secondary small" data-email-up="${i}" aria-label="Move highlight ${i+1} up" ${i===0?'disabled':''}>↑</button><button type="button" class="ap-button secondary small" data-email-remove="${i}">Remove highlight</button></div></div>${field(`items.${i}.title`,'Highlight title',item.title,160)}${photo(`items.${i}.image_url`,'Highlight photo',item.image_url,`items.${i}.alt`,item.alt)}${area(`items.${i}.description`,'Description',item.description,1000)}</section>`).join('')}</div><button type="button" class="ap-button secondary" data-email-add ${content.items.length===4?'disabled':''}>Add highlight</button></section><section class="ap-email-cta"><h3>Email button</h3>${field('cta_label','Button label',content.cta_label,100)}${field('cta_url','Button link · HTTPS',content.cta_url,2048,'url')}</section>`;
  after.querySelectorAll('[data-email-field$=".title"]').forEach(e=>e.required=true);thumbnails();refresh();
 }
 function validate(){
  if(busy)throw Error('Wait for the photo upload to finish.');
  for(const e of form.querySelectorAll('[data-email-field]')){
   e.setCustomValidity('');
   if(e.type==='url'&&e.value&&!academyEmailUrl(e.value))e.setCustomValidity('Use a full HTTPS link without a username or password.');
  }
  const label=after.querySelector('[data-email-field="cta_label"]');label.required=Boolean(content.cta_url);
  if(!form.reportValidity())throw Error('Check the highlighted email field.');
  return payload();
 }
 const lock=value=>{busy=value;form.dataset.emailUploadBusy=String(value);form.setAttribute('aria-busy',String(value));
  for(const b of form.querySelectorAll('button,select')){if(value){b.dataset.emailWasDisabled=String(b.disabled);b.disabled=true;}else if('emailWasDisabled' in b.dataset){b.disabled=b.dataset.emailWasDisabled==='true';delete b.dataset.emailWasDisabled;}}
 };
 const input=e=>{if(e.target.dataset.emailField){e.target.setCustomValidity('');set(e.target.dataset.emailField,e.target.value);thumbnails();}schedule();};
 const click=e=>{
  const b=e.target.closest('button');if(!b||busy)return;
  if(b.dataset.emailLayout){content.layout=b.dataset.emailLayout;before.querySelectorAll('[data-email-layout]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));refresh();}
  if(b.hasAttribute('data-email-add')&&content.items.length<4){content.items.push({title:'',image_url:'',alt:'',description:''});render();after.querySelectorAll('[data-email-item]')[content.items.length-1].querySelector('input').focus();}
  if(b.hasAttribute('data-email-remove')){content.items.splice(Number(b.dataset.emailRemove),1);revision++;render();after.querySelector('[data-email-add]').focus();}
  if(b.hasAttribute('data-email-up')){const i=Number(b.dataset.emailUp);if(i>0){[content.items[i-1],content.items[i]]=[content.items[i],content.items[i-1]];revision++;render();after.querySelector(`[data-email-item="${i-1}"] input`).focus();}}
  if(b.dataset.emailUpload)form.querySelector(`[data-email-file="${b.dataset.emailUpload}"]`).click();
  if(b.dataset.emailClear){const key=b.dataset.emailClear;set(key,'');form.querySelector(`[data-email-field="${key}"]`).value='';thumbnails();refresh();}
 };
 const change=async e=>{
  const input=e.target,key=input.dataset.emailFile;if(!key||busy)return;const file=input.files?.[0];input.value='';if(!file)return;
  const box=input.closest('[data-email-photo]'),status=box.querySelector('[data-photo-status]'),version=revision;status.classList.remove('ap-field-error');lock(true);
  try{const url=await uploadNewsletterImage(file,text=>{if(!disposed)status.textContent=text;});if(disposed||version!==revision||!box.isConnected)return;
   set(key,url);box.querySelector(`[data-email-field="${key}"]`).value=url;thumbnails();refresh();status.textContent='Photo added. Add a description of what it shows.';
  }catch(error){if(!disposed){status.textContent=error.message;status.classList.add('ap-field-error');}}
  finally{if(!disposed){lock(false);box.querySelector('[data-email-upload]')?.focus({preventScroll:true});}}
 };
 const submit=e=>{if(busy){e.preventDefault();e.stopImmediatePropagation();}};
 form.addEventListener('input',input);form.addEventListener('click',click);form.addEventListener('change',change);form.addEventListener('submit',submit,true);
 registerCleanup(()=>{disposed=true;clearTimeout(timer);form.removeEventListener('input',input);form.removeEventListener('click',click);form.removeEventListener('change',change);form.removeEventListener('submit',submit,true);});
 render();return {current:payload,validate,refresh,isBusy:()=>busy,hasContent:()=>Boolean(content.hero_url||content.intro||content.headline||content.preheader||content.items.length),set(value){if(busy)return;revision++;content={...fresh(),...(value||{}),items:structuredClone(value?.items||[])};render();}};
}
