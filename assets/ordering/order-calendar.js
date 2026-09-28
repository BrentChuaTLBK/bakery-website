export const todayInManila=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
export function calendarMonth(month){
 const start=new Date(`${month}-01T12:00:00Z`);
 if(!/^\d{4}-\d{2}$/.test(month)||!Number.isFinite(start.getTime())||start.toISOString().slice(0,7)!==month)throw Error('Choose a valid calendar month.');
 const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0,12));
 return {from:month+'-01',to:last.toISOString().slice(0,10),offset:start.getUTCDay(),days:last.getUTCDate(),label:new Intl.DateTimeFormat('en-PH',{month:'long',year:'numeric',timeZone:'UTC'}).format(start)};
}
export function shiftedMonth(month,step){const date=new Date(`${month}-01T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+step);return date.toISOString().slice(0,7);}
export const calendarArea=order=>order.address?.locality?.trim()||'Area not recorded';
export const calendarName=order=>(order.method==='delivery'?order.recipient?.name||order.buyer?.name:order.buyer?.name)||'Customer';
export const calendarPhone=order=>(order.method==='delivery'?order.recipient?.phone||order.buyer?.phone:order.buyer?.phone)||'';
export const calendarAddress=order=>order.method==='delivery'?[order.address?.line1,order.address?.line2,order.address?.locality,order.address?.postal_code].filter(Boolean).join(', '):order.pickup_address||'';
export function calendarSocial(order){
 const platform=String(order.buyer?.social_platform||'').trim(),username=String(order.buyer?.social_username||'').trim();
 if(!username||platform.toLowerCase()==='na'||/^n\/?a$/i.test(username))return 'Not provided';
 const label=platform.toLowerCase()==='instagram'?'Instagram':platform.toLowerCase()==='facebook'?'Facebook':platform;
 return [label,username].filter(Boolean).join(' · ');
}
export const calendarAmount=order=>Number.isSafeInteger(order.total_cents)&&order.total_cents>=0?new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(order.total_cents/100):'Not recorded';
export function calendarItemLines(order){return (order.items||[]).flatMap(item=>{
 const selections=Array.isArray(item.selection_labels)&&item.selection_labels.length?item.selection_labels:item.flavor_contents||[];
 const details=selections.map(s=>`${s.quantity?`${s.quantity} × `:''}${s.label||s.name||''}`).filter(Boolean);
 return [`${item.quantity} × ${item.name}`,...(details.length?['  '+details.join(', ')]:item.description?['  '+item.description]:[])];
});}
export function calendarSummary(order){
 const delivery=order.method==='delivery',buyer=order.buyer||{};
 return [`Customer name: ${buyer.name||calendarName(order)}`,`Phone number: ${buyer.phone||calendarPhone(order)||'Not provided'}`,
  `Social media: ${calendarSocial(order)}`,`Order ID: ${order.reference}`,
  ...(delivery?[...(calendarName(order)!==(buyer.name||calendarName(order))?[`Recipient: ${calendarName(order)}`]:[]),
   ...(calendarPhone(order)&&calendarPhone(order)!==(buyer.phone||calendarPhone(order))?[`Recipient phone: ${calendarPhone(order)}`]:[]),`Delivery address: ${calendarAddress(order)||'Not provided'}`]:[]),
  '', 'Order details:',...calendarItemLines(order),'',`Amount: ${calendarAmount(order)}`,
  ...(delivery&&order.instructions?['',`Delivery instructions: ${order.instructions}`]:[])].join('\n');
}
export function filteredCalendarOrders(orders,filters){
 const query=String(filters.search||'').trim().toLowerCase();
 return orders.filter(o=>(!filters.method||o.method===filters.method)&&(!filters.area||o.method==='delivery'&&calendarArea(o)===filters.area)&&(!query||[o.reference,calendarName(o),calendarPhone(o),calendarAddress(o),o.buyer?.name,o.buyer?.email,o.buyer?.phone].filter(Boolean).join(' ').toLowerCase().includes(query)))
 .sort((a,b)=>a.date.localeCompare(b.date)||a.method.localeCompare(b.method)||calendarArea(a).localeCompare(calendarArea(b),'en-PH')||a.reference.localeCompare(b.reference));
}
export function calendarCopy(order,field='all'){
 const values={name:calendarName(order),customer_name:order.buyer?.name||calendarName(order),phone:calendarPhone(order),address:calendarAddress(order),email:order.buyer?.email||'',buyer_phone:order.buyer?.phone||calendarPhone(order),social:calendarSocial(order)};
 if(field!=='all')return values[field]||'';
 return calendarSummary(order);
}
