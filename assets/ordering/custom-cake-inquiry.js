import {config} from './config.js';
import {prepareGalleryImage, galleryImageAccept} from './gallery-image.js?v=approved-20261002-1';
import {imageExtension} from './image-format.js?v=approved-20261002-1';

const dialog=document.createElement('dialog');
dialog.className='cake-inquiry';
dialog.setAttribute('aria-labelledby','cake-inquiry-title');
dialog.innerHTML=`<div class="cake-inquiry-head"><div><p class="cake-inquiry-eyebrow">Made for your celebration</p><h2 id="cake-inquiry-title">Tell us about your cake</h2></div><button type="button" class="cake-inquiry-close" aria-label="Close cake inquiry">×</button></div>
 <p>Share your ideas with our kitchen. We’ll follow up with you about the design, availability, and price.</p>
 <form class="cake-inquiry-form">
 <fieldset><legend class="visually-hidden">Your cake inquiry</legend><div class="cake-inquiry-grid">
  <label>Your name<input name="name" autocomplete="name" maxlength="100" required></label>
  <label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required><small>We’ll copy you into the email conversation.</small></label>
  <label class="cake-inquiry-wide">Social media contact<input name="social" maxlength="250" placeholder="Instagram or Facebook · @handle or profile link" required><small>Include the platform and your handle or profile link. Enter “None” if you don’t use social media.</small></label>
  <label>Preferred date<input name="date" type="date" required><small>Subject to availability.</small></label>
  <label>Occasion<input name="occasion" maxlength="150" placeholder="Birthday, wedding, anniversary…" required></label>
  <label>Size of cake<input name="size" maxlength="150" placeholder="e.g. 8-inch, two tiers, or 20 guests" required></label>
  <label>Budget <span class="cake-inquiry-optional">(optional)</span><input name="budget" maxlength="100" placeholder="e.g. ₱3,000–₱5,000"></label>
  <label class="cake-inquiry-wide">Theme<textarea name="theme" rows="3" maxlength="2000" placeholder="Tell us about the theme, colors, and details you have in mind." required></textarea></label>
  <label class="cake-inquiry-wide">Reference photos<input name="photos" type="file" accept="${galleryImageAccept}" multiple><small>Up to 4 photos, 25 MB each. We’ll prepare smaller copies for email.</small></label>
 </div><div class="cake-inquiry-photos" aria-live="polite"></div>
 <label class="cake-inquiry-trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
 </fieldset>
 <p class="cake-inquiry-note">Your details and photos will be emailed to TLB Kitchen and copied to your email address. This is an inquiry; your booking is confirmed separately. <a href="privacy.html">Privacy policy</a></p>
 <p class="cake-inquiry-status" role="status" aria-live="polite"></p>
 <div class="cake-inquiry-actions"><button type="button" class="btn cake-inquiry-cancel">Cancel</button><button type="submit" class="btn btn-primary">Send cake inquiry</button></div>
 </form><div class="cake-inquiry-success" hidden><h3>Your inquiry is on its way</h3><p>We’ve sent your cake details and photos to TLB Kitchen and copied you into the email. Check your inbox and spam folder. You can reply to that email to continue the conversation.</p><p>Our kitchen will confirm availability, design, and pricing with you.</p><p class="cake-inquiry-reference"></p><button type="button" class="btn btn-primary cake-inquiry-done">Done</button></div>`;
document.body.append(dialog);
const form=dialog.querySelector('form'), status=dialog.querySelector('.cake-inquiry-status');
const files=form.elements.photos, submit=form.querySelector('[type=submit]');
let busy=false, accepted=false, opener=null, previousOverflow='', attempt=null, previewUrls=[];
const prepared=new WeakMap();
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value instanceof ArrayBuffer?value:new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
function setBusy(value){busy=value;form.querySelector('fieldset').disabled=value;submit.disabled=value;dialog.querySelector('.cake-inquiry-close').disabled=value;dialog.querySelector('.cake-inquiry-cancel').disabled=value;form.setAttribute('aria-busy',String(value));submit.textContent=value?'Sending your inquiry…':'Send cake inquiry';}
function releasePhotos(){previewUrls.forEach(url=>URL.revokeObjectURL(url));previewUrls=[];dialog.querySelector('.cake-inquiry-photos').replaceChildren();}
function close(){if(!busy)dialog.close();}
dialog.querySelector('.cake-inquiry-close').onclick=close;
dialog.querySelector('.cake-inquiry-cancel').onclick=close;
dialog.querySelector('.cake-inquiry-done').onclick=close;
dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
dialog.addEventListener('close',()=>{document.body.style.overflow=previousOverflow;opener?.focus();});
files.addEventListener('change',()=>{
 releasePhotos();status.textContent='';files.setCustomValidity(files.files.length>4?'Choose up to four reference photos.':'');
 for(const file of Array.from(files.files).slice(0,4)){
  const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=file.name;figure.append(caption);
  if(/^image\/(jpeg|png|webp|avif|gif|bmp)$/.test(file.type)){const photo=document.createElement('img');photo.alt='';photo.src=URL.createObjectURL(file);previewUrls.push(photo.src);figure.prepend(photo);}
  dialog.querySelector('.cake-inquiry-photos').append(figure);
 }
});
document.querySelectorAll('a[href="contactus.html"]').forEach(link=>{
 link.setAttribute('aria-haspopup','dialog');
 link.addEventListener('click',event=>{
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();opener=link;
  if(accepted){form.reset();attempt=null;accepted=false;releasePhotos();status.textContent='';form.hidden=false;dialog.querySelector('.cake-inquiry-success').hidden=true;}
  form.elements.date.min=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();
 });
});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!form.reportValidity())return;
 status.textContent='Preparing your inquiry…';setBusy(true);
 try{
  const details=Object.fromEntries(['name','email','social','date','occasion','size','budget','theme','website'].map(name=>[name,form.elements[name].value.trim()]));
  const chosen=Array.from(files.files);if(chosen.length>4)throw Error('Choose up to four reference photos.');
  const photos=[];
  for(const file of chosen){
   let photo=prepared.get(file);
   if(!photo){photo=(await prepareGalleryImage(file,{format:'webp'})).file;if(photo.size>1024*1024)throw Error('One photo is still too large for email. Please choose a smaller photo.');prepared.set(file,photo);}
   photos.push(photo);
  }
  const fingerprint=await hash(JSON.stringify({details,photos:await Promise.all(photos.map(async photo=>hash(await photo.arrayBuffer())))}));
  if(attempt?.fingerprint!==fingerprint){
   let cached;try{cached=JSON.parse(sessionStorage.getItem('tlb-cake-inquiry-attempt')||'null');}catch{}
   attempt=cached?.fingerprint===fingerprint&&/^[a-f0-9-]{36}$/i.test(cached.id)?cached:{fingerprint,id:crypto.randomUUID()};
   try{sessionStorage.setItem('tlb-cake-inquiry-attempt',JSON.stringify(attempt));}catch{}
  }
  const body=new FormData();body.set('details',JSON.stringify({...details,id:attempt.id}));photos.forEach((photo,index)=>body.append('photos',photo,`cake-reference-${index+1}.${imageExtension(photo.type)}`));
  status.textContent='Sending your cake details and photos…';
  const response=await fetch(`${config.supabaseUrl}/functions/v1/cake-inquiry`,{method:'POST',headers:{apikey:config.supabasePublishableKey},body,signal:AbortSignal.timeout(45000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok||result?.accepted!==true)throw Error(result?.error||'We could not confirm the inquiry. Wait one minute, then retry with the same details.');
  accepted=true;form.hidden=true;dialog.querySelector('.cake-inquiry-success').hidden=false;
  dialog.querySelector('.cake-inquiry-reference').textContent=`Inquiry reference: ${result.reference}`;
  dialog.querySelector('.cake-inquiry-done').focus();
 }catch(error){status.textContent=error.name==='TimeoutError'?'We could not confirm the inquiry. Wait one minute, then retry with the same details.':error.message||'Please try again in a minute.';}
 finally{setBusy(false);}
});
