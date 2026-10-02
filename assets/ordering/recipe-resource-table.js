import {quantity,unitInfo,ingredientCost,compare} from './recipe-math.js?v=approved-20261002-1';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nameOrder=(a,b)=>String(a.name||'').localeCompare(String(b.name||''))||String(a.data?.brand||'').localeCompare(String(b.data?.brand||''));

// Display-only comparisons use the already selected supplier quote. No mass /
// volume or pack / piece assumptions are introduced, and stored prices are untouched.
export function resourceUnitCost(resource){
 const price=resource.price;if(!price||price.amount==null)return null;
 try{
  const unit=unitInfo(price.unit),basis={quantity:'1',unit:unit.canonical};
  const currency=price.currency||'PHP';if(!/^[A-Z]{3}$/.test(currency))return null;
  const amount=ingredientCost(basis,price);if(!amount)return null;
  return {amount,currency,basis:basis.unit,group:`${currency}:${unit.dimension}`};
 }catch{return null;}
}

export function sortResourceRows(rows,sort='az'){
 if(sort==='server')return rows;
 const ranked=rows.map(row=>({row,cost:resourceUnitCost(row)}));
 ranked.sort((a,b)=>{
  if(sort!=='cost')return nameOrder(a.row,b.row);
  if(!a.cost||!b.cost)return Number(!a.cost)-Number(!b.cost)||nameOrder(a.row,b.row);
  return a.cost.group.localeCompare(b.cost.group)||compare(a.cost.amount,b.cost.amount)||nameOrder(a.row,b.row);
 });
 return ranked.map(entry=>entry.row);
}

export function resourceMoney(value,currency='PHP',precision=2){
 const number=typeof value==='object'?Number(value.n)/Number(value.d):Number(value);
 if(!Number.isFinite(number)||number<0)return '—';
 try{
  const format=new Intl.NumberFormat('en-PH',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:precision});
  if(number>0&&number<10**-precision)return `< ${format.format(10**-precision)}`;
  return format.format(number);
 }catch{return '—';}
}

export function resourceTableMarkup(rows,{kind='ingredient',sort='az',canDelete=false}={}){
 if(!rows.length)return '<p class="recipe-resource-empty">No matching records. Try another search, or add a record.</p>';
 const actions=row=>{
  const category=kind==='categories',suffix=category?'category':'resource',id=esc(row.id);
  if(row.deleted_at)return canDelete?`<button type="button" class="recipe-resource-edit" data-action="restore-${suffix}" data-id="${id}" aria-describedby="recipe-resource-name-${id}">Restore</button>`:'';
  return `${['ingredient','packaging'].includes(kind)&&row.active!==false?`<button type="button" class="recipe-resource-edit" data-action="record-item-price" data-id="${id}" aria-describedby="recipe-resource-name-${id}">Record price</button>`:''}<button type="button" class="recipe-resource-edit" data-action="edit-${suffix}" data-id="${id}" aria-describedby="recipe-resource-name-${id}">Edit</button>${canDelete?`<button type="button" class="recipe-resource-edit danger" data-action="delete-${suffix}" data-id="${id}" aria-describedby="recipe-resource-name-${id}">Delete</button>`:''}`;
 };
 if(['supplier','equipment','categories'].includes(kind)){
  const heading={supplier:'Supplier',equipment:'Equipment',categories:'Category'}[kind];
  return `<table class="recipe-resource-table recipe-directory-table"><caption class="recipe-resource-sr">${heading} records</caption><thead><tr><th scope="col">${heading}</th><th scope="col">${kind==='supplier'?'Contact':'Details'}</th><th scope="col"><span class="recipe-resource-sr">Actions</span></th></tr></thead><tbody>${sortResourceRows(rows,sort).map(row=>{
   const d=row.data||{},details=kind==='supplier'?[d.contact_name,d.phone,d.email].filter(Boolean).join(' · '):kind==='categories'?row.parent_name?`In ${row.parent_name}`:'Top-level category':d.notes;
   return `<tr data-resource-id="${esc(row.id)}"><td class="recipe-resource-identity"><div class="recipe-resource-name"><span class="recipe-resource-dot ${row.active===false?'inactive':''}" role="img" aria-label="${row.active===false?'Inactive':'Active'}"></span><div><span id="recipe-resource-name-${esc(row.id)}" class="recipe-resource-title">${esc(row.name)}</span>${d.type?`<span class="recipe-resource-meta">${esc(d.type)}</span>`:''}${row.active===false?'<span class="recipe-resource-inactive">Inactive</span>':''}</div></div></td><td class="recipe-resource-summary">${esc(details||'—')}</td><td class="recipe-resource-action">${actions(row)}</td></tr>`;
  }).join('')}</tbody></table>`;
 }
 return `<table class="recipe-resource-table"><caption class="recipe-resource-sr">${kind==='packaging'?'Packaging':'Ingredients'} with purchase prices and comparable unit costs</caption><thead><tr><th scope="col">${kind==='packaging'?'Packaging / size':'Ingredient / brand'}</th><th scope="col" class="numeric">Purchase price</th><th scope="col" class="numeric">Unit cost</th><th scope="col"><span class="recipe-resource-sr">Actions</span></th></tr></thead><tbody>${sortResourceRows(rows,sort).map(row=>{
  const cost=resourceUnitCost(row),price=row.price,meta=kind==='packaging'?[row.data?.dimensions,row.data?.type].filter(Boolean).join(' · '):row.data?.brand;
  let hasPrice=false;try{hasPrice=price?.amount!=null&&quantity(price.quantity).n>0n&&!!price.unit;}catch{}
  return `<tr data-resource-id="${esc(row.id)}"><td class="recipe-resource-identity"><div class="recipe-resource-name"><span class="recipe-resource-dot ${row.active===false?'inactive':''}" role="img" aria-label="${row.active===false?'Inactive':'Active'}" title="${row.active===false?'Inactive':'Active'}"></span><div><span id="recipe-resource-name-${esc(row.id)}" class="recipe-resource-title">${esc(row.name)}</span>${meta?`<span class="recipe-resource-meta">${esc(meta)}</span>`:''}${row.usage_count==null?'':`<span class="recipe-resource-meta">Used in ${Number(row.usage_count)} recipe${Number(row.usage_count)===1?'':'s'}</span>`}${row.active===false?'<span class="recipe-resource-inactive">Inactive</span>':''}</div></div></td><td class="numeric recipe-resource-purchase">${hasPrice?`<strong>${esc(resourceMoney(price.amount,price.currency||'PHP'))}</strong><span class="recipe-resource-pack">/ ${esc(price.quantity)} ${esc(price.unit)}</span>`:'<span class="recipe-resource-missing">Price not set</span>'}</td><td class="numeric recipe-resource-unit">${cost?`<span>${esc(resourceMoney(cost.amount,cost.currency,4))}</span><span class="recipe-resource-pack">/ ${esc(cost.basis)}</span>`:'<span class="recipe-resource-missing">—</span>'}</td><td class="recipe-resource-action">${actions(row)}</td></tr>`;
 }).join('')}</tbody></table>`;
}
