// Baking stages keep their original order in variant.baking. group_id links a
// stage to a component without moving or rewriting historical instructions.
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const primaryFields=[
 ['top','Top heat','°C'],['bottom','Bottom heat setting','°C'],['minutes','Time','minutes']
];
const optionalFields=[
 ['actual_bottom','Actual bottom heat','°C'],['fan','Fan setting',''],['core','Core temperature','°C'],
 ['ingredient_temperature','Ingredient temperature','°C'],['batter_temperature','Batter temperature','°C'],
 ['resting_temperature','Resting temperature','°C'],['cooling_minutes','Cooling time','minutes'],
 ['freezing_minutes','Freezing time','minutes'],['notes','Stage notes','']
];
// Older records also support a single oven temperature. Keep it visible when
// saved, while new stages use the existing top/bottom controls.
const legacyFields=[['temperature','Temperature','°C']];
const allFields=[...primaryFields,...optionalFields,...legacyFields];
const populated=value=>(typeof value==='string'&&value.trim()!=='')||(typeof value==='number'&&Number.isFinite(value));
let visibleFields=new WeakMap(),visibleStageFields=new Map(),stageTokens=new WeakMap(),openStages=new Map(),nextToken=0,resetPending=false;

export function bakingStageGroupId(variant,stage){
 const groups=variant?.groups||[];
 if(Object.hasOwn(stage||{},'group_id'))return groups.some(group=>group.id===stage.group_id)?stage.group_id:'';
 return groups.length===1?groups[0].id:'';
}

export function bakingSections(variant){
 return (variant?.baking||[]).map((stage,index)=>({stage,index,groupId:bakingStageGroupId(variant,stage)}));
}

export function hasBakingDetails(stage){
 return allFields.some(([key])=>populated(stage?.[key]));
}

export function bakingFieldLabel(key){
 if(key==='name')return 'Stage name';
 const definition=allFields.find(([field])=>field===key);
 return definition?definition[1]+(definition[2]?` · ${definition[2]}`:''):key;
}

export function setBakingFieldVisible(stage,key,visible){
 if(!stage||![...optionalFields,...legacyFields].some(([field])=>field===key))return false;
 const fields=visibleFields.get(stage)||new Set();
 if(visible)fields.add(key);else fields.delete(key);
 visibleFields.set(stage,fields);
 if(stageTokens.has(stage))visibleStageFields.set(stageTokens.get(stage),fields);
 // Populated values always remain visible. The caller must explicitly confirm
 // clearing a saved value before hiding it; this UI helper never changes data.
 return true;
}

function stageKey(variant,stage){
 if(stage.id)stageTokens.set(stage,`${variant?.id||'variant'}:${stage.id}`);
 if(!stageTokens.has(stage))stageTokens.set(stage,`unsaved-${++nextToken}`);
 return stageTokens.get(stage);
}

export function rememberBakingEditor(root,_variant){
 if(resetPending){resetPending=false;return;}
 for(const node of root?.querySelectorAll('[data-baking-open-key]')||[])openStages.set(node.dataset.bakingOpenKey,node.open);
}

export function resetBakingEditor(){
 visibleFields=new WeakMap();visibleStageFields=new Map();stageTokens=new WeakMap();openStages=new Map();nextToken=0;resetPending=true;
}

function summary(stage){
 return [['top','Top','°C'],['bottom','Bottom','°C'],['temperature','Temperature','°C'],['minutes','','min']]
  .filter(([key])=>populated(stage[key]))
  .map(([key,label,unit])=>`${label?`${label} `:''}${String(stage[key]).trim()}${unit==='°C'?'':' '}${unit}`).join(' · ');
}

export function syncBakingStageSummary(root,variant,index){
 const stage=variant?.baking?.[index];if(!stage)return;
 const node=root?.querySelector(`[data-baking-stage="${Number(index)}"] > summary`);if(!node)return;
 const groupId=bakingStageGroupId(variant,stage),siblings=bakingSections(variant).filter(section=>section.groupId===groupId);
 const position=siblings.findIndex(section=>section.index===Number(index));
 node.querySelector('strong').textContent=`Stage ${position+1} — ${stage.name||'Bake'}`;
 const text=summary(stage);let metric=node.querySelector('.recipe-baking-stage-summary');
 if(!text){metric?.remove();return;}
 if(!metric){metric=node.ownerDocument.createElement('span');metric.className='recipe-baking-stage-summary';node.insertBefore(metric,node.querySelector('.recipe-baking-edit-label'));}
 metric.textContent=text;
}

export function bakingDetailsMarkup(stages,{heading='h3',title='Baking & temperature settings'}={}){
 const saved=(stages||[]).filter(hasBakingDetails);
 if(!saved.length)return '';
 const headingTag=/^h[2-6]$/.test(heading)?heading:'h3',stageTag=`h${Math.min(6,Number(headingTag[1])+1)}`;
 const metric=([key,label,unit],stage)=>`<div><dt>${esc(label)}</dt><dd>${esc(stage[key])}${unit?` <span>${esc(unit)}</span>`:''}</dd></div>`;
 return `<section class="recipe-baking-details"><${headingTag}>${esc(title)}</${headingTag}>${saved.map((stage,index)=>{
  const primary=primaryFields.filter(([key])=>populated(stage[key]));
  const secondary=[...legacyFields,...optionalFields].filter(([key])=>key!=='notes'&&populated(stage[key]));
  return `<section class="recipe-baking-stage"><${stageTag}>Stage ${index+1}${populated(stage.name)?` — ${esc(stage.name)}`:''}</${stageTag}>${primary.length?`<dl class="recipe-baking-primary">${primary.map(item=>metric(item,stage)).join('')}</dl>`:''}${secondary.length?`<dl class="recipe-baking-secondary">${secondary.map(item=>metric(item,stage)).join('')}</dl>`:''}${populated(stage.notes)?`<div class="recipe-baking-notes"><strong>Stage notes</strong><p>${esc(stage.notes)}</p></div>`:''}</section>`;
 }).join('')}</section>`;
}

export function bakingEditor(variant,path,groupId,{field,button}){
 resetPending=false;
 const stages=bakingSections(variant).filter(section=>section.groupId===groupId);
 const groupAttribute=`data-group-id="${esc(groupId)}"`;
 const heading=groupId?'Baking & temperature settings':'Unassigned baking & temperature settings';
 const introduction=groupId?'':`<p class="recipe-muted recipe-baking-legacy-note">These instructions are preserved from this recipe. Assign each stage to its component when you know where it belongs.</p>`;
 if(!stages.length)return `<section class="recipe-baking-editor recipe-baking-empty" data-baking-editor-group="${esc(groupId)}">${button('+ Add Baking Details','add-stage',groupAttribute)}</section>`;
 return `<section class="recipe-baking-editor" data-baking-editor-group="${esc(groupId)}"><div class="recipe-section-head"><h3>${heading}</h3>${button('+ Stage','add-stage',groupAttribute)}</div>${introduction}${stages.map(({stage,index},position)=>{
  const key=stageKey(variant,stage),stagePath=`${path}.baking.${index}`;
  // Save replaces the working document with a normalized copy. Keep explicit,
  // empty editor fields while this editing session continues; nothing is saved
  // into the recipe merely to remember which controls are open.
  if(!visibleFields.has(stage)&&visibleStageFields.has(key))visibleFields.set(stage,new Set(visibleStageFields.get(key)));
  const active=[...optionalFields,...legacyFields].filter(([name])=>populated(stage[name])||visibleFields.get(stage)?.has(name));
  const available=optionalFields.filter(([name])=>!active.some(([activeName])=>activeName===name));
  const actionAttribute=`data-stage="${index}" data-index="${index}"`;
  const details=summary(stage);
  const fields=active.map(([name])=>`<div class="recipe-baking-extra ${name==='notes'?'recipe-baking-extra-wide':''}" data-baking-field="${name}">${field(bakingFieldLabel(name),`${stagePath}.${name}`,name==='notes'?{type:'textarea',rows:2}:{})}${button('Remove','remove-baking-field',`${actionAttribute} data-field="${name}" aria-label="Remove ${esc(bakingFieldLabel(name))}"`,'recipe-baking-remove-field')}</div>`).join('');
  const picker=available.length?`<details class="recipe-baking-field-picker"><summary>+ Add Field</summary><div class="recipe-baking-field-options" aria-label="Additional baking fields">${available.map(([name])=>button(esc(bakingFieldLabel(name)),'add-baking-field',`${actionAttribute} data-field="${name}"`)).join('')}</div></details>`:'';
  return `<details class="recipe-baking-stage-editor" data-baking-stage="${index}" data-baking-open-key="${esc(key)}" ${openStages.get(key)!==false?'open':''}><summary><strong>Stage ${position+1} — ${esc(stage.name||'Bake')}</strong>${details?`<span class="recipe-baking-stage-summary">${esc(details)}</span>`:''}<span class="recipe-baking-edit-label">Edit stage</span></summary><div class="recipe-baking-stage-body"><div class="recipe-baking-default-fields">${field('Stage name',`${stagePath}.name`)}${primaryFields.map(([name])=>field(bakingFieldLabel(name),`${stagePath}.${name}`)).join('')}</div>${active.length?`<div class="recipe-baking-extra-fields">${fields}</div>`:''}<div class="recipe-baking-stage-tools">${picker}<details class="recipe-baking-assignment"><summary>Assign component</summary><label>Component<select data-baking-group="${index}"><option value="" ${groupId===''?'selected':''}>Not assigned · recipe-wide</option>${(variant.groups||[]).map(group=>`<option value="${esc(group.id)}" ${groupId===group.id?'selected':''}>${esc(group.name||'Unnamed component')}</option>`).join('')}</select></label></details><div class="recipe-baking-stage-actions">${button('↑','move-stage',`${actionAttribute} data-direction="-1" aria-label="Move stage ${position+1} up" ${position===0?'disabled':''}`)}${button('↓','move-stage',`${actionAttribute} data-direction="1" aria-label="Move stage ${position+1} down" ${position===stages.length-1?'disabled':''}`)}${button('Remove stage','remove-stage',actionAttribute,'danger')}</div></div></div></details>`;
 }).join('')}</section>`;
}
