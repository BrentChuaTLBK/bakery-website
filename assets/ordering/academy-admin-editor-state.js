// Explicit save state for the approved Admin forms. Publishing and email queueing
// remain deliberate actions; this helper never autosaves or dispatches a request.
export function protectAdminEditor(form,ui,{readState,label='changes',sticky=true}={}){
 let clean='',disposed=false,prompt=null;
 const snapshot=()=>JSON.stringify(readState?readState():[...form.querySelectorAll('input,textarea,select')].filter(n=>n.name!=='email_template'&&!n.hasAttribute('data-ignore-dirty')).map(n=>[n.name||n.dataset.editorPath||n.dataset.emailField||'',n.type==='file'?[...n.files].map(f=>[f.name,f.size,f.lastModified]):['checkbox','radio'].includes(n.type)?n.checked:n.value]));
 const state=document.createElement('p');state.className='ap-admin-save-state ap-small';state.setAttribute('role','status');state.dataset.editorSaveState='';
 const bar=document.createElement('div');bar.className=sticky?'ap-admin-savebar':'ap-admin-editor-status';bar.append(state);
 if(sticky){const actions=document.createElement('div');actions.className='ap-actions';bar.append(actions);for(const button of form.querySelectorAll('button[type=submit],[data-preview-email],[data-preview-recipe],[data-preview-content]'))actions.append(button);}
 form.append(bar);clean=snapshot();
 const dirty=()=>!disposed&&form.isConnected&&snapshot()!==clean;
 const sync=()=>{if(disposed)return;const changed=dirty();state.textContent=changed?'Unsaved '+label:'Saved';state.classList.toggle('is-dirty',changed);};
 const check=()=>{if(!dirty())return Promise.resolve(true);if(prompt)return prompt;
  prompt=new Promise(resolve=>{const d=ui.dialog('Leave with unsaved changes?',`<p>Your unsaved ${ui.esc(label)} will be discarded.</p><div class="ap-actions"><button type="button" class="ap-button" data-keep-editing>Keep editing</button><button type="button" class="ap-button secondary" data-discard-editing>Discard changes</button></div>`);let approved=false;d.querySelector('[data-keep-editing]').onclick=()=>d.close();d.querySelector('[data-discard-editing]').onclick=()=>{approved=true;d.close();};d.addEventListener('close',()=>{prompt=null;resolve(approved);},{once:true});});return prompt;
 };
 const unsubscribe=ui.registerBeforeLeave?.(check,{isDirty:dirty});
 const modal=form.closest('dialog'),closeButton=modal?.querySelector('.ap-dialog-close');
 const closeFromButton=event=>{if(!dirty())return;event.preventDefault();event.stopImmediatePropagation();void check().then(approved=>{if(approved)modal.close();});};
 const cancel=event=>{if(!dirty())return;event.preventDefault();void check().then(approved=>{if(approved)modal.close();});};
 closeButton?.addEventListener('click',closeFromButton,true);modal?.addEventListener('cancel',cancel);
 form.addEventListener('input',sync);form.addEventListener('change',sync);form.addEventListener('ap:editor-change',sync);form.addEventListener('ap:form-complete',sync);
 const dispose=()=>{disposed=true;unsubscribe?.();closeButton?.removeEventListener('click',closeFromButton,true);modal?.removeEventListener('cancel',cancel);form.removeEventListener('input',sync);form.removeEventListener('change',sync);form.removeEventListener('ap:editor-change',sync);form.removeEventListener('ap:form-complete',sync);};ui.registerCleanup(dispose);modal?.addEventListener('close',dispose,{once:true});
 sync();return {isDirty:dirty,canLeave:check,markSaved(){clean=snapshot();sync();},markDirty:sync,dispose,status:state};
}

export function confirmAdminAction(ui,title,copy,confirmLabel='Confirm'){
 return new Promise(resolve=>{const d=ui.dialog(title,`<p class="ap-copy">${ui.esc(copy)}</p><div class="ap-actions"><button type="button" class="ap-button secondary" data-cancel>Cancel</button><button type="button" class="ap-button" data-confirm>${ui.esc(confirmLabel)}</button></div>`);let result=false;d.querySelector('[data-cancel]').onclick=()=>d.close();d.querySelector('[data-confirm]').onclick=()=>{result=true;d.close();};d.addEventListener('close',()=>resolve(result),{once:true});});
}
