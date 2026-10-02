import {mountAdminAccounts} from './academy-admin-accounts.js?v=academy-approved-comparisons-1';
import {mountAdminCurriculum} from './academy-admin-curriculum.js?v=academy-approved-comparisons-1';
import {mountAdminRecipes} from './academy-admin-recipes.js?v=academy-approved-comparisons-1';
import {mountAdminWork} from './academy-admin-work.js?v=academy-approved-comparisons-1';
import {protectAdminEditor} from './academy-admin-editor-state.js?v=academy-approved-comparisons-1';
import {mountRecipientPicker,recipientReviewMarkup} from './academy-admin-recipients.js?v=academy-approved-comparisons-1';
import {mountAdminPhotoManager} from './academy-admin-photo-manager.js?v=academy-approved-comparisons-1';
import {mountWelcomeSettings} from './academy-welcome-admin.js?v=academy-approved-comparisons-1';
import {mountConversationList} from './academy-conversations.js?v=academy-approved-comparisons-1';
import {academyErrorMessage} from './academy-errors.js?v=academy-audit-1';
import {mountRecipeEditor,bindRecipePreview} from './academy-recipe-editor.js?v=academy-approved-comparisons-1';
import {bindAnnouncementPreview,bindUpcomingPreview} from './academy-announcement-view.js?v=academy-approved-comparisons-1';
import {materialSection,mountClassMaterials} from './academy-materials.js?v=academy-resources-1';
import {mountEmailTemplates} from './academy-email-composer.js?v=academy-approved-comparisons-1';
export async function mountAcademyAdmin(ui){
 const {api,root,user,shell,notice,heading,empty,field,area,select,check,link,button,esc,date,photo,hydrate,dialog,formSubmit,uploadPhotos,productImageAccept}=ui;
 const boot=await api('admin_bootstrap'),[requestedView,id]=location.hash.slice(1).split('/');
 const view=(!requestedView||(!boot.owner&&requestedView==='overview'))?(boot.owner?'overview':'inbox'):requestedView;
 const navigation=boot.owner?{
  primary:['overview','accounts','classes','inbox'],
  groups:[
   ['Workspace',[['overview','Overview']]],
   ['People',[['accounts','Accounts / Students'],['instructors','Instructors']]],
   ['Teaching',[['classes','Classes'],['recipes','Student Recipes']]],
   ['Student work',[['inbox','Instructor Inbox'],['submissions','Student Submissions'],['moderation','Gallery Moderation'],['gallery','Student Gallery']]],
   ['Communications',[['announcements','Announcements'],['upcoming','Upcoming Classes'],['email','Email'],['newsletter','Newsletter']]],
   ['Operations',[['analytics','Analytics'],['backup','Backup'],['settings','Academy appearance']]],
  ],
 }:{primary:['inbox','classes','submissions','moderation'],groups:[['Teaching',[['inbox','Instructor Inbox'],['classes','My Classes'],['submissions','Student Submissions'],['moderation','Gallery Moderation']]]]};
 const draw=body=>shell(`${heading('TLB Academy',boot.owner?'Academy administration':'Your instructor workspace')}<section class="ap-admin-content">${body}</section>`,view,{navigation});
 const rows=(heads,rows)=>`<div class="ap-table-wrap"><table class="ap-table"><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
 const form=(body,submit='Save changes')=>`<form class="ap-form">${body}<button type="submit" class="ap-button">${submit}</button></form>`;
 const lines=s=>String(s||'').split('\n').map(v=>v.trim()).filter(Boolean);
 const refresh=()=>mountAcademyAdmin(ui);
 async function thumbnail(kind,target,form){const file=form.elements.photo?.files[0];if(!file)return;const host=document.createElement('div');form.append(host);const context={purpose:kind,[kind==='class'?'class_id':kind==='instructor'?'instructor_id':`${kind}_id`]:target};const media=await uploadPhotos([file],context,host);const latest=media[0];if(latest)await api('attach_media',{id:latest.id,instructor_id:kind==='instructor'?target:undefined});}
 const savedForms=new WeakMap();
 async function saveOnce(form,action,payload){
  if(savedForms.has(form))return savedForms.get(form);
  form.dataset.requestKey ||= crypto.randomUUID();
  // Freeze the submitted snapshot while the request is pending. Otherwise an
  // edit made after submission would be discarded by the successful refresh.
  const controls=[...form.elements].map(control=>[control,control.disabled]),recipeEditor=form.querySelector('#ap-components'),previousLock=recipeEditor?.dataset.editorLocked;
  controls.forEach(([control])=>control.disabled=true);if(recipeEditor)recipeEditor.dataset.editorLocked='true';
  let saved;try{saved=await api(action,{...payload,idempotency_key:form.dataset.requestKey});}
  catch(error){controls.forEach(([control,disabled])=>control.disabled=disabled);if(recipeEditor){if(previousLock===undefined)delete recipeEditor.dataset.editorLocked;else recipeEditor.dataset.editorLocked=previousLock;}throw error;}
  controls.filter(([control])=>control.type==='file').forEach(([control,disabled])=>control.disabled=disabled);
  if(payload.status&&form.elements.status){form.elements.status.value=payload.status;form.querySelectorAll('[data-publish-status], [data-content-save]').forEach(b=>{b.hidden=b.hasAttribute('data-content-save')?!['hidden','archived'].includes(payload.status):b.dataset.publishStatus!==payload.status;if(!b.hidden)b.textContent='Retry photo upload';});}
  savedForms.set(form,saved);
  if(recipeEditor){recipeEditor.dataset.editorLocked='true';recipeEditor.querySelectorAll('button').forEach(b=>b.disabled=true);}
  // The record already exists. Retrying a failed photo must only finish its
  // upload, rather than create another record or re-submit an old revision.
  [...form.elements].filter(e=>e.tagName!=='BUTTON'&&e.type!=='file').forEach(e=>e.disabled=true);
  return saved;
 }
 const photoInput=()=>`<label>Photo (optional)<input name="photo" type="file" accept="${productImageAccept}"></label>`;
 if(view==='thread')return ui.showThread(id,navigation);
 if(view==='overview'){
 const attention=await api('admin_attention');
 draw(`<div class="ap-grid two ap-attention"><a class="ap-attention-card" href="#inbox"><span>Conversations needing a reply</span><strong>${attention.needs_reply}</strong><span>Open Instructor Inbox →</span></a><a class="ap-attention-card" href="#moderation"><span>Gallery posts awaiting review</span><strong>${attention.pending_gallery}</strong><span>Review student work →</span></a></div><div class="ap-metrics">${Object.entries(boot.metrics).filter(([,v])=>v!==null).map(([k,v])=>`<div class="ap-metric"><span class="ap-small ap-muted">${esc(k.replaceAll('_',' '))}</span><strong>${v}</strong></div>`).join('')}</div>${heading('Your teaching kitchen')}<p>Manage evergreen class curricula, support students, and review their creations.</p><div class="ap-actions">${link('Open Instructor Inbox','#inbox')}${link('Review student work','#moderation',true)}</div>`);return;
 }
 if(view==='classes')return mountAdminCurriculum(ui,{boot,id,draw,rows,form,refresh,saveOnce,thumbnail,photoInput});
 if(view==='accounts')return mountAdminAccounts(ui,{boot,id,draw,rows,form,refresh});
 if(view==='instructors'){
 draw(`${heading('Instructors','Give an existing TLB account instructor access without granting access to orders or payments.',button('Add instructor','add-instructor'))}${rows(['Instructor','Title','Status',''],boot.instructors.map(i=>`<tr><td>${esc(i.display_name)}</td><td>${esc(i.title)}</td><td>${i.active?'Active':'Inactive'}</td><td><button class="ap-button secondary small" data-instructor="${i.user_id}">Edit</button></td></tr>`))}`);
 const edit=i=>{const d=dialog(i?'Edit instructor':'Add instructor',`${i?'':form(`${field('Search TLB account by name or email','query','','search',true)}`,'Find TLB account')}<div id="ap-instructor-editor"></div>`);const editor=account=>{d.querySelector('#ap-instructor-editor').innerHTML=form(`${field('Display name','display_name',i?.display_name||account.name,'text',true)}${field('Title','title',i?.title)}${area('Short bio','bio',i?.bio)}${field('Notification email (optional)','notification_email',i?.notification_email,'email')}${check('Active instructor','active',i?.active??true)}${check('Send instructor email notifications','notifications',i?.notifications??true)}${photoInput()}`);formSubmit(d.querySelector('#ap-instructor-editor form'),async(data,f)=>{await saveOnce(f,'save_instructor',{id:account.id,display_name:data.get('display_name'),title:data.get('title'),bio:data.get('bio'),notification_email:data.get('notification_email'),active:data.has('active'),notifications:data.has('notifications')});await thumbnail('instructor',account.id,f);d.close();refresh();});};if(i)editor({id:i.user_id});else formSubmit(d.querySelector('form'),async data=>{const accounts=await api('accounts',{query:data.get('query')});d.querySelector('#ap-instructor-editor').innerHTML=accounts.map(a=>`<p><button class="ap-button secondary" data-choose="${a.id}">${esc(a.name)} · ${esc(a.email)}</button></p>`).join('')||'<p>No matching TLB account.</p>';d.querySelectorAll('[data-choose]').forEach(b=>b.onclick=()=>editor(accounts.find(a=>a.id===b.dataset.choose)));});};root.querySelector('[data-action=add-instructor]').onclick=()=>edit();root.querySelectorAll('[data-instructor]').forEach(b=>b.onclick=()=>edit(boot.instructors.find(i=>i.user_id===b.dataset.instructor)));return;
 }
 if(view==='recipes')return mountAdminRecipes(ui,{boot,id,draw,rows,form,refresh,saveOnce,thumbnail,photoInput});
 if(['announcements','upcoming'].includes(view)){
 const upcoming=view==='upcoming',records=await api(upcoming?'admin_upcoming':'admin_announcements');
 if(!id){draw(`${heading(upcoming?'Upcoming classes':'Announcements','',link('Create new',`#${view}/new`))}${rows(['Title','Status',''],records.map(r=>`<tr><td>${esc(r.title)}</td><td>${esc(r.status)}</td><td>${link('Edit',`#${view}/${r.id}`,true)}</td></tr>`))}`);return;}
 const r=records.find(x=>x.id===id)||{title:'',status:'draft',products:[]};
 draw(`${heading(upcoming?'Upcoming class':'Academy announcement')}${form(`${field('Title','title',r.title,'text',true)}${upcoming?`${area('Description','description',r.description)}${area('Products / modules (one per line)','products',r.products.join('\n'))}${field('Schedule (shown to students)','schedule',r.schedule)}${field('Start date / time (local)','starts_at',r.starts_at?new Date(new Date(r.starts_at)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):'','datetime-local')}`:`${area('Short content','summary',r.summary)}${area('Full content','content',r.content)}${field('Publish date / time (local)','publish_at',r.publish_at?new Date(new Date(r.publish_at)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):'','datetime-local')}`}${field('Button text','cta',r.cta)}${field(upcoming?'Inquiry URL':'CTA URL',upcoming?'inquiry_url':'cta_url',upcoming?r.inquiry_url:r.cta_url,'url')}${select('Status','status',['draft','published','hidden','archived'].map(v=>[v,v]),r.status)}${photoInput()}`)}`);
 const editor=root.querySelector('form');
 const saveButton=editor.querySelector('button[type=submit]');saveButton.textContent='Save changes';saveButton.dataset.contentSave='';
 const draft=document.createElement('button');draft.type='submit';draft.className='ap-button secondary';draft.dataset.publishStatus='draft';draft.textContent=r.status==='published'?'Move to draft':'Save draft';
 const publish=document.createElement('button');publish.type='submit';publish.className='ap-button';publish.dataset.publishStatus='published';publish.textContent=r.status==='published'?'Publish changes':'Publish';
 saveButton.before(draft,publish);
 const contentGuard=protectAdminEditor(editor,ui,{label:upcoming?'upcoming class':'announcement'});
 const syncActions=()=>{saveButton.hidden=!['hidden','archived'].includes(editor.elements.status.value);};editor.elements.status.onchange=syncActions;syncActions();
 (upcoming?bindUpcomingPreview:bindAnnouncementPreview)({form:editor,record:r,view:upcoming?ui.upcomingView:ui.announcementView,dialog,hydrate,esc,registerCleanup:ui.registerCleanup});
 formSubmit(editor,async(data,f,submitter)=>{const payload=Object.fromEntries(data);payload.status=submitter?.dataset.publishStatus||payload.status;delete payload.photo;for(const key of ['starts_at','publish_at'])if(payload[key])payload[key]=new Date(payload[key]).toISOString();if(upcoming)payload.products=lines(payload.products);const result=await saveOnce(f,upcoming?'save_upcoming':'save_announcement',{...payload,id:id==='new'?null:id,revision:r.revision});await thumbnail(upcoming?'upcoming':'announcement',result.id,f);contentGuard.markSaved();location.hash=view;});
 if(id!=='new'){root.querySelector('.ap-admin-content').insertAdjacentHTML('beforeend','<section class="ap-section"><h3>Photos</h3><div data-content-photos></div></section>');await mountAdminPhotoManager(root.querySelector('[data-content-photos]'),ui,{purpose:upcoming?'upcoming':'announcement',[upcoming?'upcoming_id':'announcement_id']:id},{coverId:r.cover_media_id,label:'Content photos'});}return;
 }
 if(['moderation','submissions','gallery'].includes(view))return mountAdminWork(ui,{boot,view,id,draw});
 if(view==='settings'&&boot.owner)return mountWelcomeSettings({...ui,draw});
 if(['inbox','messages'].includes(view)){
  const attention=await api('instructor_attention');const queueHTML='<div class="ap-instructor-attention"><a href="#inbox"><strong>'+attention.needs_reply+'</strong><span>Conversations need a reply<small>Instructor inbox</small></span></a><a href="#moderation"><strong>'+attention.pending_gallery+'</strong><span>Gallery posts to review<small>Gallery moderation</small></span></a><a href="#submissions/private"><strong>'+attention.private_unseen+'</strong><span>New private submissions<small>Private student work</small></span></a></div>';
  return mountConversationList({...ui,draw},{admin:true,classes:boot.classes,actorId:user.id,attentionMarkup:queueHTML});
 }
 if(view==='analytics'){const data=await api('analytics');draw(`${heading('Academy analytics')}${rows(['Class','Instructor','Status','Active accounts','Assignments'],data.classes.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.instructor)}</td><td>${esc(c.status)}</td><td>${c.active_accounts}</td><td>${c.historical_assignments}</td></tr>`))}<section class="ap-section">${heading('Recent audit activity')}${rows(['Admin','Action','Target','Time'],data.audit.map(a=>`<tr><td>${esc(a.actor_name)}</td><td>${esc(a.action)}</td><td>${esc(a.target_id)}</td><td>${date(a.at)}</td></tr>`))}</section>`);return;}
 if(['email','newsletter'].includes(view)){
 const newsletter=view==='newsletter',kind=newsletter?'marketing':'operational';
 const broadcasts=(await api('admin_broadcasts')).filter(b=>b.kind===kind);
 const audiences=newsletter?[['subscribers','All Academy newsletter subscribers'],['students','Subscribed Academy students'],['class','Subscribers in a specific class'],['instructor','Subscribers taught by an instructor'],['selected','Selected subscribers']]:[['students','All Academy students'],['class','Specific class'],['instructor','Students of an instructor'],['selected','Selected accounts']];
 const description=newsletter?'Share new classes, workshops, baking camps, offers, and Academy news. Only accounts that opted in to the Academy newsletter can receive these messages.':'Send essential class communications, such as schedule changes, lesson reminders, and class materials. Newsletter consent is not required for these updates. Use Newsletter for news and promotions.';
 draw(`${heading(newsletter?'Academy newsletter':'Academy class email',description)}<p class="ap-small">From: TLB Academy &lt;Academy@thelittlebakerkitchen.com&gt;</p>${newsletter?`<p>${boot.metrics.newsletter_subscribers} Academy newsletter subscribers. Kitchen preferences remain independent.</p>`:'<p>Student questions and instructor replies send their notifications automatically. Manage those conversations in <a href="#inbox">Instructor Inbox</a>.</p>'}${form(`${field('Subject','subject','','text',true)}${area('Message','body')}${select('Recipients','audience',audiences)}<div data-recipient-detail="class" hidden>${select('Class','class_id',[['','Choose class'],...boot.classes.map(c=>[c.id,c.name])])}</div><div data-recipient-detail="instructor" hidden>${select('Instructor','instructor_id',[['','Choose instructor'],...boot.instructors.map(i=>[i.user_id,i.display_name])])}</div><div data-recipient-detail="selected" hidden>${area('Selected account emails (one per line)','emails')}</div>`,'Review recipients')}<section class="ap-section">${heading(newsletter?'Newsletter history':'Class email history')}${broadcasts.length?rows(['Subject','Recipients','Created'],broadcasts.map(b=>`<tr><td>${esc(b.subject)}</td><td>${b.recipients}</td><td>${date(b.created_at)}</td></tr>`)):empty(newsletter?'No Academy newsletters sent yet.':'No class emails sent yet.')}</section>`);
 const composer=root.querySelector('form'),audience=composer.elements.audience;
 composer.elements.subject.maxLength=160;composer.elements.body.maxLength=10000;composer.elements.body.required=true;
 const emailEditor=await mountEmailTemplates(composer,ui,kind);
 const recipientPicker=mountRecipientPicker(composer.querySelector('[data-recipient-detail=selected]'),ui);
 const emailGuard=protectAdminEditor(composer,ui,{label:'email draft',readState:()=>({draft:emailEditor.readDraft(),audience:audience.value,class_id:composer.elements.class_id.value,instructor_id:composer.elements.instructor_id.value,emails:composer.elements.emails.value,selected:recipientPicker.state()})});

 const showRecipientDetails=()=>composer.querySelectorAll('[data-recipient-detail]').forEach(section=>{const active=section.dataset.recipientDetail===audience.value;section.hidden=!active;section.querySelectorAll('input,select,textarea').forEach(control=>{control.disabled=!active;control.required=active&&control.tagName==='SELECT';});});
 audience.onchange=showRecipientDetails;showRecipientDetails();
 formSubmit(composer,async data=>{const payload={...Object.fromEntries(data),...emailEditor.current(),kind};delete payload.email_template;payload.emails=lines(payload.emails);payload.user_ids=payload.audience==='selected'?recipientPicker.ids():[];const preview=await api('broadcast_preview',payload);const d=dialog(newsletter?'Review Academy newsletter':'Review class email',`${recipientReviewMarkup(preview,payload,ui,boot)}<div data-email-preview></div><p>${preview.recipients} ${newsletter?'opted-in subscribers':'eligible accounts'}.</p>${newsletter?'<p>Only Academy newsletter subscribers are included.</p>':'<p>For essential class communications. News and promotions belong in Newsletter.</p>'}<p class="ap-banner error" data-send-error role="alert" tabindex="-1" hidden></p>${button(newsletter?'Queue newsletter':'Queue class email','send')}`);d.classList.add('ap-email-preview-dialog');emailEditor.preview(d.querySelector('[data-email-preview]'),payload);const requestKey=crypto.randomUUID();const sendButton=d.querySelector('[data-action=send]');sendButton.disabled=preview.recipients===0;let sending=false;sendButton.onclick=async()=>{if(sending)return;sending=true;sendButton.disabled=true;try{const sent=await api('broadcast_send',{...payload,reviewed_user_ids:preview.matched.map(account=>account.user_id),idempotency_key:requestKey});emailGuard.markSaved();d.close();await refresh();notice(`${sent.recipients} emails queued for delivery.`);}catch(e){const error=d.querySelector('[data-send-error]');error.textContent=academyErrorMessage(e);error.hidden=false;error.focus();}finally{sending=false;sendButton.disabled=preview.recipients===0;}};});return;
 }
 if(view==='backup'){const {mountAcademyBackup}=await import('./academy-portal-backup.js?v=approved-20261002-1');return mountAcademyBackup({...ui,draw});}
 draw(empty('Choose an Academy section.'));
}
