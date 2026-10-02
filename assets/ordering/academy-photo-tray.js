// Selected files and preview URLs live only in this page's memory. The same File
// objects are retained for idempotent retries. Callers may keep an explicit,
// short-lived per-account draft; this component never persists photos remotely.
export function photoTrayMarkup({label='Photos (optional)',required=false,accept},esc){
 return `<fieldset class="ap-photo-tray"><legend>${esc(label)}</legend><div class="ap-photo-choices"><label class="ap-file-choice">Choose photos<input name="photos" type="file" accept="${esc(accept)}" multiple aria-label="${esc(label)}" ${required?'aria-required="true"':''}></label><label class="ap-file-choice ap-camera-choice">Take a photo<input name="camera" type="file" accept="image/*" capture="environment" aria-label="Take a photo"></label></div><p class="ap-small ap-muted">Up to 8 photos · 25 MB each</p><details class="ap-photo-help"><summary>About photo formats</summary><p class="ap-small ap-muted">Photos are optimized when possible. If conversion is unavailable, valid PNG, JPEG or HEIC originals can be used. Originals may include camera metadata.</p></details><p class="ap-small" data-photo-count role="status">0 of 8 photos selected</p><div class="ap-photo-previews" data-photo-previews></div><p class="ap-field-error" data-photo-error role="alert" hidden></p></fieldset>`;
}

export function mountPhotoTray(form,{preparePhoto,required=false,esc,onChange=()=>{}}){
 const host=form.querySelector('.ap-photo-tray'),picker=form.elements.photos,camera=form.elements.camera;
 const error=host.querySelector('[data-photo-error]'),errorId='ap-photos-'+crypto.randomUUID();error.id=errorId;
 for(const input of [picker,camera])input.setAttribute('aria-describedby',errorId);
 let entries=[],locked=false,disposed=false,selectionError='';
 const fail=message=>{selectionError=message;error.hidden=!message;error.textContent=message;picker.setAttribute('aria-invalid',String(Boolean(message)));};
 const draw=()=>{
  if(disposed)return;
  host.querySelector('[data-photo-count]').textContent=`${entries.length} of 8 photos selected`;
  const previews=host.querySelector('[data-photo-previews]');
  const focusedPhoto=previews.contains(document.activeElement)?document.activeElement.dataset.removePhoto:null;
  previews.innerHTML=entries.map((entry,index)=>`<div class="ap-photo-preview" data-photo-entry="${entry.id}">${entry.url&&!entry.previewUnavailable?`<img src="${entry.url}" data-photo-preview="${entry.id}" alt="Selected photo ${index+1}: ${esc(entry.file.name)}">`:`<div class="ap-photo-pending" role="status">${entry.previewUnavailable?'Photo selected. Preview unavailable on this device.':entry.error?'Preview unavailable':'Preparing preview…'}</div>`}<p>${esc(entry.file.name)}</p>${entry.original?'<p class="ap-small ap-muted">Using the original photo. Camera metadata may remain.</p>':''}${entry.error?`<p class="ap-field-error">${esc(entry.error)}</p>`:''}<div class="ap-photo-upload-state" data-photo-upload-state ${entry.upload?'':'hidden'}>${entry.upload?uploadMarkup(entry):''}</div><button type="button" class="ap-button secondary small" data-remove-photo="${entry.id}" ${locked?'disabled':''} aria-label="Remove photo ${index+1}: ${esc(entry.file.name)}">Remove</button></div>`).join('');
  previews.querySelectorAll('[data-photo-preview]').forEach(img=>img.onerror=()=>{const entry=entries.find(e=>e.id===img.dataset.photoPreview);if(!entry||disposed)return;entry.previewUnavailable=true;draw();});
  previews.querySelectorAll('[data-remove-photo]').forEach(button=>button.onclick=()=>{
   if(locked)return;const index=entries.findIndex(e=>e.id===button.dataset.removePhoto),entry=entries[index];
   if(entry?.url)URL.revokeObjectURL(entry.url);entries.splice(index,1);fail('');draw();onChange();
   (previews.querySelectorAll('button')[Math.min(index,entries.length-1)]||picker).focus();
  });
  if(focusedPhoto)previews.querySelector(`[data-remove-photo="${focusedPhoto}"]`)?.focus({preventScroll:true});
 };
 const uploadMarkup=entry=>`<progress max="100" value="${entry.upload.progress||0}" aria-label="Upload progress for ${esc(entry.file.name)}" ${entry.upload.state==='error'?'hidden':''}></progress><span class="${entry.upload.state==='error'?'ap-field-error':''}" role="status">${esc(entry.upload.message)}</span>`;
 const addFiles=added=>{
  if(locked||disposed)return;
  if(!added.length)return;if(entries.length+added.length>8){fail('Choose up to eight photos. Remove a photo before adding more.');return;}
  fail('');
  for(const file of added){
   const entry={id:crypto.randomUUID(),file,url:'',error:''};entries.push(entry);
   entry.ready=preparePhoto(file).then(prepared=>{
    if(disposed||!entries.includes(entry))return;
    entry.original=prepared.original;entry.url=URL.createObjectURL(prepared.file);draw();
   }).catch(cause=>{if(disposed||!entries.includes(entry))return;entry.error=cause.message||'This photo could not be opened.';draw();});
  }
  draw();onChange();
 };
 const add=input=>{const added=[...input.files];input.value='';addFiles(added);};
 const pickerChange=()=>add(picker),cameraChange=()=>add(camera);
 const uploadState=event=>{
  if(disposed)return;const entry=entries.find(e=>e.file===event.detail?.file);if(!entry)return;
  entry.upload={state:event.detail.state,progress:event.detail.progress,message:event.detail.message};
  const target=host.querySelector(`[data-photo-entry="${entry.id}"] [data-photo-upload-state]`);
  if(target){target.hidden=false;target.innerHTML=uploadMarkup(entry);}
 };
 picker.addEventListener('change',pickerChange);camera.addEventListener('change',cameraChange);form.addEventListener('academy:photo-upload',uploadState);
 return {
  async files(){
   if(selectionError)throw Object.assign(new Error(selectionError),{field:'photos'});
   await Promise.all(entries.map(e=>e.ready));
   const invalid=entries.find(e=>e.error);
   if(invalid)throw Object.assign(new Error('Remove or replace the photo that could not be opened. '+invalid.error),{field:'photos'});
   if(required&&!entries.length)throw Object.assign(new Error('Add at least one photo.'),{field:'photos'});
   return entries.map(e=>e.file);
  },
  lock(){locked=true;host.querySelectorAll('input,button').forEach(el=>el.disabled=true);},
  unlock(){locked=false;host.querySelectorAll('input,button').forEach(el=>el.disabled=false);for(const e of entries)e.upload=null;draw();},
  snapshot(){return entries.map(e=>e.file);},
  restore(files=[]){if(disposed)return;for(const e of entries)if(e.url)URL.revokeObjectURL(e.url);entries=[];locked=false;host.querySelectorAll('input,button').forEach(el=>el.disabled=false);fail('');addFiles(files.slice(0,8));},
  reset(){for(const e of entries)if(e.url)URL.revokeObjectURL(e.url);entries=[];locked=false;host.querySelectorAll('input,button').forEach(el=>el.disabled=false);fail('');draw();onChange();},
  dispose(){disposed=true;picker.removeEventListener('change',pickerChange);camera.removeEventListener('change',cameraChange);form.removeEventListener('academy:photo-upload',uploadState);for(const e of entries)if(e.url)URL.revokeObjectURL(e.url);entries=[];},
 };
}
