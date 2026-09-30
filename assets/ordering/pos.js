export const POS_METHODS = {cash:'Cash',gcash:'GCash',bdo:'BDO',eastwest:'EastWest'};
export const salesSource = order => ({popup:'Pop-up',direct_message:'Direct message',website:'Website'}[order.source] || 'Website');
export function pesoCents(value) {
 const text=String(value??'').trim();
 if(!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter an amount with up to two decimal places.');
 const [whole,fraction='']=text.split('.'), cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents>1000000000) throw new Error('This amount is too large.');
 return cents;
}
export function posEstimate(items,discount,delivery=0) {
 const subtotal=items.reduce((sum,item)=>sum+item.quantity*item.unit_price_cents,0);
 const off=discount.kind==='percent'?Math.round(subtotal*discount.value/100):discount.kind==='fixed'?discount.value:0;
 return {subtotal_cents:subtotal,discount_cents:off,delivery_cents:delivery,total_cents:subtotal-off+delivery};
}
export function paymentProofAllowed(order,now=Date.now()) {
 if(order.uploads_paused)return false;
 if(deliveryProofAllowed(order))return true;
 return order.payment_status==='awaiting_payment'&&order.fulfillment_status==='pending_confirmation'&&
  ((order.source==='direct_message'&&order.payment_deadline===null)||new Date(order.payment_deadline).getTime()>now);
}
export function deliveryProofAllowed(order) {
 return order.source==='direct_message'&&order.deferred_delivery===true&&order.payment_status==='paid'&&order.delivery_payment_status==='awaiting_payment'&&!order.refund_label&&!['cancelled','expired'].includes(order.fulfillment_status);
}
export const productsDue = order => Number(order.total_cents||0)-(order.deferred_delivery?Number(order.delivery_cents||0):0);
export const paymentDue = order => deliveryProofAllowed(order)?Number(order.delivery_cents||0):productsDue(order);
export function deliveryStatusText(order) {
 if(!order.deferred_delivery)return '';
 return {pending:'Delivery fee pending',awaiting_payment:'Delivery fee awaiting payment',under_review:'Delivery payment under review',paid:'Delivery fee paid'}[order.delivery_payment_status]||'Delivery fee pending';
}
export function posOrderUrl(order,siteUrl) {
 const url=new URL('shop.html',siteUrl);url.hash=new URLSearchParams({order:order.id,token:order.access_token}).toString();return url.href;
}
