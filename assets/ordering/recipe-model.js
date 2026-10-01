import {quantity,inputQuantity,exact,multiply,scaleIngredients,ingredientTotals,componentPlan,scaledYield,unitInfo,add,compare} from './recipe-math.js?v=approved-20261002-1';
export const id=()=>crypto.randomUUID();
export const clone=value=>structuredClone(value);
export const ingredient=()=>({id:id(),name:'',quantity:'',unit:'g',notes:'',brand:''});
export const group=(name='Ingredients')=>({id:id(),name,ingredients:[ingredient()]});
export const step=()=>({id:id(),instruction:'',timer_minutes:'',temperature:'',equipment:'',warning:''});
export const method=(groupId='')=>({id:id(),name:'Procedure',group_id:groupId,steps:[step()]});
export const stage=()=>({id:id(),name:'Bake',top:'',bottom:'',actual_bottom:'',fan:'',minutes:'',core:'',notes:''});
export const defaultCosting=()=>({mode:'costing_only',labor_percent:'0',saleable_yield:'',sale_unit:'each',selling_price:'',price_basis:'unit'});
export const variant=(name='Standard')=>{const g=group('Main component');return {id:id(),name,yield:{quantity:'1',unit:'batch',portions:'',portion_weight:'',batch_weight:'',finished_weight:'',pan_size:'',pans:'',loss_percent:''},groups:[g],methods:[method(g.id)],baking:[],components:[],equipment:[],packaging:{description:'',dimensions:'',notes:'',photos:[]},additional_costs:[],costing:defaultCosting(),production_notes:'',photos:[]};};
export const blankRecipe=()=>({name:'',description:'',category_id:'',tags:[],flavor:'',product_line:'',currency:'PHP',allergens:[],private_notes:'',critical_notes:'',photos:[],files:[],variants:[variant()]});
export function normalizeRecipe(doc){
  const result={...blankRecipe(),...clone(doc)};
  result.variants=(doc.variants||[]).map(v=>({...variant(v.name),...clone(v),yield:{...variant().yield,...v.yield},costing:{...defaultCosting(),...v.costing},packaging:{description:'',dimensions:'',notes:'',photos:[],...v.packaging}}));
  return result;
}
export function freshVariant(value,name) {
  const v=clone(value);v.id=id();v.name=name||`${value.name} — copy`;
  const associations=v.methods.map(m=>methodGroupId(v,m)),groupIds=new Map();
  for(const g of v.groups){const old=g.id;g.id=id();groupIds.set(old,g.id);for(const r of g.ingredients)r.id=id();}
  for(const [i,m] of v.methods.entries()){m.id=id();m.group_id=groupIds.get(associations[i])||'';for(const s of m.steps)s.id=id();}
  for(const s of v.baking)s.id=id();for(const c of v.components)c.id=id();return v;
}
// Legacy records remain unchanged. Only unambiguous names or a single generic
// procedure are paired for display; assembly always stays separate.
export function methodGroupId(v,m){
  if(Object.hasOwn(m,'group_id'))return v.groups.some(g=>g.id===m.group_id)?m.group_id:'';
  const key=s=>String(s||'').toLowerCase().replace(/\b(?:ingredients?|procedure|method|instructions|directions)\b/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  if(/^(?:assembly|finishing|decoration|baking)\b/i.test(m.name||''))return '';
  const matches=v.groups.filter(g=>key(g.name)&&key(g.name)===key(m.name));
  if(matches.length===1)return matches[0].id||'';
  return !key(m.name)&&v.groups.length===1?v.groups[0].id||'':'';
}
export function recipeSections(v){
  const methods=(v.methods||[]).map((method,index)=>({method,index,groupId:methodGroupId(v,method)}));
  return {components:v.groups.map((group,index)=>({group,index,methods:methods.filter(m=>m.groupId&&m.groupId===group.id)})),standalone:methods.filter(m=>!m.groupId)};
}
export function addComponent(v,name=`Component ${v.groups.length+1}`){const g=group(name);v.groups.push(g);v.methods.push(method(g.id));return g;}
export function removeComponent(v,index){const {group,methods}=recipeSections(v).components[index];const removed=new Set(methods.map(m=>m.index));v.methods=v.methods.filter((m,i)=>!removed.has(i));v.groups=v.groups.filter(g=>g!==group);}
export function validateRecipe(doc) {
  const errors=[];if(!doc.name?.trim()||doc.name.length>200)errors.push('Add a recipe name of up to 200 characters.');
  if(!doc.variants?.length)errors.push('Add a size variant.');
  const unique=new Set(),variantIds=new Set();
  for(const v of doc.variants||[]) {
    if(!v.id||variantIds.has(v.id))errors.push('Size identifiers must be unique.');variantIds.add(v.id);
    if(!v.name?.trim())errors.push('Name each size variant.');
    try{if(!inputQuantity(v.yield.quantity).n)throw Error();}catch{errors.push(`${v.name}: base yield must be positive and at most 1 trillion.`);}
    if(!v.yield.unit?.trim())errors.push(`${v.name}: add a yield unit.`);
    for(const key of ['portions','portion_weight','batch_weight','finished_weight','pans','loss_percent'])if(v.yield[key]!=null&&v.yield[key]!==''){
      try{const q=inputQuantity(v.yield[key]);if(key==='loss_percent'&&compare(q,quantity('100'))>0)throw Error();}
      catch{errors.push(`${v.name}: ${key.replaceAll('_',' ')} must be nonnegative${key==='loss_percent'?' and no greater than 100%':''}.`);}
    }
    const scaleOptions=v.yield.scale_options||[],scaleIds=new Set();
    if(!Array.isArray(scaleOptions)||scaleOptions.length>12)errors.push(`${v.name}: use up to 12 scaling options.`);
    else for(const option of scaleOptions){
      if(!option.label?.trim()||option.label.length>60||!option.unit?.trim()||option.unit.length>60)errors.push(`${v.name}: name each scaling option and its unit (up to 60 characters).`);
      if(!/^[a-zA-Z0-9_-]{1,64}$/.test(option.id)||scaleIds.has(option.id))errors.push(`${v.name}: scaling option identifiers must be unique.`);scaleIds.add(option.id);
      try{if(!inputQuantity(option.quantity).n)throw Error();}catch{errors.push(`${option.label||'Scaling option'}: enter a positive base amount.`);}
    }
    if(v.yield.scale_default&&v.yield.scale_default!=='multiplier'&&!scaleOptions.some(option=>'custom:'+option.id===v.yield.scale_default))errors.push(`${v.name}: choose an available default scaling option.`);
    for(const g of v.groups)for(const r of g.ingredients) {
      if(!r.name?.trim())errors.push(`${v.name} / ${g.name}: name each ingredient or remove the empty row.`);
      try{inputQuantity(r.quantity);}catch{errors.push(`${r.name||'Ingredient'}: enter a nonnegative quantity or fraction, at most 1 trillion.`);}
      if(!r.unit?.trim())errors.push(`${r.name||'Ingredient'}: choose a unit.`);
      if(unique.has(r.id))errors.push('Ingredient row identifiers must be unique.');unique.add(r.id);
    }
    const groupIds=v.groups.map(g=>g.id).filter(Boolean);if(new Set(groupIds).size!==groupIds.length)errors.push(`${v.name}: component identifiers must be unique.`);
    const methodIds=new Set();for(const m of v.methods){
      if(m.id&&methodIds.has(m.id))errors.push(`${v.name}: procedure identifiers must be unique.`);if(m.id)methodIds.add(m.id);
      if(m.group_id&&!groupIds.includes(m.group_id))errors.push(`${m.name}: choose an existing component for this procedure.`);
      for(const s of m.steps){
        if(!s.instruction?.trim())errors.push(`${m.name}: fill or remove empty method steps.`);
        if(s.id&&unique.has(s.id))errors.push('Ingredient and method step identifiers must be unique.');if(s.id)unique.add(s.id);
        if(s.timer_minutes!=null&&s.timer_minutes!=='')try{inputQuantity(s.timer_minutes);}catch{errors.push(`${m.name}: enter a nonnegative timer.`);}
      }
    }
    for(const c of v.additional_costs||[])try{inputQuantity(c.amount);if(c.resource_id){inputQuantity(c.quantity);if(!c.unit?.trim())throw Error();}}catch{errors.push(`${c.resource_name||c.name||'Additional cost'}: enter valid nonnegative amounts, quantities and units.`);}
    if(v.costing){const c=v.costing;
      if(!['costing_only','saleable'].includes(c.mode))errors.push(`${v.name}: choose a costing mode.`);
      try{if(compare(inputQuantity(c.labor_percent||'0'),quantity('10000'))>0)throw Error();}catch{errors.push(`${v.name}: labor and utilities allowance must be between 0% and 10,000%.`);}
      if(c.mode==='saleable'){
        try{if(!inputQuantity(c.saleable_yield).n)throw Error();}catch{errors.push(`${v.name}: enter a positive saleable yield.`);}
        try{inputQuantity(c.selling_price);}catch{errors.push(`${v.name}: enter a nonnegative selling price.`);}
        if(!['unit','batch'].includes(c.price_basis)||!['each','box','whole_cake','tray','set'].includes(c.sale_unit))errors.push(`${v.name}: choose the saleable unit and selling-price basis.`);
      }
    }
  }return errors;
}
export function yieldReview(v){
  let raw=quantity('0'),unknown=0;const warnings=[];
  for(const g of v.groups)for(const r of g.ingredients)try{const unit=unitInfo(r.unit);if(unit.dimension==='mass')raw=add(raw,multiply(quantity(r.quantity),unit.factor));else unknown++;}catch{unknown++;}
  unknown+=(v.components||[]).length;
  const y=v.yield;
  try{
    if(y.batch_weight&&y.finished_weight&&compare(quantity(y.finished_weight),quantity(y.batch_weight))>0)warnings.push('Finished weight exceeds raw batch weight. Check the weights or record any additions after weighing.');
    if(y.batch_weight&&y.finished_weight&&y.loss_percent!==''&&y.loss_percent!=null){const expected=multiply(quantity(y.batch_weight),quantity({n:100n*quantity(y.loss_percent).d-quantity(y.loss_percent).n,d:100n*quantity(y.loss_percent).d}));if(compare(expected,quantity(y.finished_weight))!==0)warnings.push(`Expected loss predicts ${exact(expected)} g finished weight; the entered finished weight differs.`);}
    if(!unknown&&y.batch_weight&&compare(raw,quantity(y.batch_weight))!==0)warnings.push(`Ingredient mass totals ${exact(raw)} g; the entered raw batch weight differs.`);
  }catch{/* Field validation supplies invalid-value messages. */}
  return {raw_weight:exact(raw),complete:unknown===0,warnings};
}
export function scaledCopy(doc,variantId,factor,{mode='multiplier',target=null}={}) {
  const result=clone(doc),source=result.variants.find(v=>v.id===variantId);if(!source)throw Error('Choose a size.');
  const f=quantity(factor);if(!f.n)throw Error('Scaling quantity must be positive.');
  source.groups=scaleIngredients(source.groups,f).map(g=>({...g,ingredients:g.ingredients.map(r=>{
    const {base_quantity,scaled_quantity,scaled_display,...row}=r;return {...row,quantity:scaled_display};
  })}));
  source.yield=scaledYield(source.yield,f,{mode,target});
  if(source.costing?.mode==='saleable'&&mode!=='portion'){
    source.costing.saleable_yield=exact(multiply(quantity(source.costing.saleable_yield),f));
    if(source.costing.price_basis==='batch')source.costing.selling_price=exact(multiply(quantity(source.costing.selling_price),f));
  }
  for(const c of source.components)c.quantity=exact(multiply(quantity(c.quantity),f));
  for(const c of source.additional_costs)if(c.per_batch!==false){c.amount=exact(multiply(quantity(c.amount),f));if(c.resource_id&&c.quantity)c.quantity=exact(multiply(quantity(c.quantity),f));}
  result.variants=[freshVariant(source,source.name)];result.name=`${doc.name} × ${exact(f)}`;return result;
}
export function differences(before,after,path='') {
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  if(before && after && typeof before==='object' && typeof after==='object') {
    const keys=new Set([...Object.keys(before),...Object.keys(after)]);
    return [...keys].flatMap(key=>differences(before[key],after[key],path?`${path}.${key}`:key));
  }return [{field:path,before:before??null,after:after??null}];
}
export function applyVariation(base,overrides) {
  const doc=clone(base);
  for(const change of overrides) {
    const v=doc.variants.find(v=>v.id===change.variant_id);if(!v)throw Error('Variation size no longer exists.');
    const g=v.groups.find(g=>g.id===change.group_id);if(!g)throw Error('Variation ingredient group no longer exists.');
    const index=g.ingredients.findIndex(r=>r.id===change.row_id);
    if(change.action==='add'){g.ingredients.push({...clone(change.ingredient),id:change.row_id||id()});continue;}
    if(index<0)throw Error('Variation ingredient no longer exists.');
    if(change.action==='remove')g.ingredients.splice(index,1);
    else if(change.action==='replace')g.ingredients[index]={...g.ingredients[index],...clone(change.ingredient),id:change.row_id};
    else throw Error('Unknown ingredient variation action.');
  }return doc;
}
export function csvTotals(totals) {
  const escape=value=>`"${String(value??'').replace(/^[=+@\-]/,"'$&").replaceAll('"','""')}"`;
  return '\uFEFF'+[['Ingredient','Brand','Quantity','Unit'],...totals.map(r=>[r.name,r.brand,r.display,r.unit])].map(row=>row.map(escape).join(',')).join('\r\n');
}
export function csvIngredients(doc,variantId,factor='1') {
  const v=doc.variants.find(v=>v.id===variantId);if(!v)throw Error('Choose a size.');return csvTotals(ingredientTotals(v.groups,factor));
}
export async function productionPlan(record,variantId,factor,{loadRecipe,wholeComponents=false}={}){
  const groups=[],components=[],preparations=[],cache=new Map();
  async function expand(current,sizeId,multiplier,path,depth=0,need=null){
    if(depth>32)throw Error('Component nesting exceeds 32 levels.');
    const key=`${current.version_id}:${sizeId}`;if(path.has(key))throw Error('Component cycle detected.');const nextPath=new Set([...path,key]);
    const v=current.document.variants.find(v=>v.id===sizeId);if(!v)throw Error('A linked component size no longer exists in the saved version.');
    preparations.push({record:current,variant_id:sizeId,factor:exact(multiplier),depth,need});
    for(const g of scaleIngredients(v.groups,multiplier))groups.push({...g,name:depth?`${current.document.name} · ${g.name}`:g.name,ingredients:g.ingredients.map(row=>({...row,quantity:row.scaled_display}))});
    for(const link of v.components||[]){
      if(!loadRecipe)throw Error('Load linked recipes before calculating production totals.');
      let child=cache.get(link.version_id);if(!child){child=await loadRecipe(link,current);cache.set(link.version_id,child);}
      const childVariant=child.document.variants.find(v=>v.id===link.variant_id)||(!link.variant_id?child.document.variants[0]:null);
      if(!childVariant)throw Error('Component size was not found.');
      const required=multiply(quantity(link.quantity),multiplier),plan=componentPlan(childVariant.yield.quantity,required,{wholeBatches:wholeComponents});
      components.push({name:child.document.name,version:child.version,version_id:child.version_id,variant_id:childVariant.id,unit:childVariant.yield.unit,required:exact(required),batches:exact(plan.batches),produced:exact(plan.produced),leftover:exact(plan.leftover)});
      await expand(child,childVariant.id,quantity(plan.batches),nextPath,depth+1,{required:exact(required),leftover:exact(plan.leftover),unit:childVariant.yield.unit});
    }
  }
  await expand(record,variantId,quantity(factor),new Set());return {groups,components,preparations,totals:ingredientTotals(groups)};
}
