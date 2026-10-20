import {inputQuantity,exact,ingredientCost,divide,add} from './recipe-math.js?v=kitchen-controls-20261021-1';
import {unitOptionsMarkup} from './recipe-units.js?v=teaspoon-fractions-20261019-1';
import {resourceMoney} from './recipe-resource-table.js?v=multi-source-20261021-1';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function mountLinkedIngredient(container,{record,api,onMode}){
 const saved=record?.data?.yield_source,rows=[];
 let nextRow=0,previewSequence=0,previewTimer;
 container.innerHTML=`<h3>Costing source</h3>
  <label>Calculate cost from<select data-yield-mode><option value="purchase">Purchase prices</option><option value="linked" ${saved?'selected':''}>Linked ingredient yield</option></select></label>
  <div data-yield-fields ${saved?'':'hidden'}>
   <p class="recipe-muted">Add the ingredients used in one batch, then enter the measured yield. Source price changes update the combined cost automatically.</p>
   <div data-yield-rows></div>
   <button type="button" data-yield-add>+ Add ingredient</button>
   <div class="recipe-fields two">
    <label>Produces<input data-yield-quantity value="${esc(saved?.yield_quantity||'')}" placeholder="Measured batch yield"></label>
    <label>Yield unit<select data-yield-unit>${unitOptionsMarkup(saved?.yield_unit||record?.data?.default_unit||'g')}</select></label>
   </div>
   <p data-yield-preview class="recipe-yield-preview" role="status">Choose source ingredients and enter the measured batch yield.</p>
   <p class="recipe-muted">The full cost of all source quantities is assigned to this yield. Saved historical recipe costs stay unchanged.</p>
  </div>`;
 const field=selector=>container.querySelector(`[data-yield-${selector}]`),mode=field('mode'),preview=field('preview'),list=field('rows');
 const live=()=>container.isConnected&&container.closest('dialog')?.open!==false;
 function read(){
  if(mode.value!=='linked')return null;
  const sources=rows.map(row=>{
   if(!row.selected)throw Error('Select a saved source ingredient from the search results for each row.');
   const amount=inputQuantity(row.field('source-quantity').value);
   if(!amount.n)throw Error('Source quantity and yield must be greater than zero.');
   const unit=row.field('source-unit').value;if(!unit)throw Error('Choose a source unit for each ingredient.');
   return {ingredient_id:row.selected.id,source_quantity:exact(amount),source_unit:unit};
  });
  if(new Set(sources.map(s=>s.ingredient_id)).size!==sources.length)throw Error('Only add each source ingredient once.');
  const amount=inputQuantity(field('quantity').value);
  if(!amount.n)throw Error('Source quantity and yield must be greater than zero.');
  if(!field('unit').value)throw Error('Choose a yield unit.');
  // Keep existing one-ingredient records and older backup consumers compatible.
  return {...(sources.length===1?sources[0]:{sources}),yield_quantity:exact(amount),yield_unit:field('unit').value};
 }
 async function refresh(){
  const ticket=++previewSequence;if(mode.value!=='linked')return;
  try{
   const link=read(),inputs=link.sources||[link];
   const sources=await Promise.all(inputs.map(input=>api('ingredient_yield_source',{id:input.ingredient_id,unit:input.source_unit})));
   if(ticket!==previewSequence||!live())return;
   let total=inputQuantity('0');const missing=[];
   sources.forEach((source,index)=>{
    const input=inputs[index],cost=source.price&&ingredientCost({quantity:input.source_quantity,unit:input.source_unit},source.price,source.data.unit_conversions);
    if(cost)total=add(total,cost);else missing.push(source.name);
   });
   preview.textContent=missing.length?`Cost unavailable for ${missing.join(', ')}. Add a price or the required unit equivalent to each source ingredient.`
    :`Batch cost: ${resourceMoney(total)} · Produces ${link.yield_quantity} ${link.yield_unit} · ${resourceMoney(divide(total,inputQuantity(link.yield_quantity)))} / ${link.yield_unit}.`;
  }catch(error){if(ticket===previewSequence&&live())preview.textContent=error.message;}
 }
 function schedule(){++previewSequence;clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(live())refresh();},180);}
 function updateRows(){
  rows.forEach((row,index)=>{
   row.el.querySelector('[data-source-title]').textContent=`Ingredient ${index+1}`;
   row.field('remove').disabled=rows.length===1||mode.value!=='linked';
   row.field('remove').setAttribute('aria-label',`Remove source ingredient ${index+1}`);
  });
  field('add').disabled=rows.length>=50||mode.value!=='linked';
 }
 function addRow(input={}){
  const id=++nextRow,el=document.createElement('section');
  el.className='recipe-yield-source-row';el.dataset.yieldRow='';
  el.innerHTML=`<div class="recipe-yield-source-heading"><strong data-source-title></strong><button type="button" class="danger" data-yield-remove>Remove</button></div>
   <div class="recipe-yield-search"><label for="recipe-yield-search-${id}">Source ingredient</label><input id="recipe-yield-search-${id}" data-yield-search role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="recipe-yield-options-${id}" placeholder="Search saved ingredients" autocomplete="off">
    <div id="recipe-yield-options-${id}" class="recipe-ingredient-options" role="listbox" aria-label="Source ingredients" hidden></div>
   </div><div class="recipe-fields two">
    <label>Source quantity<input data-yield-source-quantity value="${esc(input.source_quantity||'1')}" placeholder="e.g. 1"></label>
    <label>Source unit<select data-yield-source-unit>${unitOptionsMarkup(input.source_unit||'pcs')}</select></label>
   </div>`;
  const row={el,selected:input.ingredient_id?{id:input.ingredient_id}:null,field:selector=>el.querySelector(`[data-yield-${selector}]`)};
  rows.push(row);list.append(el);
  const search=row.field('search'),options=el.querySelector('[role=listbox]');
  let choices=[],highlight=-1,searchSequence=0,loadSequence=0,searchTimer;
  const rowLive=()=>live()&&rows.includes(row);
  function sourceUnits(source,current){
   const select=row.field('source-unit');select.innerHTML=unitOptionsMarkup(current);
   for(const unit of Object.keys(source.data?.unit_conversions||{}))if(![...select.options].some(option=>option.value===unit))select.add(new Option(unit,unit));
  }
  function closeOptions(){++searchSequence;clearTimeout(searchTimer);options.hidden=true;search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');choices=[];highlight=-1;}
  row.close=closeOptions;
  function choose(index){
   const source=choices[index];if(!source)return;
   ++loadSequence;row.selected=source;search.value=source.name;closeOptions();
   sourceUnits(source,source.data?.default_unit||source.price?.unit||'pcs');
   schedule();row.field('source-quantity').focus();
  }
  function queue(){
   closeOptions();const ticket=searchSequence,query=search.value;
   options.innerHTML='<p role="status">Searching ingredients…</p>';options.hidden=false;search.setAttribute('aria-expanded','true');
   searchTimer=setTimeout(async()=>{
    try{
     const result=await api('resources',{kind:'ingredient',query,limit:20});
     if(ticket!==searchSequence||!rowLive()||document.activeElement!==search)return;
     choices=result.rows.filter(r=>r.id!==record?.id&&r.active!==false&&!r.deleted_at&&!rows.some(other=>other!==row&&other.selected?.id===r.id));
     options.innerHTML=choices.length?choices.map((r,i)=>`<button type="button" role="option" id="recipe-yield-option-${id}-${i}" aria-selected="false" data-yield-choice="${i}" tabindex="-1"><strong>${esc(r.name)}</strong><span>${esc([r.data?.brand,r.data?.default_unit,r.data?.yield_source?'Linked ingredient':''].filter(Boolean).join(' · '))}</span></button>`).join(''):'<p role="status">No matching unused ingredients. Add the source ingredient to Ingredients first.</p>';
    }catch(error){if(ticket===searchSequence&&rowLive())options.innerHTML=`<p role="status">${esc(error.message)}</p>`;}
   },200);
  }
  search.addEventListener('focus',queue);
  search.addEventListener('input',()=>{++loadSequence;row.selected=null;++previewSequence;preview.textContent='Select a saved source ingredient from the search results.';queue();});
  search.addEventListener('blur',closeOptions);
  options.addEventListener('pointerdown',event=>event.preventDefault());
  options.addEventListener('click',event=>{const option=event.target.closest('[data-yield-choice]');if(option)choose(Number(option.dataset.yieldChoice));});
  search.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeOptions();}
   else if(['ArrowDown','ArrowUp'].includes(event.key)){
    event.preventDefault();if(options.hidden){queue();return;}if(!choices.length)return;
    highlight=event.key==='ArrowDown'?(highlight+1)%choices.length:(highlight<=0?choices.length:highlight)-1;
    for(const [index,button]of [...options.children].entries())button.setAttribute('aria-selected',String(index===highlight));
    const active=options.children[highlight];search.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});
   }else if(event.key==='Enter'){event.preventDefault();if(highlight>=0)choose(highlight);}
  });
  row.field('remove').addEventListener('click',()=>{
   if(rows.length===1)return;const index=rows.indexOf(row);closeOptions();rows.splice(index,1);el.remove();updateRows();schedule();
   rows[Math.min(index,rows.length-1)].field('search').focus();
  });
  if(input.ingredient_id){
   const ticket=loadSequence;search.placeholder='Loading source ingredient…';
   api('ingredient_yield_source',{id:input.ingredient_id,unit:input.source_unit}).then(source=>{
    if(ticket!==loadSequence||!rowLive())return;
    row.selected=source;search.value=source.name;sourceUnits(source,row.field('source-unit').value);schedule();
   }).catch(error=>{if(ticket===loadSequence&&rowLive()){row.selected=null;preview.textContent=error.message;}});
  }
  updateRows();return row;
 }
 function syncMode(){
  rows.forEach(row=>row.close());++previewSequence;
  field('fields').hidden=mode.value!=='linked';
  for(const control of field('fields').querySelectorAll('input,select,button'))control.disabled=mode.value!=='linked';
  updateRows();onMode(mode.value==='linked');if(mode.value==='linked')schedule();
 }
 for(const input of saved?(saved.sources||[saved]):[{}])addRow(input);
 field('add').addEventListener('click',()=>{if(rows.length<50){addRow().field('search').focus();schedule();}});
 mode.addEventListener('change',syncMode);
 for(const name of ['input','change'])field('fields').addEventListener(name,event=>{if(!event.target.matches('[data-yield-search]'))schedule();});
 syncMode();return {read};
}
