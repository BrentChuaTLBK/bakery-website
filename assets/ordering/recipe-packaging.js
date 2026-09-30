import {id} from './recipe-model.js?v=packaging-1';
import {exact,multiply,quantity,unitInfo} from './recipe-math.js';
import {resourceMoney,resourceUnitCost} from './recipe-resource-table.js?v=2';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Saved costs remain the source of truth. Kitchen payloads contain only the
// explicitly allowed packaging reference fields, without supplier prices.
export const packagingItems=v=>v.packaging?.items||(v.additional_costs||[]).filter(c=>c.resource_id);
export function scaledPackagingItems(v,factor='1'){
 return packagingItems(v).map(c=>({id:c.id,resource_id:c.resource_id,resource_name:c.resource_name,resource_dimensions:c.resource_dimensions||'',quantity:exact(multiply(quantity(c.quantity||'0'),quantity(c.per_batch===false?'1':factor))),unit:c.unit,per_batch:c.per_batch!==false}));
}
export function addRecipePackaging(v,resource){
 const existing=v.additional_costs.findIndex(c=>c.resource_id===resource.id);if(existing>=0)return {index:existing,added:false};
 const row={id:id(),name:'Packaging',resource_id:resource.id,resource_name:resource.name,resource_dimensions:resource.data?.dimensions||'',quantity:'1',unit:resource.data?.default_unit||(resource.price?.unit?unitInfo(resource.price.unit).canonical:'pc'),amount:'0',per_batch:true};
 if(resource.price)row.cost_snapshot={...resource.price};v.additional_costs.push(row);return {index:v.additional_costs.length-1,added:true};
}
export function packagingEditor(v,p,{field,button}){
 const linked=v.additional_costs.map((item,index)=>({item,index})).filter(({item})=>item.resource_id),legacy=v.additional_costs.map((item,index)=>({item,index})).filter(({item})=>!item.resource_id);
 return `<div class="recipe-section-head"><h3>Packaging items</h3>${button('+ Packaging item','link-packaging-cost')}</div><p class="recipe-muted">Choose boxes, boards and other items from your Packaging list. Their saved prices are included automatically.</p><div class="recipe-packaging-items">${linked.map(({item:c,index:i})=>{const cost=resourceUnitCost({price:c.cost_snapshot});return `<div class="recipe-packaging-item" data-packaging-item="${esc(c.resource_id)}"><div><strong>${esc(c.resource_name)}</strong>${c.resource_dimensions?`<p class="recipe-muted">${esc(c.resource_dimensions)}</p>`:''}<p class="recipe-ingredient-link">${cost?`${esc(resourceMoney(cost.amount,cost.currency,4))} / ${esc(cost.basis)} · linked`:'Price not set in Packaging'}</p></div>${field('Quantity used',`${p}.additional_costs.${i}.quantity`)}${field('Unit',`${p}.additional_costs.${i}.unit`,{readonly:true})}${button('Remove','remove-cost',`data-index="${i}" aria-label="Remove packaging ${esc(c.resource_name)}"`,'danger')}</div>`;}).join('')||'<p class="recipe-muted">No packaging selected.</p>'}</div>${legacy.length?`<details class="recipe-advanced"><summary>Previously saved charges</summary><p class="recipe-muted">These are included in this recipe’s cost. Remove a charge if linked packaging replaces it.</p>${legacy.map(({item:c,index:i})=>`<div class="recipe-resource-row"><span>${esc(c.name)} · ${esc(resourceMoney(c.amount))}</span>${button('Remove saved charge','remove-cost',`data-index="${i}"`,'danger')}</div>`).join('')}</details>`:''}`;
}
export function packagingReferenceMarkup(v,factor='1'){
 const items=scaledPackagingItems(v,factor);if(!items.length)return '';
 return `<ul class="recipe-linked-packaging">${items.map(c=>`<li><strong>${esc(c.resource_name)}</strong> <span>${esc(c.quantity)} ${esc(c.unit)}${c.resource_dimensions?` · ${esc(c.resource_dimensions)}`:''}</span></li>`).join('')}</ul>`;
}
