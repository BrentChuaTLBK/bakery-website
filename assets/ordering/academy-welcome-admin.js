import {academyWelcomeDefaultPhoto,academyWelcomeDefaultAlt,academyWelcomeImageURL} from './academy-welcome-image.js?v=academy-approved-comparisons-1';
import {prepareAcademyPhoto} from './academy-photo-prepare.js?v=academy-approved-comparisons-1';

export async function mountWelcomeSettings(ui){
 const {api,root,draw,heading,esc,notice,formSubmit,uploadPhotos,dialog,registerCleanup,registerBeforeLeave}=ui;
 let record=await api('welcome_config'),selectedFile=null,selectionURL='',selectionTicket=0,prepared=false,resetDefault=false,uploadedId=null,busy=false,disposed=false,pendingSave=null;
 const savedURL=()=>academyWelcomeImageURL(record.photo_path)||academyWelcomeDefaultPhoto;
 const savedAlt=()=>record.photo_alt||academyWelcomeDefaultAlt;
 draw(`${heading('Academy appearance','Choose the picture visitors see before logging in.')}<form class="ap-form ap-welcome-settings"><p class="ap-banner">This picture is public. Anyone visiting the Academy welcome page can see it.</p><div class="ap-welcome-picture-grid"><div><h3>Current picture</h3><img class="ap-welcome-preview" data-current-picture src="${esc(savedURL())}" alt="${esc(savedAlt())}"></div><div><h3>Preview</h3><img class="ap-welcome-preview" data-welcome-preview src="${esc(savedURL())}" alt="${esc(savedAlt())}"></div></div><label>Choose a new picture<input type="file" name="welcome_photo" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"></label><p class="ap-small ap-muted">Use a landscape baking photo, up to 25 MB. The public picture is resized and prepared without camera metadata.</p><label>Image description<input name="photo_alt" maxlength="180" value="${esc(savedAlt())}" required></label><p class="ap-small ap-muted">Describe what is in the picture for people who use a screen reader.</p><p data-welcome-selection role="status"></p><div class="ap-upload-list"></div><div class="ap-welcome-actions"><span data-welcome-save-state role="status">Saved</span><button type="button" class="ap-button secondary" data-welcome-default>Use default picture</button><button type="button" class="ap-button secondary" data-welcome-cancel disabled>Cancel changes</button><button type="submit" class="ap-button" disabled>Save picture</button></div></form>`);
 const form=root.querySelector('.ap-welcome-settings'),preview=form.querySelector('[data-welcome-preview]'),picker=form.elements.welcome_photo,alt=form.elements.photo_alt,state=form.querySelector('[data-welcome-save-state]'),selection=form.querySelector('[data-welcome-selection]'),cancel=form.querySelector('[data-welcome-cancel]'),useDefault=form.querySelector('[data-welcome-default]'),submit=form.querySelector('[type=submit]');
 const dirty=()=>Boolean(selectedFile||resetDefault||alt.value!==savedAlt());
 const update=()=>{if(disposed)return;state.textContent=busy?'Saving…':dirty()?'Unsaved changes':'Saved';submit.disabled=busy||(!dirty())||Boolean(selectedFile&&!prepared);cancel.disabled=busy||!dirty();useDefault.disabled=busy;picker.disabled=busy;alt.disabled=busy;preview.alt=alt.value;};
 const revoke=()=>{if(selectionURL)URL.revokeObjectURL(selectionURL);selectionURL='';};
 const reset=()=>{selectionTicket++;revoke();selectedFile=null;uploadedId=null;prepared=false;resetDefault=false;pendingSave=null;picker.value='';alt.value=savedAlt();preview.src=savedURL();selection.textContent='';form.querySelector('.ap-upload-list').replaceChildren();submit.textContent='Save picture';update();};
 picker.onchange=async()=>{
  const file=picker.files[0];if(!file)return;
  const ticket=++selectionTicket;revoke();selectedFile=file;prepared=false;resetDefault=false;uploadedId=null;selection.textContent='Preparing preview…';form.querySelector('.ap-upload-list').replaceChildren();update();
  try{const result=await prepareAcademyPhoto(file,{allowOriginal:false});if(disposed||ticket!==selectionTicket)return;selectionURL=URL.createObjectURL(result.file);preview.src=selectionURL;prepared=true;selection.textContent='Picture ready to save.';}
  catch(error){if(disposed||ticket!==selectionTicket)return;selection.textContent=error.message||'This picture could not be prepared. Choose another photo.';preview.src=savedURL();}
  update();
 };
 alt.addEventListener('input',update);form.addEventListener('ap:form-complete',update);cancel.onclick=reset;
 useDefault.onclick=()=>{selectionTicket++;revoke();selectedFile=null;uploadedId=null;prepared=false;resetDefault=true;picker.value='';alt.value=academyWelcomeDefaultAlt;preview.src=academyWelcomeDefaultPhoto;selection.textContent='Default picture selected. Save to apply.';form.querySelector('.ap-upload-list').replaceChildren();update();};
 formSubmit(form,async()=>{
  if(selectedFile&&!prepared)throw Error('Wait for the picture preview, or choose another photo.');
  busy=true;update();
  try{
   if(selectedFile&&!uploadedId){const uploaded=await uploadPhotos([selectedFile],{purpose:'welcome'},form.querySelector('.ap-upload-list'));uploadedId=uploaded[0]?.id;}
   if(disposed||!form.isConnected)return;
   const payload={photo_alt:alt.value.trim(),revision:record.revision};
   if(uploadedId)payload.media_id=uploadedId;else if(resetDefault)payload.media_id=null;
   const signature=JSON.stringify(payload);if(pendingSave?.signature!==signature)pendingSave={signature,key:crypto.randomUUID()};
   const saved=await api('save_welcome_config',{...payload,idempotency_key:pendingSave.key});if(disposed)return;
   record=saved;const current=form.querySelector('[data-current-picture]');current.src=savedURL();current.alt=savedAlt();reset();notice('Academy welcome picture saved.');
  }finally{busy=false;update();}
 });
 const beforeLeave=async()=>{
  if(!dirty())return true;
  if(busy){notice('Wait for the welcome picture to finish saving.');return false;}
  const prompt=dialog('Leave without saving?',`<p>Your welcome picture changes have not been saved.</p><div class="ap-actions"><button type="button" class="ap-button" data-stay>Keep editing</button><button type="button" class="ap-button secondary" data-leave>Discard changes</button></div>`);
  return new Promise(resolve=>{let leave=false;prompt.querySelector('[data-stay]').onclick=()=>prompt.close();prompt.querySelector('[data-leave]').onclick=()=>{leave=true;prompt.close();};prompt.addEventListener('close',()=>resolve(leave),{once:true});});
 };
 registerBeforeLeave?.(beforeLeave,{isDirty:dirty});registerCleanup?.(()=>{disposed=true;selectionTicket++;revoke();});
}
