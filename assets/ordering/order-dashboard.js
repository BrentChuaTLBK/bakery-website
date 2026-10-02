import {isActiveFulfillment,needsPaymentReview} from './refund-status.js?v=pos-2';

export function matchesOrderView(order,view,today){
 if(view==='review')return needsPaymentReview(order);
 if(view==='today')return order.fulfillment_date===today&&isActiveFulfillment(order);
 return true;
}

export function orderNextStep(order){
 if(order.refund_label)return {title:'Refund label applied',label:'Open full order',action:'details'};
 if(['cancelled','expired','completed'].includes(order.fulfillment_status))return {title:order.fulfillment_status==='completed'?'Completed':order.fulfillment_status==='cancelled'?'Cancelled':'Expired',label:'Open full order',action:'details'};
 if(order.source==='popup'||order.source==='direct_message')return {title:needsPaymentReview(order)?'Review payment':order.payment_status==='paid'?'Continue fulfillment':'Record payment',label:'Open POS order',action:'pos'};
 if(needsPaymentReview(order))return {title:order.proof_stage==='delivery'?'Review delivery payment':'Review product payment',label:'Approve payment',action:'approve'};
 if(order.payment_status!=='paid')return {title:order.payment_status==='rejected'?'Payment rejected':'Awaiting payment',label:'Open full order',action:'details'};
 if(order.deferred_delivery&&order.delivery_payment_status!=='paid')return {title:'Complete delivery payment',label:'Open full order',action:'details'};
 if(order.fulfillment_status==='confirmed'||order.fulfillment_status==='pending_confirmation')return {title:'Start preparing',label:'Start preparing',action:'progress',status:'preparing'};
 if(order.fulfillment_status==='preparing')return order.method==='pickup'?{title:'Prepare & mark ready',label:'Mark ready for pickup',action:'progress',status:'ready_for_pickup'}:{title:'Prepare & dispatch',label:'Mark out for delivery',action:'progress',status:'out_for_delivery'};
 if(order.fulfillment_status==='ready_for_pickup'||order.fulfillment_status==='out_for_delivery')return {title:order.method==='pickup'?'Complete handoff':'Complete delivery',label:order.method==='pickup'?'Complete handoff':'Complete delivery',action:'progress',status:'completed'};
 return {title:'Review fulfillment',label:'Open full order',action:'details'};
}

export function orderQuickPanel(order,{escapeHtml:esc,money,formatDate,locked=false}){
 if(!order)return '<div class="empty-state"><h3>No order selected</h3><p>Choose an order to see its next action.</p></div>';
 const next=orderNextStep(order),review=needsPaymentReview(order),disabled=locked?'disabled':'';
 const line=(title,value)=>`<div class="order-quick-line"><span>${title}</span><strong>${value}</strong></div>`;
 const items=(order.items||[]).map(item=>`${item.quantity} × ${item.name}`).join(' · ');
 return `<span class="eyebrow">Next action</span><h2 id="order-quick-title">${esc(next.title)}</h2><p class="muted">${esc(order.reference)} · ${esc(order.buyer?.name||'Client not recorded')}</p>${line('Items',esc(items||'See full order for item details'))}${line('Due',esc(formatDate(order.fulfillment_date)))}${line('Method',esc(order.method==='pickup'?'Pickup':'Delivery'))}${line('Order total',money(order.total_cents))}${order.deferred_delivery?line('Delivery payment',esc((order.delivery_payment_status||'pending').replaceAll('_',' '))):''}<div class="order-quick-actions">${review?`<button type="button" class="button button-secondary" data-action="quick-order" data-intent="proof" data-id="${esc(order.id)}" ${disabled}>View payment proof</button>`:''}${next.action!=='details'?`<button type="button" class="button" data-action="quick-order" data-intent="${next.action}" data-id="${esc(order.id)}" ${disabled}>${esc(next.label)}</button>`:''}<button type="button" class="button button-quiet" data-action="open-order" data-id="${esc(order.id)}" ${disabled}>Open full order →</button></div><p class="muted">${review?'Check the uploaded receipt and the amount received before approving.':'Full order includes customer details, staff notes and order history.'}</p>`;
}
