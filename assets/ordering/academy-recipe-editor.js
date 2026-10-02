// Teaching quantities remain strings, including fractions and ranges.
export function mountRecipeEditor(host,document,{esc}){
 const clone=value=>structuredClone(value),ingredient=()=>({name:'',quantity:'',unit:'',brand:''});
 const step=()=>({instruction:'',temperature:'',timer_minutes:'',equipment:''});
 const group=()=>({name:'Ingredients',ingredients:[ingredient()]}),method=()=>({name:'Method',steps:[step()]});
 const component=()=>({name:'New component',yield:{quantity:'',unit:'',pan_size:''},groups:[group()],methods:[method()],equipment:[],baking:[]});
 const variants=clone(document.variants?.length?document.variants:[component()]);
 for(const v of variants){v.yield||={};v.groups||=[];v.methods||=[];v.equipment||=[];v.baking||=[];}
 let active=variants[0],undo=[];
 const at=path=>path?path.split('.').reduce((value,key)=>value[key],variants):variants;
 const input=(label,path,value='',multiline=false)=>`<label>${esc(label)}${multiline?`<textarea data-editor-path="${path}" aria-label="${esc(label)}">${esc(value??'')}</textarea>`:`<input data-editor-path="${path}" type="text" value="${esc(value??'')}">`}</label>`;
 const action=(label,kind,path,index,disabled=false)=>`<button type="button" class="ap-button secondary small" data-editor-action="${kind}" data-editor-list="${path}" ${index===undefined?'':`data-editor-index="${index}"`} ${disabled?'disabled':''} aria-label="${esc(label)}" title="${esc(label)}">${kind==='up'?'↑':kind==='down'?'↓':kind==='remove'?'Remove':esc(label)}</button>`;
 const controls=(name,path,index,length)=>`<div class="ap-editor-row-tools" aria-label="${esc(name)} controls">${action('Move '+name+' up','up',path,index,index===0)}${action('Move '+name+' down','down',path,index,index===length-1)}${action('Remove '+name,'remove',path,index,path===''&&length===1)}</div>`;
 const add=(label,kind,path)=>action(label,'add-'+kind,path);
 const fields=(entries,path,row)=>entries.map(([label,key])=>input(label,path+'.'+key,row[key])).join('');
 const stepDetails=s=>[['Temperature',s.temperature],['Timer',s.timer_minutes?`${s.timer_minutes} min`:''],['Equipment',s.equipment]].filter(([,value])=>value).map(([label,value])=>`${label}: ${value}`).join(' · ')||'Temperature, timer & equipment';
 const render=()=>{
  if(!variants.includes(active))active=variants[0];const i=variants.indexOf(active),v=active,p=String(i);
  const ingredients=v.groups.map((g,j)=>`<fieldset data-group><legend>Ingredient group ${j+1}</legend>${input('Ingredient group',`${p}.groups.${j}.name`,g.name)}${controls('ingredient group',p+'.groups',j,v.groups.length)}${g.ingredients.map((row,k)=>`<div class="ap-editor-ingredient" data-ingredient><div class="ap-editor-ingredient-fields">${fields([['Ingredient','name'],['Quantity','quantity'],['Unit','unit'],['Approved brand','brand']],`${p}.groups.${j}.ingredients.${k}`,row)}</div>${controls('ingredient',`${p}.groups.${j}.ingredients`,k,g.ingredients.length)}</div>`).join('')}${add('Add ingredient','ingredient',`${p}.groups.${j}.ingredients`)}</fieldset>`).join('');
  const methods=v.methods.map((m,j)=>`<fieldset data-method><legend>Method section ${j+1}</legend><div class="ap-editor-method-head">${input('Method section',`${p}.methods.${j}.name`,m.name)}${controls('method section',p+'.methods',j,v.methods.length)}</div>${m.steps.map((s,k)=>`<section class="ap-editor-step" data-step><div class="ap-editor-step-head"><h4>Step ${k+1}</h4>${controls('step',`${p}.methods.${j}.steps`,k,m.steps.length)}</div>${input('Instruction',`${p}.methods.${j}.steps.${k}.instruction`,s.instruction,true)}<details class="ap-editor-step-details" data-step-path="${p}.methods.${j}.steps.${k}"><summary><strong>Step details</strong><span data-step-summary>${esc(stepDetails(s))}</span></summary><div class="ap-editor-step-fields">${fields([['Temperature','temperature'],['Timer (minutes)','timer_minutes'],['Equipment for this step','equipment']],`${p}.methods.${j}.steps.${k}`,s)}</div></details></section>`).join('')}${add('Add step','step',`${p}.methods.${j}.steps`)}</fieldset>`).join('');
  host.innerHTML=`<section class="ap-recipe-editor"><div class="ap-section-head"><div><p class="ap-category">Student recipe maker</p><h3>Recipe components</h3><p class="ap-small ap-muted">Keep each component’s ingredients, yield and method together.</p></div><button type="button" class="ap-button secondary small" data-editor-undo ${undo.length?'':'disabled'}>Undo${undo.length?' '+esc(undo.at(-1).label):''}</button></div><div class="ap-editor-components" role="group" aria-label="Choose component to edit">${variants.map((c,n)=>`<button type="button" class="ap-button ${n===i?'':'secondary'}" data-edit-component="${n}" aria-pressed="${n===i}">${esc(c.name||'Component '+(n+1))}</button>`).join('')}${add('Add component','component','')}</div><p class="ap-small" data-editor-status role="status">Editing component ${i+1} of ${variants.length}</p><fieldset data-component><legend>Component details</legend>${input('Component name',p+'.name',v.name)}${controls('component','',i,variants.length)}<div class="ap-row">${fields([['Yield quantity','quantity'],['Yield unit','unit'],['Pan size','pan_size']],p+'.yield',v.yield)}</div></fieldset><nav class="ap-editor-jumps" aria-label="Student recipe editor sections">${['Ingredients','Method','Equipment','Baking settings'].map((label,n)=>`<button type="button" class="ap-button secondary small" data-editor-jump="${n}">${label}</button>`).join('')}</nav><section class="ap-editor-section" data-editor-section="0"><h3>Ingredients</h3>${ingredients}${add('Add ingredient group','group',p+'.groups')}</section><section class="ap-editor-section" data-editor-section="1"><h3>Method</h3>${methods}${add('Add method section','method',p+'.methods')}</section><section class="ap-editor-section" data-editor-section="2"><h3>Equipment</h3>${v.equipment.map((value,j)=>`<div class="ap-editor-equipment">${input('Equipment item',p+'.equipment.'+j,value)}${controls('equipment item',p+'.equipment',j,v.equipment.length)}</div>`).join('')}${add('Add equipment','equipment',p+'.equipment')}</section><section class="ap-editor-section" data-editor-section="3"><h3>Baking settings</h3>${v.baking.map((s,j)=>`<fieldset data-baking><legend>Baking setting ${j+1}</legend><div class="ap-row">${fields([['Setting name','name'],['Top heat','top'],['Bottom heat','bottom'],['Fan','fan'],['Minutes','minutes'],['Core temperature','core']],`${p}.baking.${j}`,s)}</div>${controls('baking setting',p+'.baking',j,v.baking.length)}</fieldset>`).join('')}${add('Add baking setting','baking',p+'.baking')}</section></section>`;
 };
 host.addEventListener('input',event=>{
  const path=event.target.dataset.editorPath;if(!path)return;
  const keys=path.split('.'),key=keys.pop();at(keys.join('.'))[key]=event.target.value;
  const details=event.target.closest('[data-step-path]');if(details)details.querySelector('[data-step-summary]').textContent=stepDetails(at(details.dataset.stepPath));
  if(path===variants.indexOf(active)+'.name')host.querySelector('[data-edit-component="'+variants.indexOf(active)+'"]').textContent=active.name||'Component '+(variants.indexOf(active)+1);
 });
 host.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target||target.disabled||host.dataset.editorLocked)return;
  if(target.hasAttribute('data-editor-jump')){host.querySelector('[data-editor-section="'+target.dataset.editorJump+'"]').scrollIntoView({block:'start'});return;}
  if(target.hasAttribute('data-edit-component')){active=variants[Number(target.dataset.editComponent)];render();host.querySelector('[aria-pressed="true"]').focus();return;}
  if(target.hasAttribute('data-editor-undo')){const command=undo.pop();if(!command)return;command.restore();active=command.component;render();host.dispatchEvent(new Event('ap:editor-change',{bubbles:true}));host.querySelector('[data-editor-status]').textContent='Undid '+command.label+'.';(host.querySelector('[data-editor-undo]:not(:disabled)')||host.querySelector('[aria-pressed="true"]')).focus();return;}
  const kind=target.dataset.editorAction;if(!kind)return;
  const list=at(target.dataset.editorList),index=Number(target.dataset.editorIndex),previous=active;
  let restore,label;
  if(kind.startsWith('add-')){
   const item={component,group,method,ingredient,step,equipment:()=>'',baking:()=>({name:'',top:'',bottom:'',fan:'',minutes:'',core:''})}[kind.slice(4)](),position=list.length;list.push(item);
   restore=()=>list.splice(position,1);label='addition';if(kind==='add-component')active=item;
  }else if(kind==='remove'){
   if(list===variants&&list.length===1)return;
   const [removed]=list.splice(index,1);restore=()=>list.splice(index,0,removed);label='removal';
  }else{
   const to=index+(kind==='up'?-1:1);if(to<0||to>=list.length)return;
   [list[index],list[to]]=[list[to],list[index]];restore=()=>{[list[index],list[to]]=[list[to],list[index]];};label='move';
  }
  // Inverse commands preserve text entered after a structural change.
  undo.push({restore,label,component:previous});if(undo.length>30)undo.shift();
  const path=target.dataset.editorList;render();host.dispatchEvent(new Event('ap:editor-change',{bubbles:true}));
  const focus=[...host.querySelectorAll('[data-editor-action]')].find(b=>b.dataset.editorAction===kind&&b.dataset.editorList===path&&!b.disabled)||host.querySelector('[data-editor-undo]');focus.focus();
  host.querySelector('[data-editor-status]').textContent=label==='removal'?'Removed. Undo is available before saving.':label==='move'?'Order updated. Undo is available before saving.':'Added. Complete the new fields before saving.';
 });
 render();return ()=>clone(variants);
}
import {prepareProductImage} from './product-image.js?v=approved-20261002-1';
import {renderBakingRecipe,bindBakingRecipe} from './academy-recipe-view.js?v=academy-approved-comparisons-1';
import {academyErrorMessage} from './academy-errors.js?v=academy-audit-1';

export function bindRecipePreview(form,record,readVariants,ui){
 const trigger=document.createElement('button');trigger.type='button';trigger.className='ap-button secondary';trigger.textContent='Preview student recipe';trigger.dataset.previewRecipe='';form.querySelector('button[type=submit]').before(trigger);
 let disposed=false,modal=null,url=null;
 const release=()=>{if(url)URL.revokeObjectURL(url);url=null;};
 ui.registerCleanup(()=>{disposed=true;modal?.close();release();});
 trigger.onclick=async()=>{
  if(modal?.open)return;trigger.disabled=true;form.querySelector('[data-recipe-preview-error]')?.remove();
  try{
   const file=form.elements.photo.files[0];
   const [prepared,savedMedia]=await Promise.all([file?prepareProductImage(file):null,record.id?ui.api('admin_media',{purpose:'recipe',recipe_id:record.id}):[]]);if(disposed||!form.isConnected)return;
   if(prepared)url=URL.createObjectURL(prepared);
   const recipe={title:form.elements.title.value||'Untitled student recipe',document:{description:form.elements.description.value,notes:form.elements.student_notes.value,tips:form.elements.student_tips.value,variants:readVariants()},media:[...savedMedia,...(url?[{id:'local-preview'}]:[])]};
   modal=ui.dialog('Student recipe preview','<p class="ap-muted">Only you can see this preview. These changes have not been saved.</p>'+renderBakingRecipe({recipe,esc:ui.esc,link:ui.link,photo:(id,alt)=>id==='local-preview'?`<img class="ap-photo" src="${ui.esc(url)}" alt="${ui.esc(alt)}">`:ui.photo(id,alt),preview:true}));
   modal.classList.add('ap-student-recipe-preview');bindBakingRecipe(modal);
   modal.addEventListener('close',()=>{release();modal=null;if(!disposed&&trigger.isConnected)trigger.focus();},{once:true});
  }catch(error){release();if(disposed||!form.isConnected)return;const n=document.createElement('p');n.dataset.recipePreviewError='';n.className='ap-field-error';n.role='alert';n.textContent=academyErrorMessage(error);trigger.before(n);}
  finally{trigger.disabled=false;}
 };
}
