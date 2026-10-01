import {setUnitSelection} from './recipe-units.js?v=approved-20261002-1';
import {convert,exact,unitInfo} from './recipe-math.js?v=approved-20261002-1';
import {resourceMoney,resourceUnitCost} from './recipe-resource-table.js?v=approved-20261002-1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function selectRecipeIngredient(row,resource){
 const unit=resource.data?.default_unit||(resource.price?.unit?unitInfo(resource.price.unit).canonical:row.unit)||'g';
 // Linking an imported formula must not turn, for example, three eggs into
 // three grams. Convert compatible units; retain the recipe unit otherwise.
 if(String(row.quantity??'').trim()&&row.unit&&row.unit!==unit){
  try{row.quantity=exact(convert(row.quantity,row.unit,unit));row.unit=unit;}catch{/* Keep the original formula unit. */}
 }else row.unit=unit;
 row.name=resource.name;row.ingredient_id=resource.id;row.brand=resource.data?.brand||'';
 delete row.cost_snapshot;
 if(resource.price)row.cost_snapshot={...resource.price,amount:String(resource.price.amount),quantity:String(resource.price.quantity)};
 return row;
}
export function unlinkRecipeIngredient(row){delete row.ingredient_id;delete row.cost_snapshot;row.brand='';}
export function ingredientLinkText(row){
 if(!row.ingredient_id)return 'Select from Ingredients to link costing.';
 const cost=resourceUnitCost({price:row.cost_snapshot});
 return ['Linked',cost?`${resourceMoney(cost.amount,cost.currency,4)} / ${cost.basis}`:'Price not set in Ingredients'].filter(Boolean).join(' · ');
}
export function ingredientPickerMarkup(row,prefix){
 const id=`recipe-ingredient-${row.id}`,listId=`${id}-options`;
 return `<div class="recipe-ingredient-picker"><label for="${esc(id)}">Ingredient</label><div class="recipe-ingredient-identity"><input id="${esc(id)}" data-path="${esc(prefix)}.name" data-ingredient-search value="${esc(row.name)}" placeholder="Type and select an ingredient…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="${esc(listId)}" aria-expanded="false" aria-describedby="${esc(id)}-brand ${esc(id)}-link"><span id="${esc(id)}-brand" data-ingredient-brand class="recipe-ingredient-brand">${esc(row.brand||'No brand specified')}</span></div><p id="${esc(id)}-link" data-ingredient-link class="recipe-ingredient-link">${esc(ingredientLinkText(row))}</p><div id="${esc(listId)}" class="recipe-ingredient-options" role="listbox" aria-label="Saved ingredients" hidden></div></div>`;
}

export function mountIngredientPicker(root,{api,getRow,onChange}){
 let input=null,choices=[],selected=-1,timer,request=0;
 const context=new Map();let contextGeneration=0;
 function update(target){const row=getRow(target),picker=target.closest('.recipe-ingredient-picker');if(!row||!picker)return;const resource=context.get(row.ingredient_id),supplier=resource?.suppliers?.find(s=>s.supplier_id===resource.price?.supplier_id),brand=picker.querySelector('[data-ingredient-brand]');brand.textContent=row.brand||resource?.data?.brand||'No brand specified';brand.title=!row.brand&&resource?.data?.brand?'Brand from the linked ingredient catalog':'';picker.querySelector('[data-ingredient-link]').textContent=resource?`Current supplier: ${supplier?.name||(resource.price?'Unassigned':'no active quote')} · ${ingredientLinkText({...row,cost_snapshot:resource.price})}`:ingredientLinkText(row);}
 async function hydrate(){
  const generation=contextGeneration,targets=[...root.querySelectorAll('[data-ingredient-search]')],pending=new Map();
  for(const target of targets){const row=getRow(target);if(row?.ingredient_id&&!context.has(row.ingredient_id))pending.set(row.ingredient_id,row.name);else update(target);}
  const entries=[...pending];let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,entries.length)},async()=>{while(cursor<entries.length){const [id,name]=entries[cursor++];try{const result=await api('resources',{kind:'ingredient',query:name,limit:100,include_inactive:true});if(generation!==contextGeneration)return;context.set(id,result.rows.find(r=>r.id===id)||null);}catch{/* Preserve the saved link hint when offline. */}for(const target of targets)if(target.isConnected&&getRow(target)?.ingredient_id===id)update(target);}}));
 }
 const box=()=>input?.closest('.recipe-ingredient-picker');
 const list=()=>box()?.querySelector('[role=listbox]');
 function close(){clearTimeout(timer);request++;const options=list();if(options)options.hidden=true;input?.setAttribute('aria-expanded','false');input?.removeAttribute('aria-activedescendant');choices=[];selected=-1;}
 function message(text){const options=list();if(!options)return;options.innerHTML=`<p role="status">${esc(text)}</p>`;options.hidden=false;input.setAttribute('aria-expanded','true');}
 function highlight(index){selected=index;const options=list();for(const [i,option]of [...options.querySelectorAll('[role=option]')].entries())option.setAttribute('aria-selected',String(i===index));const active=options.querySelector(`[data-ingredient-choice="${index}"]`);if(active){input.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}}
 async function search(target,query,token){
  try{
   const result=await api('resources',{kind:'ingredient',query,limit:20});
   if(token!==request||input!==target||!target.isConnected||document.activeElement!==target)return;
   choices=result.rows.filter(r=>r.active!==false&&!r.deleted_at);selected=-1;
   if(!choices.length){message('No matching ingredients. Add it in Ingredients to link its cost.');return;}
   const options=list();options.innerHTML=choices.map((r,i)=>{const cost=resourceUnitCost(r),detail=[r.data?.brand,r.data?.default_unit,cost?`${resourceMoney(cost.amount,cost.currency,4)} / ${cost.basis}`:'Price not set'].filter(Boolean).join(' · ');return `<button type="button" role="option" aria-selected="false" id="${esc(options.id)}-${i}" data-ingredient-choice="${i}" tabindex="-1"><strong>${esc(r.name)}</strong><span>${esc(detail)}</span></button>`;}).join('');options.hidden=false;input.setAttribute('aria-expanded','true');
  }catch{if(token===request&&target.isConnected)message('Ingredient list could not load. Type again to retry.');}
 }
 function queue(target){close();input=target;const token=request;message('Searching ingredients…');timer=setTimeout(()=>search(target,target.value,token),200);}
 function choose(index){
  const resource=choices[index],target=input,row=target&&getRow(target);if(!resource||!row||!target.isConnected)return;
  selectRecipeIngredient(row,resource);context.set(resource.id,resource);target.value=row.name;update(target);
  const editor=target.closest('[data-ingredient-row]'),qty=editor.querySelector('[data-path$=".quantity"]');qty.value=row.quantity;setUnitSelection(editor.querySelector('[data-path$=".unit"]'),row.unit);
  const brand=editor.querySelector('[data-path$=".brand"]');if(brand){brand.value=row.brand;brand.readOnly=true;}close();onChange();qty.focus();
 }
 root.addEventListener('focusin',event=>{if(event.target.matches('[data-ingredient-search]'))queue(event.target);});
 root.addEventListener('input',event=>{const target=event.target;if(target.matches('[data-path$=".brand"]')){const search=target.closest('[data-ingredient-row]').querySelector('[data-ingredient-search]');getRow(search).brand=target.value;update(search);return;}if(!target.matches('[data-ingredient-search]'))return;const row=getRow(target);unlinkRecipeIngredient(row);const brand=target.closest('[data-ingredient-row]').querySelector('[data-path$=".brand"]');if(brand){brand.value='';brand.readOnly=false;}update(target);onChange();queue(target);});
 root.addEventListener('pointerdown',event=>{if(event.target.closest('[data-ingredient-choice]'))event.preventDefault();});
 root.addEventListener('click',event=>{const option=event.target.closest('[data-ingredient-choice]');if(option)choose(Number(option.dataset.ingredientChoice));});
 root.addEventListener('focusout',event=>{if(event.target===input)close();});
 root.addEventListener('keydown',event=>{
  if(event.target!==input)return;
  if(event.key==='Escape'){event.preventDefault();close();}
  else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(list()?.hidden){queue(input);return;}if(choices.length)highlight(event.key==='ArrowDown'?(selected+1)%choices.length:(selected<=0?choices.length:selected)-1);}
  else if(event.key==='Enter'){event.preventDefault();if(selected>=0)choose(selected);}
 });
 return {close,hydrate,clear:()=>{contextGeneration++;context.clear();}};
}
