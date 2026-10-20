import {inputQuantity,exact,unitInfo} from './recipe-math.js?v=piece-equivalents-20261021-1';
import {unitOptions} from './recipe-units.js?v=teaspoon-fractions-20261019-1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const standardUnits=['g','kg','mg','ml','l','pc'];

export function readUnitConversions(rows){
 const entries=[],seen=new Set();
 for(const row of rows){
  const from=String(row.from??'').trim().toLowerCase(),unit=String(row.unit??'').trim().toLowerCase();
  if(!from||from.length>40||['mass','volume'].includes(unitInfo(from).dimension))throw Error('Choose pieces or a recipe measure such as tsp, tbsp, cup or bag. Weight and volume units already convert automatically.');
  const key=unitInfo(from).canonical;
  if(seen.has(key))throw Error(`Only enter one equivalent for ${from}.`);
  if(!unit||unitInfo(unit).dimension.startsWith('custom:'))throw Error('Choose g, kg, mg, ml, l or pc for the equivalent quantity.');
  if(unitInfo(from).dimension==='count'&&unitInfo(unit).dimension==='count')throw Error('Enter the weight or volume of one piece.');
  const amount=inputQuantity(row.quantity);if(!amount.n)throw Error('Equivalent quantity must be greater than zero.');
  entries.push([from,{quantity:exact(amount),unit}]);seen.add(key);
 }
 return Object.fromEntries(entries);
}

export function mountUnitConversions(container,conversions={}){
 container.innerHTML=`<h3>Recipe unit equivalents · optional</h3><p class="recipe-muted">Keep buying in your usual unit. Set an equivalent for this ingredient—for example, 1 egg white (pcs) = 30 g, or 1 tsp of salt = 6 g. Costing works in either direction. Standard units such as kg and g already convert automatically.</p><div data-conversion-rows></div><button type="button" data-conversion-add>Add equivalent unit</button><p class="recipe-muted">Changes update current recipe costs. Saved historical costs stay unchanged.</p>`;
 const list=container.querySelector('[data-conversion-rows]');
 function add(from='',conversion={}){
  const row=document.createElement('div');row.className='recipe-unit-equivalent';
  // Keep saved standard aliases visible until the owner chooses a replacement.
  const units=[...new Set([...standardUnits,conversion.unit||'g'])];
  const measures=unitOptions(from).filter(([unit])=>!unit||!['mass','volume'].includes(unitInfo(unit).dimension)||unit===from);
  row.innerHTML=`<label>1 recipe unit<select data-conversion-from aria-label="Recipe unit">${measures.map(([unit,label])=>`<option value="${esc(unit)}" ${unit===from?'selected':''}>${esc(label)}</option>`).join('')}</select></label><span class="recipe-equivalent-equals" aria-hidden="true">=</span><label>Equivalent quantity<input data-conversion-quantity value="${esc(conversion.quantity||'')}" placeholder="Measured amount" aria-label="Equivalent quantity"></label><label>Equivalent unit<select data-conversion-unit aria-label="Equivalent unit">${units.map(unit=>`<option value="${esc(unit)}" ${unit===(conversion.unit||'g')?'selected':''}>${esc(unit)}</option>`).join('')}</select></label><button type="button" class="danger" data-conversion-remove aria-label="Remove equivalent unit">Remove</button>`;
  const fromSelect=row.querySelector('[data-conversion-from]'),unitSelect=row.querySelector('[data-conversion-unit]');
  function refreshTargets(){
   const piece=fromSelect.value&&unitInfo(fromSelect.value).dimension==='count',current=unitSelect.value;
   const allowed=units.filter(unit=>!piece||unitInfo(unit).dimension!=='count');
   unitSelect.innerHTML=allowed.map(unit=>`<option value="${esc(unit)}">${esc(unit)}</option>`).join('');
   unitSelect.value=allowed.includes(current)?current:'g';
  }
  fromSelect.addEventListener('change',refreshTargets);refreshTargets();
  list.append(row);return row;
 }
 for(const [unit,conversion]of Object.entries(conversions))add(unit,conversion);
 container.querySelector('[data-conversion-add]').addEventListener('click',()=>add().querySelector('[data-conversion-from]').focus());
 list.addEventListener('click',event=>{const button=event.target.closest('[data-conversion-remove]');if(button)button.closest('.recipe-unit-equivalent').remove();});
 return {read:()=>readUnitConversions([...list.children].map(row=>({from:row.querySelector('[data-conversion-from]').value,quantity:row.querySelector('[data-conversion-quantity]').value,unit:row.querySelector('[data-conversion-unit]').value})))};
}
