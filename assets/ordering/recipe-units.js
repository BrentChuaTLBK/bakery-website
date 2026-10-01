const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const recipeUnits=['g','kg','ml','pcs'];
export function unitOptions(current=''){
 const value=String(current||'');
 return [['','Choose a unit'],...recipeUnits.map(unit=>[unit,unit]),...(value&&!recipeUnits.includes(value)?[[value,`${value} (saved unit)`]]:[])];
}
export function unitOptionsMarkup(current=''){
 return unitOptions(current).map(([value,label])=>`<option value="${escape(value)}" ${value===String(current||'')?'selected':''}>${escape(label)}</option>`).join('');
}
export function setUnitSelection(select,value=''){
 select.innerHTML=unitOptionsMarkup(value);select.value=value;
}
