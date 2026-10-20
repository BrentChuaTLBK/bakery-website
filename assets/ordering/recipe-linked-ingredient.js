import {inputQuantity,exact,ingredientCost,divide} from './recipe-math.js?v=kitchen-controls-20261021-1';
import {unitOptionsMarkup} from './recipe-units.js?v=teaspoon-fractions-20261019-1';
import {resourceMoney} from './recipe-resource-table.js?v=linked-ingredients-20261021-1';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function mountLinkedIngredient(container,{record,api,onMode}){
 const saved=record?.data?.yield_source;
 let selected=null,choices=[],highlight=-1,searchSequence=0,previewSequence=0,searchTimer,previewTimer;
 container.innerHTML=`<h3>Costing source</h3>
  <label>Calculate cost from<select data-yield-mode><option value="purchase">Purchase prices</option><option value="linked" ${saved?'selected':''}>Linked ingredient yield</option></select></label>
  <div data-yield-fields ${saved?'':'hidden'}>
   <p class="recipe-muted">Use an ingredient you already buy. Enter how much you use and the amount it produces—for example, 1 pc Lemon produces your measured grams of juice. Its purchase price updates this ingredient’s cost automatically.</p>
   <div class="recipe-yield-search"><label for="recipe-yield-search">Source ingredient</label><input id="recipe-yield-search" data-yield-search role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="recipe-yield-options" placeholder="Search saved ingredients" autocomplete="off">
    <div id="recipe-yield-options" class="recipe-ingredient-options" role="listbox" aria-label="Source ingredients" hidden></div>
   </div>
   <div class="recipe-fields two">
    <label>Source quantity<input data-yield-source-quantity value="${esc(saved?.source_quantity||'1')}" placeholder="e.g. 1"></label>
    <label>Source unit<select data-yield-source-unit>${unitOptionsMarkup(saved?.source_unit||'pcs')}</select></label>
    <label>Produces<input data-yield-quantity value="${esc(saved?.yield_quantity||'')}" placeholder="Measured yield"></label>
    <label>Yield unit<select data-yield-unit>${unitOptionsMarkup(saved?.yield_unit||record?.data?.default_unit||'g')}</select></label>
   </div>
   <p data-yield-preview class="recipe-yield-preview" role="status">Choose a source ingredient and enter its measured yield.</p>
   <p class="recipe-muted">The full cost of the source quantity is assigned to this yield. Saved historical recipe costs stay unchanged.</p>
  </div>`;
 const field=selector=>container.querySelector(`[data-yield-${selector}]`),mode=field('mode'),search=field('search'),options=container.querySelector('[role=listbox]'),preview=field('preview');
 const live=()=>container.isConnected&&container.closest('dialog')?.open!==false;
 function sourceUnits(source,current){
  const select=field('source-unit');select.innerHTML=unitOptionsMarkup(current);
  for(const unit of Object.keys(source.data?.unit_conversions||{}))if(![...select.options].some(option=>option.value===unit))select.add(new Option(unit,unit));
 }
 function closeOptions(){++searchSequence;clearTimeout(searchTimer);options.hidden=true;search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');choices=[];highlight=-1;}
 function read(){
  if(mode.value!=='linked')return null;
  if(!selected)throw Error('Select a saved source ingredient from the search results.');
  const source=inputQuantity(field('source-quantity').value),yieldAmount=inputQuantity(field('quantity').value);
  if(!source.n||!yieldAmount.n)throw Error('Source quantity and yield must be greater than zero.');
  return {ingredient_id:selected.id,source_quantity:exact(source),source_unit:field('source-unit').value,yield_quantity:exact(yieldAmount),yield_unit:field('unit').value};
 }
 async function refresh(){
  const ticket=++previewSequence;
  if(mode.value!=='linked'||!selected)return;
  try{
   const link=read(),source=await api('ingredient_yield_source',{id:link.ingredient_id,unit:link.source_unit});
   if(ticket!==previewSequence||!live())return;
   const cost=source.price&&ingredientCost({quantity:link.source_quantity,unit:link.source_unit},source.price,source.data.unit_conversions);
   preview.textContent=`${link.source_quantity} ${link.source_unit} ${source.name} → ${link.yield_quantity} ${link.yield_unit}. `+
    (cost?`${resourceMoney(divide(cost,inputQuantity(link.yield_quantity)))} / ${link.yield_unit}.`:
     'Cost unavailable. Add a price or the required unit equivalent to the source ingredient.');
  }catch(error){if(ticket===previewSequence&&live())preview.textContent=error.message;}
 }
 function schedule(){++previewSequence;clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(live())refresh();},180);}
 function syncMode(){
  closeOptions();++previewSequence;
  field('fields').hidden=mode.value!=='linked';
  for(const control of field('fields').querySelectorAll('input,select'))control.disabled=mode.value!=='linked';
  onMode(mode.value==='linked');if(mode.value==='linked')schedule();
 }
 function choose(index){
  const source=choices[index];if(!source)return;
  selected=source;search.value=source.name;closeOptions();
  sourceUnits(source,source.data?.default_unit||source.price?.unit||'pcs');
  schedule();field('source-quantity').focus();
 }
 function queue(){
  closeOptions();const ticket=searchSequence,query=search.value;
  options.innerHTML='<p role="status">Searching ingredients…</p>';options.hidden=false;search.setAttribute('aria-expanded','true');
  searchTimer=setTimeout(async()=>{
   try{
    const result=await api('resources',{kind:'ingredient',query,limit:20});
    if(ticket!==searchSequence||!live()||document.activeElement!==search)return;
    choices=result.rows.filter(r=>r.id!==record?.id&&r.active!==false&&!r.deleted_at);
    options.innerHTML=choices.length?choices.map((r,i)=>`<button type="button" role="option" id="recipe-yield-option-${i}" aria-selected="false" data-yield-choice="${i}" tabindex="-1"><strong>${esc(r.name)}</strong><span>${esc([r.data?.brand,r.data?.default_unit,r.data?.yield_source?'Linked ingredient':''].filter(Boolean).join(' · '))}</span></button>`).join(''):'<p role="status">No matching ingredients. Add the source ingredient to Ingredients first.</p>';
   }catch(error){if(ticket===searchSequence&&live())options.innerHTML=`<p role="status">${esc(error.message)}</p>`;}
  },200);
 }
 search.addEventListener('focus',queue);
 search.addEventListener('input',()=>{selected=null;++previewSequence;preview.textContent='Select a saved source ingredient from the search results.';queue();});
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
 mode.addEventListener('change',syncMode);
 field('fields').addEventListener('input',event=>{if(event.target!==search)schedule();});
 field('fields').addEventListener('change',event=>{if(event.target!==search)schedule();});
 syncMode();
 if(saved){
  const ticket=searchSequence;
  api('ingredient_yield_source',{id:saved.ingredient_id,unit:saved.source_unit}).then(source=>{
   if(ticket!==searchSequence||!live())return;
   selected=source;search.value=source.name;sourceUnits(source,saved.source_unit);refresh();
  }).catch(error=>{if(ticket===searchSequence&&live())preview.textContent=error.message;});
 }
 return {read};
}
