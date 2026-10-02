const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const recipeUnits=['g','kg','ml','pcs'];
let customUnits=[];
export function configureRecipeUnits(units=[]){
 customUnits=units.filter(u=>u&&typeof u.symbol==='string'&&typeof u.name==='string'&&!recipeUnits.includes(u.symbol));
}
export function unitOptions(current=''){
 const value=String(current||'');
 const units=[...recipeUnits.map(unit=>[unit,unit]),...customUnits.map(u=>[u.symbol,`${u.name} (${u.symbol})`])];
 return [['','Choose a unit'],...units,...(value&&!units.some(([unit])=>unit===value)?[[value,`${value} (saved unit)`]]:[])];
}
export function unitOptionsMarkup(current=''){
 return unitOptions(current).map(([value,label])=>`<option value="${escape(value)}" ${value===String(current||'')?'selected':''}>${escape(label)}</option>`).join('');
}
export function setUnitSelection(select,value=''){
 select.innerHTML=unitOptionsMarkup(value);select.value=value;
}
