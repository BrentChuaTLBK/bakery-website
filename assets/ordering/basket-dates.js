import {addDays,customerBookingWindow,customerDateIssue,earliestLeadDate,allowsSameDay,selectionPrice} from './shop-rules.js?v=daily-quantities-1';

// Advice uses the same catalog snapshot as checkout. It never reserves stock.
export function basketDateAdvice(items,products,inventory,settings,selected,method='pickup',now=new Date()) {
  if(!items.length)return null;
  const quantities=new Map(),byId=new Map(products.map(p=>[p.id,p]));
  for(const line of items){
    const p=byId.get(line.product_id);
    if(!p?.active||!Number.isInteger(line.quantity)||line.quantity<1||(method==='delivery'&&p.pickup_only))return null;
    try{selectionPrice(p,line.selections)}catch{return null}
    quantities.set(p.id,(quantities.get(p.id)||0)+line.quantity);
  }
  const entries=[...quantities].map(([id,quantity])=>({product:byId.get(id),quantity,earliest:earliestLeadDate(byId.get(id),settings,now)}));
  if(entries.some(e=>!e.earliest||e.quantity<(e.product.min_quantity||1)))return null;
  const stock=new Map(inventory.map(i=>[`${i.product_id}:${i.date}`,i]));
  const eligible=entries.every(e=>allowsSameDay(e.product));
  const fits=(e,date)=>{const row=stock.get(`${e.product.id}:${date}`);return date>=e.earliest&&row?.available!==false&&(row?.capacity==null||Number(row.remaining??(row.capacity-(row.reserved||0)))>=e.quantity)};
  const dateOK=date=>!customerDateIssue(date,settings,method,now,eligible);
  if(selected&&dateOK(selected)&&entries.every(e=>fits(e,selected)))return null;
  const window=customerBookingWindow(now,eligible);
  let earliest='';
  for(let date=window.minDate;date<=window.maxDate;date=addDays(date,1))if(dateOK(date)&&entries.every(e=>fits(e,date))){earliest=date;break}
  const limiting=selected?entries.filter(e=>!fits(e,selected)):entries.filter(e=>e.earliest===entries.reduce((max,e)=>e.earliest>max?e.earliest:max,''));
  return {earliest,limitingNames:limiting.map(e=>e.product.name),selected:Boolean(selected)};
}
