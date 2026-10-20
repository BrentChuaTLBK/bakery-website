import {inputQuantity,exact,unitInfo} from './recipe-math.js?v=kitchen-controls-20261021-1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const standardUnits=['g','kg','mg','ml','l','pc'];

export function readUnitConversions(rows){
 const entries=[],seen=new Set();
 for(const row of rows){
  const from=String(row.from??'').trim().toLowerCase(),unit=String(row.unit??'').trim().toLowerCase();
  if(!from||from.length>40||!unitInfo(from).dimension.startsWith('custom:'))throw Error('Enter a recipe measure such as tsp, tbsp, cup or bag. Standard units already convert automatically.');
  if(seen.has(from))throw Error(`Only enter one equivalent for ${from}.`);
  if(!unit||unitInfo(unit).dimension.startsWith('custom:'))throw Error('Choose g, kg, mg, ml, l or pc for the equivalent quantity.');
  const amount=inputQuantity(row.quantity);if(!amount.n)throw Error('Equivalent quantity must be greater than zero.');
  entries.push([from,{quantity:exact(amount),unit}]);seen.add(from);
 }
 return Object.fromEntries(entries);
}

export function mountUnitConversions(container,conversions={}){
 container.innerHTML=`<h3>Recipe unit equivalents · optional</h3><p class="recipe-muted">Keep buying in your usual unit. Enter how much one recipe measure equals for this ingredient—for example, weigh one level tsp and enter its grams. This applies only to this ingredient. Standard units such as kg and g already convert automatically.</p><div data-conversion-rows></div><button type="button" data-conversion-add>Add equivalent unit</button><p class="recipe-muted">Changes update current recipe costs. Saved historical costs stay unchanged.</p>`;
 const list=container.querySelector('[data-conversion-rows]');
 function add(from='',conversion={}){
  const row=document.createElement('div');row.className='recipe-unit-equivalent';
  // Keep saved standard aliases visible until the owner chooses a replacement.
  const units=[...new Set([...standardUnits,conversion.unit||'g'])];
  row.innerHTML=`<label>1 recipe unit<input data-conversion-from value="${esc(from)}" placeholder="e.g. tsp" maxlength="40" aria-label="Recipe unit"></label><span class="recipe-equivalent-equals" aria-hidden="true">=</span><label>Equivalent quantity<input data-conversion-quantity value="${esc(conversion.quantity||'')}" placeholder="Measured amount" aria-label="Equivalent quantity"></label><label>Equivalent unit<select data-conversion-unit aria-label="Equivalent unit">${units.map(unit=>`<option value="${esc(unit)}" ${unit===(conversion.unit||'g')?'selected':''}>${esc(unit)}</option>`).join('')}</select></label><button type="button" class="danger" data-conversion-remove aria-label="Remove equivalent unit">Remove</button>`;
  list.append(row);return row;
 }
 for(const [unit,conversion]of Object.entries(conversions))add(unit,conversion);
 container.querySelector('[data-conversion-add]').addEventListener('click',()=>add().querySelector('input').focus());
 list.addEventListener('click',event=>{const button=event.target.closest('[data-conversion-remove]');if(button)button.closest('.recipe-unit-equivalent').remove();});
 return {read:()=>readUnitConversions([...list.children].map(row=>({from:row.querySelector('[data-conversion-from]').value,quantity:row.querySelector('[data-conversion-quantity]').value,unit:row.querySelector('[data-conversion-unit]').value})))};
}
