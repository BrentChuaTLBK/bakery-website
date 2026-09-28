import {escapeHtml as esc,money,manilaDate} from './client.js?v=academy-1';
import {confirmDialog} from './site-dialog.js?v=branded-dialogs-1';
import {POS_METHODS,pesoCents,posEstimate,posOrderUrl,salesSource,productsDue,deliveryStatusText} from './pos.js?v=pos-1';

const amount=cents=>(Number(cents||0)/100).toFixed(2);
const field=(name,label,value='',type='text',attrs='')=>`<label class="field">${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const opt=(value,label,current)=>`<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(label)}</option>`;
const select=(name,label,content)=>`<label class="field">${esc(label)}<select name="${name}">${content}</select></label>`;
const button=(action,label,extra='')=>`<button type="button" class="button button-secondary" data-pos="${action}" ${extra}>${label}</button>`;
const paymentFields=(total)=>`<div class="field-row">${select('payment_method','Payment method',Object.entries(POS_METHODS).map(([k,v])=>opt(k,v,'cash')).join(''))}${field('cash_received','Cash received · PHP',amount(total),'number','min="0" step="0.01" required')}${field('payment_reference','Payment reference · optional','','text','maxlength="200"')}</div><p data-change>Change: ${money(0)}</p>`;

export async function mountPOS(root,{api,role,connected,products=[],settings={},printOrderSlips,onOrderSaved,openOrder,orderId}) {
 let events=[],orders=[],screen='sale',source='popup',eventId='',items=[],draft={},quote=null,receipt=null,error='',busy=false,search='',optionProduct=null;
 let pending=null,submissionKey=crypto.randomUUID(),paymentKey=crypto.randomUUID();
 const $=selector=>root.querySelector(selector);
 const value=(form,name)=>form?.elements.namedItem(name)?.value?.trim()??'';
 const checked=(form,name)=>Boolean(form?.elements.namedItem(name)?.checked);
 const event=()=>events.find(e=>e.id===eventId);
 const product=id=>products.find(p=>p.id===id);
 const dirty=()=>{root.dataset.dirty=String(items.length>0||screen==='event'||screen==='details'||(screen==='sale'&&['name','phone','email','social_username','recipient_name','recipient_phone','address','instructions'].some(k=>draft[k])));root.dataset.busy=String(busy||Boolean(pending));};
 function capture() {
  const form=$('#pos-sale-form');if(!form)return;
  draft=Object.fromEntries(new FormData(form));draft.email_notifications=checked(form,'email_notifications');draft.override_dates=checked(form,'override_dates');draft.delivery_fee_pending=checked(form,'delivery_fee_pending');
 }
 function basePayload(readForm=true) {
  if(readForm)capture();
  const kind=draft.discount_kind||'none';
  return {source,event_id:eventId||null,items:items.map(({name,description,quantity,product_id,selections,unit_price_cents})=>({name,description,quantity,product_id,selections,...(source==='direct_message'?{unit_price_cents}: {})})),
   fulfillment_date:draft.fulfillment_date||manilaDate(),method:source==='popup'?'pickup':draft.method||'pickup',
   discount:{kind,value:kind==='percent'?Number(draft.discount_value||0):kind==='fixed'?pesoCents(draft.discount_value||'0'):0},
   delivery_cents:draft.method==='delivery'&&!draft.delivery_fee_pending?pesoCents(draft.delivery_fee||'0'):0,delivery_fee_pending:draft.method==='delivery'&&Boolean(draft.delivery_fee_pending),
   buyer:{name:draft.name||'',phone:draft.phone||'',email:draft.email||'',social_platform:draft.social_platform||'',social_username:draft.social_username||''},
   recipient:{name:draft.recipient_name||'',phone:draft.recipient_phone||''},address:{line1:draft.address||''},instructions:draft.instructions||'',
   email_notifications:Boolean(draft.email_notifications),override_dates:Boolean(draft.override_dates),override_reason:draft.override_reason||''};
 }
 function estimate(){try{return posEstimate(items,basePayload(false).discount,basePayload(false).delivery_cents).total_cents}catch{return 0}}
 function customerFields(o={}) {
  const b=o.buyer||draft;
  return `<div class="field-row">${field('name','Client name · optional',b.name||'','text','maxlength="200"')}${field('phone','Phone · optional',b.phone||'','text','maxlength="40"')}${field('email','Email · optional',b.email||'','email','maxlength="254"')}</div><div class="field-row">${select('social_platform','Social media · optional',['','Instagram','Facebook','WhatsApp','Viber','Other'].map(k=>opt(k,k||'Not recorded',b.social_platform)).join(''))}${field('social_username','Username / profile · optional',b.social_username||'','text','maxlength="100"')}</div>
   <label class="check-field"><input type="checkbox" name="email_notifications" ${(o.email_notifications??draft.email_notifications)?'checked':''}><span>Email confirmations and order updates to this client</span></label>`;
 }
 function deliveryFields(o=null){return `<div class="field-row">${field('recipient_name','Recipient name · optional',o?.recipient?.name??draft.recipient_name??'','text','maxlength="200"')}${field('recipient_phone','Recipient phone · optional',o?.recipient?.phone??draft.recipient_phone??'','text','maxlength="40"')}</div>${field('address','Delivery address · optional',o?.address?.line1??draft.address??'','text','maxlength="1000"')}`}
 function recent() {return `<section class="panel pos-recent"><div class="section-heading"><h2>Recent POS orders</h2>${button('refresh','Refresh')}</div>${orders.length?`<div class="table-wrap"><table class="data-table pos-table"><thead><tr><th>Order / client</th><th>Source</th><th>Payment</th><th>Total</th><th></th></tr></thead><tbody>${orders.map(o=>`<tr><td>${esc(o.reference)}<small>${esc(o.buyer?.name||'Client not recorded')}</small></td><td>${esc(salesSource(o))}<small>${esc(o.event_name||o.fulfillment_date)}</small></td><td>${esc(o.payment_status.replaceAll('_',' '))}<small>${esc(o.fulfillment_status.replaceAll('_',' '))}${o.deferred_delivery?` · ${esc(deliveryStatusText(o))}`:''}</small></td><td>${money(o.total_cents)}</td><td>${button('receipt','Open',`data-id="${o.id}"`)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Your pop-up sales and direct orders will appear here.</p>'}</section>`}
 function renderSale() {
  const stock=event()?.stock||[],catalog=products.filter(p=>!p.deleted_at&&(source==='popup'?stock.some(s=>s.product_id===p.id&&s.active):p.active)).filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
  return `<div class="pos-tabs" aria-label="Sales type">${['popup','direct_message'].map(s=>`<button type="button" class="button button-secondary" data-pos="source" data-source="${s}" aria-pressed="${source===s}">${s==='popup'?'Pop-up sale':'Direct order'}</button>`).join('')}</div>
   <form id="pos-sale-form"><div class="pos-layout"><section class="panel"><div class="pos-entry-title"><h2>${source==='popup'?'Event counter':'Choose products'}</h2>${source==='popup'&&role==='owner'?button('event-new','+ New event'):source==='direct_message'?button('custom','+ Custom item'):''}</div>
   ${source==='popup'?`<div class="pos-actions">${select('event_id','Pop-up event',opt('','Choose an event',eventId)+events.map(e=>opt(e.id,`${e.name}${e.closed?' · closed':''}`,eventId)).join(''))}${eventId&&role==='owner'?button('event-edit','Edit event / stock'):''}</div>${event()?`<p class="help-text">${esc(event().location)} · ${esc(event().starts_on)} to ${esc(event().ends_on)}. Stock is separate from website orders.</p><div class="pos-event-summary">${(event().sales||[]).map(s=>`<span>${esc(POS_METHODS[s.payment_method]||s.payment_method)}: <strong>${money(s.total_cents)}</strong></span>`).join('')}</div>`:'<p class="notice">Create an event and set its products, quantities and prices to start selling.</p>'}`:''}
   ${field('search','Find a product',search,'search','autocomplete="off"')}<div class="pos-catalog">${catalog.map(p=>{const s=stock.find(s=>s.product_id===p.id);return `<button type="button" class="pos-product" data-pos="add" data-id="${p.id}" ${source==='popup'&&(!s?.remaining||event()?.closed)?'disabled':''}><strong>${esc(p.name)}</strong><span>${money(source==='popup'?s.price_cents:p.price_cents)}</span><small>${source==='popup'?`${s.remaining} left at event`:`${p.min_quantity||1} minimum · ${p.lead_days||0} production days`}</small></button>`}).join('')||'<p class="muted">No matching products.</p>'}</div></section>
   <section class="panel"><h2>${source==='popup'?'Current sale':'Direct order'}</h2><ul class="pos-cart">${items.map((item,index)=>`<li><div class="pos-cart-top"><strong>${esc(item.name)}</strong><span>${money(item.quantity*item.unit_price_cents)}</span></div>${item.description?`<small>${esc(item.description)}</small>`:''}<div class="pos-cart-controls">${field(`qty_${index}`,'Quantity',item.quantity,'number','min="1" max="10000" step="1" required')}${source==='direct_message'?field(`price_${index}`,'Unit price · PHP',amount(item.unit_price_cents),'number','min="0" step="0.01" required'):''}${button('remove','Remove',`data-index="${index}" aria-label="Remove ${esc(item.name)}"`)}</div></li>`).join('')||'<li class="pos-empty">Choose products to start.</li>'}</ul>
   <div class="field-row">${select('discount_kind','Discount',['none','percent','fixed'].map(k=>opt(k,{none:'No discount',percent:'Percentage',fixed:'Amount · PHP'}[k],draft.discount_kind||'none')).join(''))}${field('discount_value','Discount value',draft.discount_value||'0','number','min="0" step="0.01"')}</div>
   ${source==='direct_message'?`<div class="field-row">${field('fulfillment_date','Fulfillment date',draft.fulfillment_date||manilaDate(),'date','required')}${select('method','Fulfillment',opt('pickup','Pickup',draft.method||'pickup')+opt('delivery','Delivery',draft.method))}</div>${draft.method==='delivery'?`<label class="check-field"><input type="checkbox" name="delivery_fee_pending" ${draft.delivery_fee_pending?'checked':''}><span>Delivery fee pending · collect separately later</span></label>${draft.delivery_fee_pending?'<p class="help-text">Collect full product payment now. Enter the exact courier charge and record its payment later.</p>':field('delivery_fee','Delivery fee · PHP',draft.delivery_fee||'0','number','min="0" step="0.01" required')}${deliveryFields()}`:''}${role==='owner'?`<details><summary>Owner date override</summary><label class="check-field"><input type="checkbox" name="override_dates" ${draft.override_dates?'checked':''}><span>Override lead times and closed dates</span></label>${field('override_reason','Reason for override',draft.override_reason||'','text','maxlength="500"')}<p class="help-text">Stock limits and pickup-only products still apply.</p></details>`:''}<p class="help-text">Unpaid orders reserve stock until you cancel them.</p>`:''}
   <details class="pos-customer" ${source==='direct_message'?'open':''}><summary>Client details · all optional</summary>${customerFields()}</details><label class="field">Order notes · optional<textarea name="instructions" maxlength="2000">${esc(draft.instructions||'')}</textarea></label><div class="pos-total"><span>Estimated total</span><span data-estimate>${money(estimate())}</span></div><button class="button block" type="submit" ${!items.length?'disabled':''}>Review ${source==='popup'?'sale':'order'}</button></section></div></form>${recent()}`;
 }
 function renderReview() {
  return `<section class="panel pos-review"><h2>Review ${source==='popup'?'pop-up sale':'direct order'}</h2>${quote.deferred_delivery?'<p class="notice">Delivery fee pending. This payment covers products only; the exact delivery fee will be collected separately.</p>':''}<ul class="pos-review-lines">${quote.items.map(i=>`<li><span>${i.quantity} × ${esc(i.name)}${i.description?`<small> · ${esc(i.description)}</small>`:''}</span><strong>${money(i.line_total_cents)}</strong></li>`).join('')}</ul><p>Subtotal: ${money(quote.subtotal_cents)} · Discount: ${money(quote.discount_cents)} · Delivery: ${quote.deferred_delivery?'Fee pending':money(quote.delivery_cents)}</p><div class="pos-total"><span>Total</span><span>${money(quote.total_cents)}</span></div><p>${esc(draft.name||'Client not recorded')}${source==='direct_message'?` · ${esc(quote.fulfillment_date)} · ${esc(quote.method)}`:` · ${esc(event()?.name)}`}</p>${quote.method==='delivery'&&!draft.address?'<p class="notice">Delivery address is not recorded. Add it to the saved order before arranging the courier.</p>':''}
   <form id="pos-confirm-form">${source==='direct_message'?select('payment_state','Payment',opt('unpaid','Awaiting payment · share a payment link','unpaid')+opt('paid','Full payment already received','unpaid')):'<input type="hidden" name="payment_state" value="paid">'}<div class="pos-payment" ${source==='direct_message'?'hidden':''}>${paymentFields(quote.total_cents)}<p class="help-text">Record payment only after you have received the full amount.</p></div><p class="help-text">${draft.email_notifications?`Email updates will be sent to ${esc(draft.email)}.`:'Email updates are off.'}</p><div class="pos-actions">${button('back','Back to edit',pending?'disabled':'')}<button type="submit" class="button">${pending?'Retry saving this order':source==='popup'?'Complete sale':'Create direct order'}</button></div></form></section>`;
 }
 function renderEvent(e) {
  const entries=e?.stock||[];
  return `<section class="panel"><h2>${e?'Edit event & stock':'New pop-up event'}</h2><form id="pos-event-form" data-id="${e?.id||''}" data-revision="${e?.revision||''}"><div class="field-row">${field('name','Event name',e?.name||'','text','required maxlength="120"')}${field('location','Location',e?.location||'','text','maxlength="500"')}</div><div class="field-row">${field('starts_on','Start date',e?.starts_on||manilaDate(),'date','required')}${field('ends_on','End date',e?.ends_on||manilaDate(),'date','required')}</div><label class="check-field"><input type="checkbox" name="closed" ${e?.closed?'checked':''}><span>Close this event to new sales</span></label><p class="help-text">Select the products to sell. Total stock includes quantities already sold. Event prices do not change website prices.</p><div class="table-wrap"><table class="pos-event-stock"><thead><tr><th>Sell</th><th>Product</th><th>Total stock</th><th>Event price · PHP</th><th>Used</th></tr></thead><tbody>${products.filter(p=>!p.deleted_at||entries.some(s=>s.product_id===p.id)).map(p=>{const s=entries.find(s=>s.product_id===p.id);return `<tr data-stock-id="${p.id}"><td><input type="checkbox" name="active_${p.id}" ${s?.active?'checked':''} aria-label="Sell ${esc(p.name)}"></td><td>${esc(p.name)}</td><td><input name="stock_${p.id}" type="number" min="${s?.used||0}" max="100000" step="1" value="${s?.capacity||0}" aria-label="Stock for ${esc(p.name)}"></td><td><input name="price_${p.id}" type="number" min="0" max="1000000" step="0.01" value="${amount(s?.price_cents??p.price_cents)}" aria-label="Price for ${esc(p.name)}"></td><td>${s?.used||0}</td></tr>`}).join('')}</tbody></table></div><div class="pos-actions">${button('back','Back')}<button class="button" type="submit">Save event</button></div></form></section>`;
 }
 function renderReceipt() {
  const o=receipt,unpaid=['awaiting_payment','under_review'].includes(o.payment_status)&&o.fulfillment_status==='pending_confirmation';
  const link=posOrderUrl(o,settings.site_url||document.baseURI);
  return `<section class="panel pos-receipt"><h2>${esc(o.reference)}</h2><p>${esc(salesSource(o))}${o.event_name?` · ${esc(o.event_name)}`:''} · ${esc(o.fulfillment_status.replaceAll('_',' '))}</p><p>${esc(o.buyer?.name||'Client not recorded')} · ${esc(o.payment_status.replaceAll('_',' '))}${o.payment_method?` · ${esc(POS_METHODS[o.payment_method]||o.payment_method)}`:''}</p><ul class="pos-review-lines">${o.items.map(i=>`<li><span>${i.quantity} × ${esc(i.name)}</span><strong>${money(i.line_total_cents)}</strong></li>`).join('')}</ul><div class="pos-total"><span>Total</span><span>${money(o.total_cents)}</span></div>${o.payment_method==='cash'?`<p>Cash received: ${money(o.cash_received_cents)} · <strong>Change: ${money(o.change_cents)}</strong></p>`:''}${unpaid?'<p class="notice">Stock stays reserved until you cancel this order. Share the link for payment details and proof upload.</p>':''}<label class="field">Private order link<div class="pos-link"><input data-share-link readonly value="${esc(link)}">${button('copy','Copy link')}</div></label><p class="help-text">Share this link with the customer only.</p><div class="pos-actions">${button('print','Print slip')}${button('details','Client details')}${button('manage-order','Order history / status')}${o.source==='popup'&&o.fulfillment_status==='completed'&&role==='owner'?button('void','Void sale'):''}${button('new-sale','New sale / order')}</div>
   ${unpaid?`<form id="pos-payment-form" class="pos-payment"><h3>${o.deferred_delivery?'Record full product payment':'Record full payment'}</h3>${paymentFields(productsDue(o))}<button class="button" type="submit">Confirm payment received</button></form>`:''}${deliveryPanel(o)}<p class="pos-feedback" role="status"></p></section>`;
 }
 function deliveryPanel(o) {
  if(!o.deferred_delivery)return '';
  const active=!o.refund_label&&!['cancelled','expired'].includes(o.fulfillment_status),status=o.delivery_payment_status;
  return `<section class="pos-payment"><h3>${esc(deliveryStatusText(o))}</h3><p>Products: ${o.payment_status==='paid'?'Paid':'Awaiting payment'} · ${money(productsDue(o))}<br>Delivery: ${status==='pending'?'Fee to follow':money(o.delivery_cents)}</p>${o.delivery_paid_cents?`<p>Delivery paid by ${esc(POS_METHODS[o.delivery_payment_method]||o.delivery_payment_method)}${o.delivery_payment_method==='cash'?` · Cash ${money(o.delivery_cash_received_cents)} · Change ${money(o.delivery_change_cents)}`:''}</p>`:''}
  ${active&&status!=='under_review'&&!o.delivery_paid_cents?`<form id="pos-delivery-fee-form">${field('delivery_fee','Exact courier charge · PHP',status==='pending'?'':amount(o.delivery_cents),'number','required min="0" max="1000000" step="0.01"')}${field('delivery_note','Courier / booking note · optional',o.delivery_fee_note||'','text','maxlength="500"')}<button class="button button-secondary" type="submit">Set exact delivery fee</button></form>`:''}
  ${active&&o.payment_status==='paid'&&['awaiting_payment','under_review'].includes(status)?`<form id="pos-delivery-payment-form"><h3>Record full delivery payment</h3>${paymentFields(o.delivery_cents)}${status==='under_review'?'<p class="notice">A delivery receipt is waiting for review. Open Order history / status to view the private proof.</p>':''}<button class="button" type="submit">Confirm delivery payment received</button></form>`:''}
  ${active&&status==='under_review'?`<details><summary>Request a replacement delivery receipt</summary><form id="pos-delivery-reject-form">${field('reason','Reason','','text','required minlength="3" maxlength="500"')}<button type="submit" class="button button-secondary">Request replacement proof</button></form></details>`:''}</section>`;
 }
 function renderOptions() {
  const p=optionProduct;
  return `<section class="panel pos-review"><h2>${esc(p.name)}</h2><form id="pos-options-form">${p.option_groups.map(g=>`<fieldset class="pos-choice"><legend>${esc(g.label)} · choose ${g.required_count}</legend><div class="pos-option-grid">${g.choices.filter(c=>c.active!==false).map(c=>field(`${g.id}:${c.id}`,`${c.label}${c.surcharge_cents?` +${money(c.surcharge_cents)}`:''}`,0,'number',`min="0" max="${g.required_count}" step="1" required`)).join('')}</div></fieldset>`).join('')}<div class="pos-actions">${button('back','Back')}<button type="submit" class="button">Add to order</button></div></form></section>`;
 }
 function render(){
  if(!root.isConnected)return;
  root.innerHTML=`<div class="view-heading"><div><span class="eyebrow">The Little Baker Kitchen</span><h1>Point of sale</h1><p>Pop-up sales and orders taken through direct messages.</p></div></div><div class="notice danger pos-error" role="alert">${esc(error)}</div>${!connected?'<p class="notice">Connect the backend to record sales.</p>':screen==='review'?renderReview():screen==='receipt'?renderReceipt():screen==='event'?renderEvent(optionProduct):screen==='options'?renderOptions():screen==='custom'?`<section class="panel pos-review"><h2>Custom item</h2><form id="pos-custom-form">${field('name','Item name','','text','required maxlength="160"')}${field('description','Details · optional','','text','maxlength="2000"')}<div class="field-row">${field('quantity','Quantity',1,'number','required min="1" max="10000" step="1"')}${field('price','Unit price · PHP','','number','required min="0" step="0.01"')}</div><div class="pos-actions">${button('back','Back')}<button class="button" type="submit">Add item</button></div></form></section>`:screen==='details'?`<section class="panel pos-review"><h2>Client details · ${esc(receipt.reference)}</h2><form id="pos-details-form">${customerFields(receipt)}${receipt.method==='delivery'?deliveryFields(receipt):''}<label class="field">Order notes · optional<textarea name="instructions" maxlength="2000">${esc(receipt.instructions||'')}</textarea></label><div class="pos-actions">${button('receipt-back','Back')}<button class="button" type="submit">Save details</button></div></form></section>`:screen==='void'?`<section class="panel pos-review"><h2>Void ${esc(receipt.reference)}</h2><p>This removes the sale from sales totals. Any refund must be handled separately.</p><form id="pos-void-form">${field('reason','Reason','','text','required minlength="3" maxlength="500"')}${select('restore','Event stock',opt('','Choose whether stock can be restored','')+opt('yes','Return items to event stock','')+opt('no','Keep items deducted',''))}<div class="pos-actions">${button('receipt-back','Back')}<button class="button button-danger" type="submit">Void sale</button></div></form></section>`:renderSale()}`;
  dirty();
  if(screen==='review'||screen==='receipt') syncPayment();
 }
 async function refresh(){const data=await api('pos_bootstrap');events=data.events||[];orders=data.orders||[];if(!eventId)eventId=events.find(e=>!e.closed&&e.starts_on<=manilaDate()&&e.ends_on>=manilaDate())?.id||'';}
 function addProduct(p,selections={}) {
  const surcharge=(p.option_groups||[]).reduce((sum,g)=>sum+g.choices.reduce((s,c)=>s+(selections[g.id]?.[c.id]||0)*c.surcharge_cents,0),0);
  items.push({product_id:p.id,name:p.name,quantity:source==='popup'?1:p.min_quantity||1,unit_price_cents:(source==='popup'?event().stock.find(s=>s.product_id===p.id).price_cents:p.price_cents)+surcharge,selections,
   description:(p.option_groups||[]).flatMap(g=>g.choices.filter(c=>selections[g.id]?.[c.id]>0).map(c=>`${g.label}: ${selections[g.id][c.id]} × ${c.label}`)).join(' · ')});
 }
 function syncPayment(){
  const form=$('#pos-confirm-form')||$('#pos-payment-form')||$('#pos-delivery-payment-form');if(!form)return;
  const paid=!form.elements.namedItem('payment_state')||value(form,'payment_state')==='paid',cash=value(form,'payment_method')==='cash';
  const panel=form.querySelector('.pos-payment');if(panel)panel.hidden=!paid;
  const input=form.elements.namedItem('cash_received');input.disabled=!paid||!cash;input.closest('label').hidden=!cash;
  const total=screen==='receipt'?(form.id==='pos-delivery-payment-form'?receipt.delivery_cents:productsDue(receipt)):quote.total_cents;
  let change=0;try{change=pesoCents(input.value)-total}catch{change=-total}
  form.querySelector('[data-change]').hidden=!cash;
  form.querySelector('[data-change]').textContent=change>=0?`Change: ${money(change)}`:`Still needed: ${money(-change)}`;
 }
 function readPayment(form,total){return {method:value(form,'payment_method'),amount_cents:total,received_cents:value(form,'payment_method')==='cash'?pesoCents(value(form,'cash_received')):total,reference:value(form,'payment_reference')}}
 async function saved(o){receipt=o;items=[];draft={};pending=null;submissionKey=crypto.randomUUID();paymentKey=crypto.randomUUID();screen='receipt';onOrderSaved?.(o);await refresh().catch(()=>{});render();}
 async function run(task){
  if(busy)return;
  const previousScreen=screen,fields=[...root.querySelectorAll('form input,form select,form textarea')].map(el=>({name:el.name,value:el.value,checked:el.checked}));
  busy=true;dirty();root.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{error='';await task()}catch(e){error=e.message||'Unable to save. Please retry.'}
  finally{
   busy=false;render();
   if(screen===previousScreen&&error){for(const f of fields){const el=[...root.querySelectorAll('[name]')].find(e=>e.name===f.name);if(el){el.value=f.value;if(el.type==='checkbox')el.checked=f.checked}}capture();syncPayment()}
   if(error)$('[role="alert"]')?.scrollIntoView({block:'nearest'});
  }
 }
 root.addEventListener('click',e=>{
  const b=e.target.closest('[data-pos]');if(!b||busy)return;e.preventDefault();e.stopPropagation();capture();
  const action=b.dataset.pos;
  run(async()=>{
   if(action==='source'||action==='new-sale'){
    if(items.length&&!await confirmDialog('Your unsaved items will be cleared.',{title:'Start a new order?',confirmLabel:'Start new order'}))return;
    source=b.dataset.source||source;items=[];draft={};screen='sale';submissionKey=crypto.randomUUID();
   }else if(action==='add'){const p=product(b.dataset.id);if(p.option_groups?.length){optionProduct=p;screen='options'}else addProduct(p)}
   else if(action==='remove')items.splice(Number(b.dataset.index),1);
   else if(action==='custom')screen='custom';
   else if(action==='event-new'||action==='event-edit'){optionProduct=action==='event-edit'?event():null;screen='event'}
   else if(action==='back'){screen='sale';quote=null}
   else if(action==='receipt'){if(items.length&&!await confirmDialog('Your unsaved items will be cleared.',{title:'Leave this draft?',confirmLabel:'Open order'}))return;items=[];draft={};receipt=await api('pos_order_link',{order_id:b.dataset.id});screen='receipt';paymentKey=crypto.randomUUID()}
   else if(action==='receipt-back')screen='receipt';
   else if(action==='details')screen='details';
   else if(action==='void')screen='void';
   else if(action==='copy'){await navigator.clipboard.writeText(posOrderUrl(receipt,settings.site_url||document.baseURI));return setTimeout(()=>{if($('.pos-feedback'))$('.pos-feedback').textContent='Link copied.'},0)}
   else if(action==='print')await printOrderSlips([receipt],{products,settings});
   else if(action==='manage-order')openOrder(receipt.id);
   else if(action==='refresh')await refresh();
  });
 });
 root.addEventListener('input',e=>{
  if(busy)return;
  if(e.target.name==='search') {capture();search=e.target.value;const start=e.target.selectionStart;render();const f=$('[name="search"]');f.focus();f.setSelectionRange(start,start);return}
  if(e.target.name?.startsWith('qty_'))items[Number(e.target.name.slice(4))].quantity=Number(e.target.value);
  if(e.target.name?.startsWith('price_')){try{items[Number(e.target.name.slice(6))].unit_price_cents=pesoCents(e.target.value)}catch{}}
  if(e.target.closest('#pos-sale-form')){capture();const total=$('[data-estimate]');if(total)total.textContent=money(estimate());dirty()}
  syncPayment();
 });
 root.addEventListener('change',e=>{
  if(busy)return;
  if(['method','discount_kind','delivery_fee_pending'].includes(e.target.name)){capture();render()}
  if(e.target.name==='event_id')run(async()=>{const id=e.target.value;if(items.length&&!await confirmDialog('Items in this unsaved sale will be cleared.',{title:'Switch event?',confirmLabel:'Switch event'}))return;eventId=id;items=[];capture()});
  syncPayment();
 });
 root.addEventListener('submit',e=>{
  e.preventDefault();e.stopPropagation();const form=e.target;
  run(async()=>{
   if(form.id==='pos-sale-form'){capture();const p=basePayload();if(p.email_notifications&&!p.buyer.email)throw new Error('Enter a client email or turn off email confirmations.');quote=await api('pos_quote',p);screen='review'}
   else if(form.id==='pos-confirm-form'){
    if(!pending)pending={...basePayload(),expected_quote:quote,idempotency_key:submissionKey,...(value(form,'payment_state')==='paid'?{payment:readPayment(form,quote.total_cents)}:{})};
    try{await saved(await api('pos_create_order',pending))}catch(e){
     // Resolve a potentially lost success response before allowing any edits.
     try{const found=await api('pos_find_submission',{idempotency_key:submissionKey});if(found){await saved(found);return}pending=null}catch{}
     throw e;
    }
   }else if(form.id==='pos-custom-form'){items.push({name:value(form,'name'),description:value(form,'description'),quantity:Number(value(form,'quantity')),unit_price_cents:pesoCents(value(form,'price')),selections:{}});screen='sale'}
   else if(form.id==='pos-options-form'){const selections={};for(const g of optionProduct.option_groups){selections[g.id]={};let sum=0;for(const c of g.choices){const n=Number(value(form,`${g.id}:${c.id}`)||0);if(n)selections[g.id][c.id]=n;sum+=n}if(sum!==g.required_count)throw new Error(`Choose exactly ${g.required_count} for ${g.label}.`)}addProduct(optionProduct,selections);screen='sale'}
   else if(form.id==='pos-event-form'){
    const p={id:form.dataset.id||undefined,revision:Number(form.dataset.revision)||undefined,name:value(form,'name'),location:value(form,'location'),starts_on:value(form,'starts_on'),ends_on:value(form,'ends_on'),closed:checked(form,'closed'),stock:[...form.querySelectorAll('[data-stock-id]')].filter(row=>checked(form,`active_${row.dataset.stockId}`)||event()?.stock.some(s=>s.product_id===row.dataset.stockId)).map(row=>{const id=row.dataset.stockId;return {product_id:id,capacity:Number(value(form,`stock_${id}`)),price_cents:pesoCents(value(form,`price_${id}`)),active:checked(form,`active_${id}`)}})};
    const result=await api('pos_save_event',p);eventId=result.id;await refresh();screen='sale';
   }else if(form.id==='pos-payment-form')await saved(await api('pos_payment',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,payment:readPayment(form,productsDue(receipt))}));
   else if(form.id==='pos-delivery-fee-form')await saved(await api('pos_delivery_fee',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,amount_cents:pesoCents(value(form,'delivery_fee')),note:value(form,'delivery_note')}));
   else if(form.id==='pos-delivery-payment-form')await saved(await api('pos_delivery_payment',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,payment:readPayment(form,receipt.delivery_cents)}));
   else if(form.id==='pos-delivery-reject-form')await saved(await api('pos_delivery_reject',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,reason:value(form,'reason')}));
   else if(form.id==='pos-details-form')await saved(await api('pos_update_details',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,buyer:{name:value(form,'name'),phone:value(form,'phone'),email:value(form,'email'),social_platform:value(form,'social_platform'),social_username:value(form,'social_username')},recipient:{name:value(form,'recipient_name'),phone:value(form,'recipient_phone')},address:{line1:value(form,'address')},instructions:value(form,'instructions'),email_notifications:checked(form,'email_notifications')}));
   else if(form.id==='pos-void-form'){if(!value(form,'restore'))throw new Error('Choose whether to return the items to stock.');await saved(await api('pos_void_sale',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,reason:value(form,'reason'),restore_stock:value(form,'restore')==='yes'}))}
  });
 });
 if(!connected){render();return}
 root.textContent='Opening point of sale…';
 try{await refresh();if(orderId){receipt=await api('pos_order_link',{order_id:orderId});screen='receipt'}}catch(e){error=e.message}
 render();
}
