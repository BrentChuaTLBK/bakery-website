import {id} from './recipe-model.js?v=packaging-photos-1';
import {exact,multiply,quantity,unitInfo} from './recipe-math.js';
import {resourceMoney,resourceUnitCost} from './recipe-resource-table.js?v=2';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Saved costs remain the source of truth. Kitchen payloads contain only the
// explicitly allowed packaging reference fields, without supplier prices.
export const packagingItems=v=>v.packaging?.items||(v.additional_costs||[]).filter(c=>c.resource_id);
export function packagingPhotos(v){
 const photos=v.packaging?.photos?.length?v.packaging.photos:packagingItems(v).flatMap(c=>(c.resource_photos||[]).map(p=>({...p,caption:p.caption||c.resource_name,purpose:'Packaging photo'})));
 return photos.filter((p,i)=>p.file_id&&photos.findIndex(other=>other.file_id===p.file_id)===i);
}
export function packagingLegacyText(v){return [v.packaging?.description,v.packaging?.dimensions,v.packaging?.box,v.packaging?.board].filter(Boolean).join(' · ');}
export function replacePackagingPhotos(doc,v,photos){
 const previous=v.packaging.photos||[];v.packaging.photos=photos;
 const used=id=>doc.photos?.some(p=>p.file_id===id)||doc.variants.some(size=>size.photos?.some(p=>p.file_id===id)||packagingPhotos(size).some(p=>p.file_id===id)||packagingItems(size).some(c=>c.resource_photos?.some(p=>p.file_id===id))||size.methods?.some(m=>m.steps.some(s=>s.image_id===id)));
 doc.files=(doc.files||[]).filter(f=>!previous.some(p=>p.file_id===f.id)||used(f.id));
}
export function scaledPackagingItems(v,factor='1'){
 return packagingItems(v).map(c=>({id:c.id,resource_id:c.resource_id,resource_name:c.resource_name,resource_dimensions:c.resource_dimensions||'',resource_type:c.resource_type||'',resource_notes:c.resource_notes||'',resource_photos:(c.resource_photos||[]).map(p=>({file_id:p.file_id,caption:p.caption||''})),quantity:exact(multiply(quantity(c.quantity||'0'),quantity(c.per_batch===false?'1':factor))),unit:c.unit,per_batch:c.per_batch!==false}));
}
export function addRecipePackaging(v,resource){
 const existing=v.additional_costs.findIndex(c=>c.resource_id===resource.id);if(existing>=0)return {index:existing,added:false};
 const row={id:id(),name:'Packaging',resource_id:resource.id,resource_name:resource.name,resource_dimensions:resource.data?.dimensions||'',resource_type:resource.data?.type||'',resource_notes:resource.data?.notes||'',resource_photos:(resource.data?.photos||[]).map(p=>({file_id:p.file_id,path:p.path,caption:p.caption||''})),quantity:'1',unit:resource.data?.default_unit||(resource.price?.unit?unitInfo(resource.price.unit).canonical:'pc'),amount:'0',per_batch:true};
 if(resource.price)row.cost_snapshot={...resource.price};v.additional_costs.push(row);return {index:v.additional_costs.length-1,added:true};
}
export function packagingEditor(v,p,{field,button,photoMarkup}){
 const linked=v.additional_costs.map((item,index)=>({item,index})).filter(({item})=>item.resource_id),legacy=v.additional_costs.map((item,index)=>({item,index})).filter(({item})=>!item.resource_id);
 const override=Boolean(v.packaging?.photos?.length),photos=packagingPhotos(v),oldText=packagingLegacyText(v);
 return `<div class="recipe-section-head"><h3>Packaging items</h3>${button('+ Packaging item','link-packaging-cost')}</div><p class="recipe-muted">Choose from your Packaging list. Details, photos and prices are included automatically.</p><div class="recipe-packaging-items">${linked.map(({item:c,index:i})=>{const cost=resourceUnitCost({price:c.cost_snapshot});return `<div class="recipe-packaging-item" data-packaging-item="${esc(c.resource_id)}"><div><strong>${esc(c.resource_name)}</strong>${c.resource_type||c.resource_dimensions?`<p class="recipe-muted">${[c.resource_type,c.resource_dimensions].filter(Boolean).map(esc).join(' · ')}</p>`:''}${c.resource_notes?`<p class="recipe-muted">${esc(c.resource_notes)}</p>`:''}<p class="recipe-ingredient-link">${cost?`${esc(resourceMoney(cost.amount,cost.currency,4))} / ${esc(cost.basis)} · linked`:'Price not set in Packaging'}</p></div>${field('Quantity used',`${p}.additional_costs.${i}.quantity`)}${field('Unit',`${p}.additional_costs.${i}.unit`,{readonly:true})}${button('Remove','remove-cost',`data-index="${i}" aria-label="Remove packaging ${esc(c.resource_name)}"`,'danger')}</div>`;}).join('')||'<p class="recipe-muted">No packaging selected.</p>'}</div>
 ${linked.length||override||oldText?`<div class="recipe-packaging-photos"><div class="recipe-section-head"><h3>${override?'Custom packaging photo':'Packaging photos'}</h3><div class="recipe-actions">${button(override?'Change custom photo':'Use custom photo','upload','data-purpose="packaging"')}${override?button('Use packaging photos','reset-packaging-photo'):''}</div></div><p class="recipe-muted">${override?'This photo is used for this recipe. Your Packaging list stays unchanged.':'Photos come from the items above. You can use a photo of your finished product inside its packaging instead.'}</p>${photos.length?photoMarkup(photos,{editable:false}):'<p class="recipe-muted">No photo saved for this packaging yet.</p>'}</div>`:''}
 ${oldText?`<details class="recipe-advanced recipe-packaging-legacy" ${linked.length?'':'open'}><summary>Imported packaging reference</summary><p>${esc(oldText)}</p></details>`:''}${v.packaging?.notes?`<details class="recipe-advanced"><summary>Saved packaging notes</summary><p>${esc(v.packaging.notes)}</p></details>`:''}
 ${legacy.length?`<details class="recipe-advanced"><summary>Previously saved charges</summary><p class="recipe-muted">These are included in this recipe’s cost. Remove a charge if linked packaging replaces it.</p>${legacy.map(({item:c,index:i})=>`<div class="recipe-resource-row"><span>${esc(c.name)} · ${esc(resourceMoney(c.amount))}</span>${button('Remove saved charge','remove-cost',`data-index="${i}"`,'danger')}</div>`).join('')}</details>`:''}`;
}
export function packagingReferenceMarkup(v,factor='1'){
 const items=scaledPackagingItems(v,factor);if(!items.length)return '';
 return `<ul class="recipe-linked-packaging">${items.map(c=>`<li><strong>${esc(c.resource_name)}</strong> <span>${esc(c.quantity)} ${esc(c.unit)}${c.resource_type?` · ${esc(c.resource_type)}`:''}${c.resource_dimensions?` · ${esc(c.resource_dimensions)}`:''}</span>${c.resource_notes?`<p>${esc(c.resource_notes)}</p>`:''}</li>`).join('')}</ul>`;
}
