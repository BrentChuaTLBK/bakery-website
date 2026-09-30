import {ingredientCost,displayQuantity,compare} from './recipe-math.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountSupplierQuotes(container,{record,suppliers,defaultUnit}){
 const available=id=>!id||suppliers.some(s=>s.id===id);
 let offers=structuredClone(record?.suppliers||[]).filter(o=>available(o.supplier_id)),preferred=record?.data?.preferred_supplier_id||'';
 if(!available(preferred))preferred='';
 if(record?.unassigned_price&&record?.data?.allow_unassigned_price!==false)offers.push({supplier_id:'',price:record.unassigned_price});
 if(!offers.length){const id=record?.price?.supplier_id||record?.data?.supplier_id||'';offers=[{supplier_id:available(id)?id:'',price:available(record?.price?.supplier_id)?record?.price||{}:{}}];}
 const form=container.closest('form');
 function read(){return [...container.querySelectorAll('[data-supplier-quote]')].map(row=>({supplier_id:row.querySelector('[name=supplier_id]').value||null,notes:row.querySelector('[name=price_notes]').value,price:{amount:row.querySelector('[name=price_amount]').value,quantity:row.querySelector('[name=price_quantity]').value,unit:row.querySelector('[name=price_unit]').value}}));}
 function comparePrices(){
  const rows=read(),unit=form.querySelector('[name=default_unit]')?.value.trim()||defaultUnit;
  preferred=container.querySelector('[name=preferred_supplier_id]').value;
  let lowest=null;
  for(const [index,offer]of rows.entries()){
   const message=container.querySelectorAll('[data-quote-comparison]')[index],supplier=suppliers.find(s=>s.id===offer.supplier_id);let cost=null;
   try{if(offer.price.amount!=='')cost=ingredientCost({quantity:'1',unit},offer.price);}catch{}
   message.textContent=cost?`₱${displayQuantity(cost,{mode:'practical',step:'0.0001'}).text} / ${unit}`:offer.price.amount===''?'Price not entered.':'Enter a positive pack quantity and a unit comparable with the default unit.';
   if(supplier?.active===false)message.textContent+=' · Supplier inactive';
   if(cost&&supplier?.active!==false&&(!preferred||offer.supplier_id===preferred)&&(!lowest||compare(cost,lowest.cost)<0))lowest={index,cost,offer};
  }
  const note=container.querySelector('[data-cost-selection]');
  note.textContent=lowest?`${preferred?'Preferred supplier':'Lowest comparable cost'}: ${suppliers.find(s=>s.id===lowest.offer.supplier_id)?.name||'Supplier not specified'} · ₱${displayQuantity(lowest.cost,{mode:'practical',step:'0.0001'}).text} / ${unit}.`:preferred?'The preferred supplier has no usable price. Costing will show a missing price until you update it or choose automatic selection.':'No comparable price entered yet.';
 }
 function refreshPreference(){
  const select=container.querySelector('[name=preferred_supplier_id]'),ids=new Set(read().map(o=>o.supplier_id).filter(Boolean));
  select.innerHTML='<option value="">Automatic · lowest comparable unit cost</option>'+suppliers.filter(s=>ids.has(s.id)).map(s=>`<option value="${s.id}" ${s.id===preferred?'selected':''}>${esc(s.name)}</option>`).join('');
  if(!ids.has(preferred))preferred='';select.value=preferred;
 }
 function render(){
  container.innerHTML=`<div data-supplier-quotes>${offers.map((offer,i)=>`<section class="recipe-supplier-quote" data-supplier-quote><div class="recipe-fields two"><label>Supplier · optional<select name="supplier_id"><option value="">Not specified</option>${suppliers.map(s=>`<option value="${s.id}" ${s.id===offer.supplier_id?'selected':''}>${esc(s.name)}${s.active?'':' (inactive)'}</option>`).join('')}</select></label><label>Supplier notes<input name="price_notes" value="${esc(offer.notes||'')}"></label></div><div class="recipe-fields"><label>Price · PHP<input name="price_amount" inputmode="decimal" value="${esc(offer.price?.amount??'')}"></label><label>Purchase quantity<input name="price_quantity" inputmode="decimal" value="${esc(offer.price?.quantity??'')}"></label><label>Purchase unit<input name="price_unit" value="${esc(offer.price?.unit||defaultUnit)}"></label></div><div class="recipe-section-head"><p class="recipe-muted" data-quote-comparison></p>${offers.length>1?`<button type="button" data-remove-quote="${i}">Remove supplier</button>`:''}</div></section>`).join('')}</div><button type="button" data-add-quote>+ Add another supplier</button><label class="recipe-cost-preference">Price used for new recipe costs<select name="preferred_supplier_id"></select></label><p class="recipe-notice" data-cost-selection role="status"></p>`;
  refreshPreference();comparePrices();
 }
 container.addEventListener('input',()=>comparePrices());container.addEventListener('change',e=>{if(e.target.name==='supplier_id')refreshPreference();comparePrices();});
 form.querySelector('[name=default_unit]')?.addEventListener('input',comparePrices);
 container.addEventListener('click',e=>{const add=e.target.closest('[data-add-quote]'),remove=e.target.closest('[data-remove-quote]');if(!add&&!remove)return;offers=read();if(add){if(offers.length>=30)return;offers.push({supplier_id:'',price:{}});}else offers.splice(Number(remove.dataset.removeQuote),1);render();});
 render();return {read:()=>({suppliers:read(),preferred_supplier_id:container.querySelector('[name=preferred_supplier_id]').value||null})};
}
