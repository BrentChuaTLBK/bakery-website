import {posAppMarkup,refreshPOSConnection} from './pos-app.js?v=pos-app-1';
import {escapeHtml as esc,money,manilaDate} from './client.js?v=approved-20261002-1';
import {accountingDatePicker,bindAccountingDates} from './accounting-date-picker.js?v=branded-calendars-1';
import {confirmDialog} from './site-dialog.js?v=brand-20261001';
import {POS_METHODS,pesoCents,posEstimate,posOrderUrl,salesSource,productsDue,deliveryStatusText} from './pos.js?v=pos-1';

import {defaultPOSConfig,posPaymentFields,posCashView,posMethodsView} from './pos-register.js?v=approved-20261002-1';

const amount=cents=>(Number(cents||0)/100).toFixed(2);
const field=(name,label,value='',type='text',attrs='')=>type==='date'?accountingDatePicker(name,label,value,manilaDate(),{attrs}):`<label class="field">${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const opt=(value,label,current)=>`<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(label)}</option>`;
const select=(name,label,content)=>`<label class="field">${esc(label)}<select name="${name}">${content}</select></label>`;
const button=(action,label,extra='')=>`<button type="button" class="button button-secondary" data-pos="${action}" ${extra}>${label}</button>`;


export async function mountPOS(root,{api:remoteApi,role,connected,products=[],settings={},printOrderSlips,onOrderSaved,openOrder,orderId}) {
 const api=(...args)=>{if(navigator.onLine===false)throw new Error('Reconnect to the internet before continuing. No sale or payment was sent.');return remoteApi(...args)};
 let events=[],orders=[],screen='sale',source='popup',eventId='',items=[],draft={},quote=null,receipt=null,error='',busy=false,search='',optionProduct=null;
 let eventDraft=null,eventPicker=false,eventSearch='',section='sell',mobilePane='products',feedback='',optionReturnId='',optionReturnCustom=false;
 let registerConfig=defaultPOSConfig(),cashSessions=[],cashEventId='',cashMode='',methodsDraft=null,registerDirty=false,registerPending=null;
 const paymentFields=total=>posPaymentFields(registerConfig,total);
 const openDrawer=id=>cashSessions.find(s=>s.event_id===id&&!s.closed_at);
 let pending=null,editing=null,submissionKey=crypto.randomUUID(),paymentKey=crypto.randomUUID();
 const editable=o=>o?.source==='direct_message'&&!o.refund_label&&!['cancelled','expired','completed'].includes(o.fulfillment_status)&&o.payment_status!=='under_review'&&o.delivery_payment_status!=='under_review';
 const $=selector=>root.querySelector(selector);
 const value=(form,name)=>form?.elements.namedItem(name)?.value?.trim()??'';
 const checked=(form,name)=>Boolean(form?.elements.namedItem(name)?.checked);
 const event=()=>events.find(e=>e.id===eventId);
 const product=id=>products.find(p=>p.id===id);
 const flavorDraft=(p,s)=>structuredClone(s?.option_groups||p?.option_groups||[]).map(g=>({...g,choices:g.choices.map(c=>({...c,capacity:c.capacity??c.used??0,price:amount(c.surcharge_cents)}))}));
 const automaticStock=s=>s.flavor_groups?.length===1&&s.flavor_groups[0].required_count===1;
 const savedEventItem=s=>{const e=events.find(e=>e.id===eventDraft.id);return s.custom?e?.custom_stock?.find(v=>v.id===s.id):e?.stock.find(v=>v.product_id===s.product_id)};
 const blankFlavor=(s,g,c)=>c.custom&&!c.label?.trim()&&!savedEventItem(s)?.option_groups?.find(v=>v.id===g.id)?.choices.some(v=>v.id===c.id)&&(c.active===false||(!Number(c.capacity)&&!Number(c.price)));
 const flavorCapacity=s=>Math.max(Number(s.used||0),Number(s.unassigned_used||0)+s.flavor_groups[0].choices.reduce((n,c)=>n+(blankFlavor(s,s.flavor_groups[0],c)?0:Number(c.capacity)||0),0));
 const stockLeft=s=>s?.options_tracked?Math.max(0,Math.min(s.remaining,...s.option_groups.map(g=>Math.floor(g.choices.filter(c=>c.active!==false).reduce((n,c)=>n+Number(c.remaining||0),0)/g.required_count)))):s?.remaining||0;
 const sameOptionItem=(i,p)=>p.custom_event_item_id?i.custom_event_item_id===p.custom_event_item_id:i.product_id===p.id;
 const choiceLeft=(p,g,c)=>c.remaining==null?Infinity:Math.max(0,c.remaining-items.filter(i=>sameOptionItem(i,p)).reduce((n,i)=>n+i.quantity*(i.selections?.[g.id]?.[c.id]||0),0));
 const saleProduct=p=>{const s=source==='popup'?event()?.stock.find(s=>s.product_id===p.id):null;return s?.options_tracked?{...p,option_groups:s.option_groups}:p};
 const eventReady=e=>Boolean(e&&!e.closed&&e.starts_on<=manilaDate()&&e.ends_on>=manilaDate());
 const itemCount=()=>items.reduce((sum,i)=>sum+(Number(i.quantity)||0),0);
 function sectionNav(){return `<div class="pos-heading"><div><span class="eyebrow">TLB Kitchen</span><h1>Point of sale</h1></div><button type="button" class="button button-secondary pos-dashboard" data-view="overview">Dashboard</button></div><nav class="pos-section-nav" aria-label="Point of sale sections">${[['sell','Sell'],['drawer','Cash drawer'],['orders','Orders'],...(role==='owner'?[['setup','Event setup'],['methods','Payment methods']]:[])].map(([id,label])=>`<button type="button" data-pos="section" data-section="${id}" aria-current="${section===id?'page':'false'}" ${pending||registerPending?'disabled':''}>${label}</button>`).join('')}</nav>`}
 function setupView(){return `<section class="panel pos-setup"><div class="section-heading"><div><h2>Event setup</h2><p class="help-text">Prepare products, prices and stock before opening your counter.</p></div>${button('event-new','+ New event')}</div><div class="pos-events">${events.map(e=>{const stock=[...(e.stock||[]),...(e.custom_stock||[])].filter(s=>s.active),ready=eventReady(e);return `<article class="pos-event-card"><div class="section-heading"><h3>${esc(e.name)}</h3><span class="badge">${e.closed?'Closed':ready?'Open today':e.starts_on>manilaDate()?'Upcoming':'Ended'}</span></div><p>${esc(e.location||'Location not set')}</p><p>${esc(e.starts_on)} to ${esc(e.ends_on)}</p><div class="pos-event-facts"><span><strong>${stock.length}</strong> products</span><span><strong>${stock.reduce((n,s)=>n+stockLeft(s),0)}</strong> left</span></div>${e.sales?.length?`<details class="pos-event-totals"><summary>Sales totals</summary>${e.sales.map(s=>`<p>${esc(POS_METHODS[s.payment_method]||s.payment_method)} <strong>${money(s.total_cents)}</strong></p>`).join('')}</details>`:''}<div class="pos-actions">${button('event-edit','Edit event',`data-id="${e.id}"`)}${button('event-sell','Open counter',`data-id="${e.id}" ${ready?'':'disabled'}`)}</div></article>`}).join('')||'<p class="pos-empty">No events yet. Create an event and choose what you will sell.</p>'}</div></section>`}
 function mobileDock(){return `<div class="pos-mobile-dock"><button type="button" class="button button-secondary" data-pos="mobile-products" ${mobilePane==='products'?'aria-current="page"':''}>Products</button>${mobilePane==='basket'?`<button type="submit" form="pos-sale-form" class="button" aria-label="${editing?'Review changes':source==='popup'?'Review sale':'Review order'}" ${!items.length?'disabled':''}>${editing?'Review changes':source==='popup'?'Review sale':'Review order'} <span data-dock-total>${money(estimate())}</span></button>`:`<button type="button" class="button" data-pos="mobile-basket">Basket · <span data-basket-count>${itemCount()}</span> <span data-dock-total>${money(estimate())}</span></button>`}</div>`}
 function syncMobile(){root.dataset.pane=mobilePane;const total=$('[data-dock-total]');if(total)total.textContent=money(estimate());const count=$('[data-basket-count]');if(count)count.textContent=itemCount()}
 function scrollToPOS(){root.scrollIntoView({block:'start',behavior:'instant'})}
 async function leaveEditor(){return !(['event','details','custom','options','void'].includes(screen)||registerDirty)||await confirmDialog('Your unsaved changes on this screen will be lost.',{title:'Leave this screen?',confirmLabel:'Discard changes',cancelLabel:'Keep editing'})}

 const dirty=()=>{root.dataset.dirty=String(Boolean(editing)||items.length>0||registerDirty||['event','details','custom','options','void'].includes(screen)||['name','phone','email','social_username','recipient_name','recipient_phone','address','instructions'].some(k=>draft[k]));root.dataset.busy=String(busy||Boolean(pending)||Boolean(registerPending));};
 function capture() {
  const form=$('#pos-sale-form');if(!form)return;
  draft=Object.fromEntries(new FormData(form));draft.email_notifications=checked(form,'email_notifications');draft.override_dates=checked(form,'override_dates');draft.delivery_fee_pending=checked(form,'delivery_fee_pending');
 }
 function basePayload(readForm=true) {
  if(readForm)capture();
  const kind=draft.discount_kind||'none';
  return {source,event_id:eventId||null,items:items.map(({name,description,quantity,product_id,custom_event_item_id,selections,unit_price_cents})=>({name,description,quantity,product_id,custom_event_item_id,selections,...(source==='direct_message'&&!product_id?{unit_price_cents}: {})})),
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
 function cartLimit(item){
  if(source!=='popup')return 10000;
  const other=items.filter(i=>i!==item),s=item.product_id?event()?.stock.find(s=>s.product_id===item.product_id):event()?.custom_stock.find(s=>s.id===item.custom_event_item_id);
  let limit=Math.min(10000,Math.max(0,(s?.remaining||0)-other.filter(i=>item.product_id?i.product_id===item.product_id:i.custom_event_item_id===item.custom_event_item_id).reduce((n,i)=>n+i.quantity,0)));
  if(s?.options_tracked)for(const g of s.option_groups)for(const c of g.choices){const selected=item.selections?.[g.id]?.[c.id]||0;if(selected)limit=Math.min(limit,c.active===false?0:Math.floor((c.remaining-other.filter(i=>item.product_id?i.product_id===item.product_id:i.custom_event_item_id===item.custom_event_item_id).reduce((n,i)=>n+i.quantity*(i.selections?.[g.id]?.[c.id]||0),0))/selected))}
  return Math.max(0,limit);
 }
 function syncCart(){
  items.forEach((item,index)=>{const row=$(`[data-cart-line="${index}"]`);if(!row)return;row.querySelector('[data-unit-price]').textContent=money(item.unit_price_cents);const total=row.querySelector('[data-line-total]');total.hidden=item.quantity===1;total.innerHTML=`<strong>${money(item.quantity*item.unit_price_cents)}</strong> for ${item.quantity}`;row.querySelector('[name^="qty_"]').max=Math.max(1,cartLimit(item));row.querySelector('[data-delta="-1"]').disabled=item.quantity<=1;row.querySelector('[data-delta="1"]').disabled=item.quantity>=cartLimit(item)});
 }
 function renderSale() {
  const stock=eventReady(event())?event().stock:[],customStock=source==='popup'&&eventReady(event())?(event()?.custom_stock||[]).filter(s=>s.active&&s.name.toLowerCase().includes(search.toLowerCase())):[],catalog=products.filter(p=>!p.deleted_at&&(source==='popup'?stock.some(s=>s.product_id===p.id&&s.active):p.active)).filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
  return `${editing?renderEditHeading():`<div class="pos-tabs" aria-label="Sales type">${['popup','direct_message'].map(s=>`<button type="button" class="button button-secondary" data-pos="source" data-source="${s}" aria-pressed="${source===s}">${s==='popup'?'Pop-up sale':'Direct order'}</button>`).join('')}</div>`}
   <form id="pos-sale-form"><div class="pos-layout"><section class="panel pos-products-panel"><div class="pos-entry-title"><h2>${source==='popup'?'Event counter':'Choose products'}</h2>${source==='direct_message'?button('custom','+ Custom item'):''}</div>
   ${source==='popup'?`<div class="pos-event-select">${select('event_id','Selling at',opt('','Choose an event',eventId)+events.filter(eventReady).map(e=>opt(e.id,e.name,eventId)).join(''))}</div>${eventId&&!eventReady(event())?'<p class="notice">The selected event is no longer open. Choose another event to start a new sale.</p>':!events.some(eventReady)?`<p class="notice">No event is open today. ${role==='owner'?'Prepare an event under Event setup, then return here to sell.':'Ask the owner to set up an event for today.'}</p>`:''}`:''}
   ${field('search','Find a product',search,'search','autocomplete="off"')}<div class="pos-catalog">${catalog.map(p=>{const s=stock.find(s=>s.product_id===p.id);return `<button type="button" class="pos-product" data-pos="add" data-id="${p.id}" ${source==='popup'&&(!stockLeft(s)||event()?.closed)?'disabled':''}><strong>${esc(p.name)}</strong><span>${money(source==='popup'?s.price_cents:p.price_cents)}</span><small>${source==='popup'?`${stockLeft(s)} left at event`:`${p.min_quantity||1} minimum · ${p.lead_days||0} production days`}</small></button>`}).join('')}${customStock.map(s=>`<button type="button" class="pos-product" data-pos="add-event-custom" data-id="${s.id}" ${!stockLeft(s)||event()?.closed?'disabled':''}><strong>${esc(s.name)}</strong><span>${money(s.price_cents)}</span><small>${stockLeft(s)} left at event · Custom product</small></button>`).join('')}${!catalog.length&&!customStock.length?'<p class="muted">No products selected for this view.</p>':''}</div></section>
   <section class="panel pos-basket-panel"><h2>${source==='popup'?'Your sale':'Direct order'}</h2><ul class="pos-cart">${items.map((item,index)=>`<li data-cart-line="${index}"><div class="pos-cart-info"><strong>${esc(item.name)}</strong><p class="pos-unit-price"><strong data-unit-price>${money(item.unit_price_cents)}</strong> <small>each</small></p><p class="pos-line-total" data-line-total ${item.quantity===1?'hidden':''}><strong>${money(item.quantity*item.unit_price_cents)}</strong> for ${item.quantity}</p>${item.description?`<small class="pos-cart-description">${esc(item.description)}</small>`:''}${source==='direct_message'&&!item.product_id?field(`price_${index}`,'Unit price · PHP',amount(item.unit_price_cents),'number','min="0" step="0.01" required'):''}</div><div class="pos-cart-controls"><span class="option-stepper pos-quantity"><button type="button" data-pos="quantity" data-index="${index}" data-delta="-1" aria-label="Decrease ${esc(item.name)} quantity" ${item.quantity<=1?'disabled':''}>&minus;</button><input name="qty_${index}" aria-label="${esc(item.name)} quantity" type="number" value="${item.quantity}" min="1" max="${Math.max(1,cartLimit(item))}" step="1" inputmode="numeric" required><button type="button" data-pos="quantity" data-index="${index}" data-delta="1" aria-label="Increase ${esc(item.name)} quantity" ${item.quantity>=cartLimit(item)?'disabled':''}>+</button></span>${button('remove','&times;',`data-index="${index}" aria-label="Remove ${esc(item.name)}"`)}</div></li>`).join('')||'<li class="pos-empty">Choose products to start.</li>'}</ul>
   <div class="field-row">${select('discount_kind','Discount',['none','percent','fixed'].map(k=>opt(k,{none:'No discount',percent:'Percentage',fixed:'Amount · PHP'}[k],draft.discount_kind||'none')).join(''))}${field('discount_value','Discount value',draft.discount_value||'0','number','min="0" step="0.01"')}</div>
   ${source==='direct_message'?`<div class="field-row">${field('fulfillment_date','Fulfillment date',draft.fulfillment_date||manilaDate(),'date','required')}${select('method','Fulfillment',opt('pickup','Pickup',draft.method||'pickup')+opt('delivery','Delivery',draft.method))}</div>${draft.method==='delivery'?`<label class="check-field"><input type="checkbox" name="delivery_fee_pending" ${draft.delivery_fee_pending?'checked':''}><span>Delivery fee pending · collect separately later</span></label>${draft.delivery_fee_pending?'<p class="help-text">Collect full product payment now. Enter the exact courier charge and record its payment later.</p>':field('delivery_fee','Delivery fee · PHP',draft.delivery_fee||'0','number','min="0" step="0.01" required')}${deliveryFields()}`:''}${role==='owner'?`<details><summary>Owner date override</summary><label class="check-field"><input type="checkbox" name="override_dates" ${draft.override_dates?'checked':''}><span>Override lead times and closed dates</span></label>${field('override_reason','Reason for override · optional',draft.override_reason||'','text','maxlength="500"')}<p class="help-text">Stock limits and pickup-only products still apply.</p></details>`:''}<p class="help-text">Unpaid orders reserve stock until you cancel them.</p>`:''}
   <details class="pos-customer" ${source==='direct_message'?'open':''}><summary>Client details · all optional</summary>${customerFields()}</details><label class="field">Order notes · optional<textarea name="instructions" maxlength="2000">${esc(draft.instructions||'')}</textarea></label><div class="pos-total"><span>Estimated total</span><span data-estimate>${money(estimate())}</span></div><button class="button block pos-desktop-review" type="submit" ${!items.length?'disabled':''}>${editing?'Review changes':source==='popup'?'Review sale':'Review order'}</button></section></div></form>${mobileDock()}`;
 }
 function renderEditHeading(){return `<div class="pos-edit-heading"><div><h2>Editing ${esc(editing.reference)}</h2><p>Changes are saved after you review and confirm them.</p></div>${button('edit-cancel','Cancel edits')}</div>`}
 function startEdit(o){
  if(!editable(o))throw new Error('This order cannot be edited now. Review any pending payment proof or open Client details for a closed order.');
  editing=o;source='direct_message';eventId='';section='sell';screen='sale';mobilePane='basket';search='';quote=null;submissionKey=crypto.randomUUID();
  items=structuredClone(o.items).map(i=>({...i,description:i.description||(i.selection_labels||[]).map(c=>`${c.group}: ${c.quantity} × ${c.label}`).join(' · ')}));
  draft={...o.buyer,fulfillment_date:o.fulfillment_date,method:o.method,recipient_name:o.recipient?.name||'',recipient_phone:o.recipient?.phone||'',address:o.address?.line1||'',instructions:o.instructions||'',
   discount_kind:o.discount?.kind||'none',discount_value:o.discount?.kind==='percent'?String(o.discount.value):amount(o.discount?.value||0),delivery_fee:amount(o.delivery_cents),delivery_fee_pending:o.deferred_delivery&&o.delivery_payment_status==='pending',
   email_notifications:Boolean(o.email_notifications),override_dates:Boolean(o.override_dates),override_reason:o.override_reason||''};
 }
 function renderEditReview(){
  return `<section class="panel pos-review"><h2>Review changes · ${esc(editing.reference)}</h2><ul class="pos-review-lines">${quote.items.map(i=>`<li><span>${i.quantity} × ${esc(i.name)}${i.description?`<small> · ${esc(i.description)}</small>`:''}</span><strong>${money(i.line_total_cents)}</strong></li>`).join('')}</ul><p>Subtotal: ${money(quote.subtotal_cents)} · Discount: ${money(quote.discount_cents)} · Delivery: ${quote.delivery_payment_status==='pending'?'Fee pending':money(quote.delivery_cents)}</p><div class="pos-total"><span>Previous total</span><span>${money(editing.total_cents)}</span></div><div class="pos-total"><span>New total</span><span>${money(quote.total_cents)}</span></div><p>${esc(quote.fulfillment_date)} · ${esc(quote.method)}${draft.name?` · ${esc(draft.name)}`:''}</p><p class="notice">${editing.payment_status==='paid'?'This order stays Paid. Settle any payment difference manually. Sales and accounting use the revised amounts.':'This order stays awaiting payment. The same customer link will show the updated total.'}</p>${quote.deferred_delivery?`<p>${esc(deliveryStatusText(quote))}</p>`:''}<form id="pos-confirm-form"><label class="field">Reason for changes · optional<textarea name="amendment_reason" maxlength="4000"></textarea></label><div class="pos-actions">${button('back','Back to edit',pending?'disabled':'')}<button type="submit" class="button">${pending?'Retry saving changes':'Save changes'}</button></div></form></section>`;
 }
 function renderReview() {
  if(editing)return renderEditReview();
  return `<section class="panel pos-review"><h2>Review ${source==='popup'?'pop-up sale':'direct order'}</h2>${quote.deferred_delivery?'<p class="notice">Delivery fee pending. This payment covers products only; the exact delivery fee will be collected separately.</p>':''}<ul class="pos-review-lines">${quote.items.map(i=>`<li><span>${i.quantity} × ${esc(i.name)}${i.description?`<small> · ${esc(i.description)}</small>`:''}</span><strong>${money(i.line_total_cents)}</strong></li>`).join('')}</ul><p>Subtotal: ${money(quote.subtotal_cents)} · Discount: ${money(quote.discount_cents)} · Delivery: ${quote.deferred_delivery?'Fee pending':money(quote.delivery_cents)}</p><div class="pos-total"><span>Total</span><span>${money(quote.total_cents)}</span></div><p>${esc(draft.name||'Client not recorded')}${source==='direct_message'?` · ${esc(quote.fulfillment_date)} · ${esc(quote.method)}`:` · ${esc(event()?.name)}`}</p>${quote.method==='delivery'&&!draft.address?'<p class="notice">Delivery address is not recorded. Add it to the saved order before arranging the courier.</p>':''}
   <form id="pos-confirm-form">${source==='direct_message'?select('payment_state','Payment',opt('unpaid','Awaiting payment · share a payment link','unpaid')+opt('paid','Full payment already received','unpaid')):'<input type="hidden" name="payment_state" value="paid">'}<div class="pos-payment" ${source==='direct_message'?'hidden':''}>${paymentFields(quote.total_cents)}<p class="help-text">Record payment only after you have received the full amount.</p></div><p class="help-text">${draft.email_notifications?`Email updates will be sent to ${esc(draft.email)}.`:'Email updates are off.'}</p><div class="pos-actions">${button('back','Back to edit',pending?'disabled':'')}<button type="submit" class="button">${pending?'Retry saving this order':source==='popup'?'Complete sale':'Create direct order'}</button></div></form></section>`;
 }
 function startEvent(e) {
  editing=null;
  eventDraft={id:e?.id,revision:e?.revision,name:e?.name||'',location:e?.location||'',starts_on:e?.starts_on||manilaDate(),ends_on:e?.ends_on||manilaDate(),closed:e?.closed||false,
   entries:[...(e?.stock||[]).filter(s=>s.active).map(s=>({...s,id:s.product_id,name:product(s.product_id)?.name||'Unavailable product',price:amount(s.price_cents),flavor_groups:s.options_tracked?flavorDraft(product(s.product_id),s):null})),...(e?.custom_stock||[]).filter(s=>s.active).map(s=>({...s,custom:true,price:amount(s.price_cents),flavor_groups:s.options_tracked?flavorDraft(null,s):null}))]};
  eventPicker=false;eventSearch='';section='setup';screen='event';
 }
 function captureEvent(){
  const f=$('#pos-event-form');if(!f)return;
  for(const key of ['name','location','starts_on','ends_on'])eventDraft[key]=value(f,key);
  eventDraft.closed=checked(f,'closed');
  for(const s of eventDraft.entries){
   s.capacity=value(f,`stock_${s.id}`);s.price=value(f,`event_price_${s.id}`);
   if(s.custom){s.name=value(f,`custom_name_${s.id}`);s.description=value(f,`custom_description_${s.id}`)}
   for(const g of s.flavor_groups||[])for(const c of g.choices){
    const key=`flavor_${s.id}_${g.id}_${c.id}`;
    c.capacity=value(f,key);c.active=checked(f,`${key}_active`);
    if(c.custom){c.label=value(f,`${key}_label`);c.price=value(f,`${key}_price`)}
   }
   if(automaticStock(s)){s.capacity=flavorCapacity(s);f.elements.namedItem(`stock_${s.id}`).value=s.capacity}
   for(const g of s.flavor_groups||[])for(const c of g.choices)if(c.custom){const key=`flavor_${s.id}_${g.id}_${c.id}`;f.elements.namedItem(`${key}_label`).required=!blankFlavor(s,g,c)}
  }
 }
 function renderEventFlavors(s){
  if(s.custom&&!s.flavor_groups)return `<p>${button('event-custom-flavors','+ Add flavors',`data-id="${s.id}"`)}</p>`;
  if(!s.flavor_groups)return product(s.product_id)?.option_groups?.length?`<p>${button('event-flavors','Set stock per flavor',`data-id="${s.id}"`)}</p>`:'';
  return `<div class="pos-flavor-stock"><h4>Flavors & options</h4><p class="help-text">Check the flavors offered here and enter their total stock, including units already sold. Empty extra-flavor rows are skipped when saving.${automaticStock(s)?' Product stock is calculated from these flavors.':' Each sale uses the chosen quantities from these stocks and one unit of total product stock.'}</p>${s.flavor_groups.map((g,gi)=>`<fieldset class="pos-flavor-group"><legend>${esc(g.label)} · choose ${g.required_count}</legend>${g.choices.map(c=>{
   const key=`flavor_${s.id}_${g.id}_${c.id}`,toggle=`<label class="check-field"><input type="checkbox" name="${key}_active" ${c.active!==false?'checked':''}><span>${c.custom?'Offer this event flavor':esc(c.label)}</span></label>`,meta=`${c.used||0} sold / retained${c.custom?' · Event only':c.surcharge_cents?' · +'+money(c.surcharge_cents):''}`;
   return `<div class="pos-flavor-row ${c.custom?'pos-flavor-row-custom':''}" data-flavor-id="${esc(c.id)}">${c.custom?`<div class="pos-flavor-actions">${toggle}${button('event-flavor-remove',c.used?'Stop offering':'Remove',`data-id="${s.id}" data-group="${gi}" data-choice="${esc(c.id)}" aria-label="${c.used?'Stop offering':'Remove'} ${esc(c.label||'extra flavor')}" ${c.used&&c.active===false?'disabled':''}`)}</div>${field(`${key}_label`,'Flavor name',c.label,'text',`${blankFlavor(s,g,c)?'':'required'} maxlength="120"`)} `:`<div class="pos-flavor-name">${toggle}<small>${meta}</small></div>`}${field(key,'Total flavor stock',c.capacity,'number',`required min="${c.used||0}" max="100000" step="1" inputmode="numeric"`)}${c.custom?field(`${key}_price`,'Extra per choice · PHP',c.price,'number','required min="0" max="1000000" step="0.01"')+`<small class="pos-flavor-meta">${meta}${c.used?' · Turn off to keep the sales record.':''}</small>`:''}</div>`;
  }).join('')}${button('event-flavor-add','+ Add event-only flavor',`data-id="${s.id}" data-group="${gi}"`)}</fieldset>`).join('')}</div>`;
 }
 function renderEvent(){
  const e=eventDraft,available=products.filter(p=>!p.deleted_at&&!e.entries.some(s=>s.product_id===p.id)&&p.name.toLowerCase().includes(eventSearch.toLowerCase()));
  return `<section class="panel"><h2>${e.id?'Edit event & stock':'New pop-up event'}</h2><form id="pos-event-form"><div class="field-row">${field('name','Event name',e.name,'text','required maxlength="120"')}${field('location','Location',e.location,'text','maxlength="500"')}</div><div class="field-row">${field('starts_on','Start date',e.starts_on,'date','required')}${field('ends_on','End date',e.ends_on,'date','required')}</div><label class="check-field"><input type="checkbox" name="closed" ${e.closed?'checked':''}><span>Close this event to new sales</span></label>
   <div class="section-heading"><h3>Products at this event · ${e.entries.length}</h3><div class="pos-actions">${button('event-picker','Choose from lineup',`aria-expanded="${eventPicker}"`)}${button('event-custom','+ Custom product')}</div></div>
   <p class="help-text">Only products added here appear at this event. Event prices and stock are separate from the website. Total stock includes units already sold.</p>
   ${eventPicker?`<section class="pos-lineup-picker" aria-label="Choose from existing lineup"><div class="section-heading"><h3>Choose from your lineup</h3>${button('event-picker','Done')}</div>${field('event_search','Search your products',eventSearch,'search','autocomplete="off"')}<div class="pos-picker-list">${available.slice(0,20).map(p=>`<div><span><strong>${esc(p.name)}</strong><small>${money(p.price_cents)}${p.active?'':' · Hidden on website'}</small></span>${button('event-add','+ Add',`data-id="${p.id}" aria-label="Add ${esc(p.name)} to event"`)}</div>`).join('')||'<p class="muted">No more matching products.</p>'}</div>${available.length>20?'<p class="help-text">Search to narrow down your products.</p>':''}</section>`:''}
   <div class="pos-event-items">${e.entries.map(s=>`<section class="pos-event-item" data-stock-id="${s.id}"><div class="section-heading"><div><strong>${s.custom?'Custom event product':esc(s.name)}</strong><p class="help-text">${s.custom?'Only available at this event':'From your existing lineup'} · ${s.used||0} sold / retained</p></div>${button('event-remove','Remove',`data-id="${s.id}" aria-label="Remove ${esc(s.name||'custom product')} from event"`)}</div>${s.custom?field(`custom_name_${s.id}`,'Product name',s.name,'text','required maxlength="160"')+field(`custom_description_${s.id}`,'Details · optional',s.description||'','text','maxlength="2000"'):''}<div class="field-row">${field(`stock_${s.id}`,'Total stock',s.capacity,'number',`required min="${s.used||0}" max="100000" step="1" ${automaticStock(s)?'readonly aria-description="Calculated from flavor stock"':''}`)}${field(`event_price_${s.id}`,'Event price · PHP',s.price,'number','required min="0" max="1000000" step="0.01"')}</div>${renderEventFlavors(s)}</section>`).join('')||'<p class="pos-empty">No products added yet. Choose from your lineup or add a custom product.</p>'}</div>
   <div class="pos-actions">${button('back','Back to events')}<button class="button" type="submit">Save event</button></div></form></section>`;
 }
 function renderReceipt() {
  const o=receipt,unpaid=['awaiting_payment','under_review'].includes(o.payment_status)&&o.fulfillment_status==='pending_confirmation';
  const link=posOrderUrl(o,settings.site_url||document.baseURI);
  return `<section class="panel pos-receipt"><h2>${esc(o.reference)}</h2><p>${esc(salesSource(o))}${o.event_name?` · ${esc(o.event_name)}`:''} · ${esc(o.fulfillment_status.replaceAll('_',' '))}</p><p>${esc(o.buyer?.name||'Client not recorded')} · ${esc(o.payment_status.replaceAll('_',' '))}${o.payment_method?` · ${esc(o.payment_method_label||POS_METHODS[o.payment_method]||o.payment_method)}`:''}</p><ul class="pos-review-lines">${o.items.map(i=>`<li><span>${i.quantity} × ${esc(i.name)}</span><strong>${money(i.line_total_cents)}</strong></li>`).join('')}</ul><div class="pos-total"><span>Total</span><span>${money(o.total_cents)}</span></div>${o.payment_method==='cash'?`<p>Cash received: ${money(o.cash_received_cents)} · <strong>Change: ${money(o.change_cents)}</strong></p>`:''}${unpaid?'<p class="notice">Stock stays reserved until you cancel this order. Share the link for payment details and proof upload.</p>':''}<label class="field">Private order link<div class="pos-link"><input data-share-link readonly value="${esc(link)}">${button('copy','Copy link')}</div></label><p class="help-text">Share this link with the customer only.</p><div class="pos-actions">${editable(o)?button('edit-order','Edit order'):''}${button('print','Print slip')}${button('details','Client details')}${button('manage-order','Order history / status')}${o.source==='popup'&&o.fulfillment_status==='completed'&&role==='owner'?button('void','Void sale'):''}${button('new-sale','New sale / order')}</div>
   ${unpaid?`<form id="pos-payment-form" class="pos-payment"><h3>${o.deferred_delivery?'Record full product payment':'Record full payment'}</h3>${paymentFields(productsDue(o))}<button class="button" type="submit">Confirm payment received</button></form>`:''}${deliveryPanel(o)}<p class="pos-feedback" role="status"></p></section>`;
 }
 function deliveryPanel(o) {
  if(!o.deferred_delivery)return '';
  const active=!o.refund_label&&!['cancelled','expired'].includes(o.fulfillment_status),status=o.delivery_payment_status;
  return `<section class="pos-payment"><h3>${esc(deliveryStatusText(o))}</h3><p>Products: ${o.payment_status==='paid'?'Paid':'Awaiting payment'} · ${money(productsDue(o))}<br>Delivery: ${status==='pending'?'Fee to follow':money(o.delivery_cents)}</p>${o.delivery_paid_cents?`<p>Delivery paid by ${esc(o.delivery_payment_method_label||POS_METHODS[o.delivery_payment_method]||o.delivery_payment_method)}${o.delivery_payment_method==='cash'?` · Cash ${money(o.delivery_cash_received_cents)} · Change ${money(o.delivery_change_cents)}`:''}</p>`:''}
  ${active&&status!=='under_review'&&!o.delivery_paid_cents?`<form id="pos-delivery-fee-form">${field('delivery_fee','Exact courier charge · PHP',status==='pending'?'':amount(o.delivery_cents),'number','required min="0" max="1000000" step="0.01"')}${field('delivery_note','Courier / booking note · optional',o.delivery_fee_note||'','text','maxlength="500"')}<button class="button button-secondary" type="submit">Set exact delivery fee</button></form>`:''}
  ${active&&o.payment_status==='paid'&&['awaiting_payment','under_review'].includes(status)?`<form id="pos-delivery-payment-form"><h3>Record full delivery payment</h3>${paymentFields(o.delivery_cents)}${status==='under_review'?'<p class="notice">A delivery receipt is waiting for review. Open Order history / status to view the private proof.</p>':''}<button class="button" type="submit">Confirm delivery payment received</button></form>`:''}
  ${active&&status==='under_review'?`<details><summary>Request a replacement delivery receipt</summary><form id="pos-delivery-reject-form">${field('reason','Reason','','text','required minlength="3" maxlength="500"')}<button type="submit" class="button button-secondary">Request replacement proof</button></form></details>`:''}</section>`;
 }
 function renderCustomItem() {
  return `<dialog id="pos-custom-dialog" class="pos-options-dialog" aria-labelledby="pos-custom-title"><div class="pos-options-heading"><h2 id="pos-custom-title">Custom item</h2>${button('custom-close','&times;','aria-label="Close custom item"')}</div><p class="notice danger" role="alert" ${error?'':'hidden'}>${esc(error)}</p><form id="pos-custom-form">${field('name','Item name','','text','autofocus required maxlength="160"')}${field('description','Details · optional','','text','maxlength="2000"')}<div class="field-row">${field('quantity','Quantity',1,'number','required min="1" max="10000" step="1"')}${field('price','Unit price · PHP','','number','required min="0" step="0.01" inputmode="decimal"')}</div><div class="pos-actions">${button('custom-close','Cancel')}<button class="button" type="submit">Add item</button></div></form></dialog>`;
 }
 function renderOptions() {
  return `<dialog id="pos-options-dialog" class="pos-options-dialog" aria-labelledby="pos-options-title"><div class="pos-options-heading"><h2 id="pos-options-title">${esc(optionProduct.name)}</h2>${button('options-close','&times;','aria-label="Close flavors" autofocus')}</div><p class="notice danger" role="alert" ${error?'':'hidden'}>${esc(error)}</p><form id="pos-options-form">${optionProduct.option_groups.map((g,gi)=>`<fieldset class="pos-choice" data-option-group="${gi}"><legend>${esc(g.label)} · choose ${g.required_count}</legend>${g.choices.filter(c=>c.active!==false).map(c=>{const left=choiceLeft(optionProduct,g,c),limit=Math.min(g.required_count,left);return `<div class="option-choice"><label for="pos-choice-${esc(g.id)}-${esc(c.id)}">${esc(c.label)}${Number.isFinite(left)?`<small class="pos-choice-stock">${left?left+' left':'Sold out / in basket'}</small>`:''}</label><span class="option-choice-controls"><small>${c.surcharge_cents?'+'+money(c.surcharge_cents):money(0)}</small><span class="option-stepper"><button type="button" data-pos-option-delta="-1" aria-label="Decrease ${esc(c.label)} quantity" disabled>&minus;</button><input id="pos-choice-${esc(g.id)}-${esc(c.id)}" class="option-count" name="${esc(g.id)}:${esc(c.id)}" aria-label="${esc(c.label)} quantity" type="number" inputmode="numeric" min="0" max="${limit}" data-limit="${limit}" value="0" step="1" required><button type="button" data-pos-option-delta="1" aria-label="Increase ${esc(c.label)} quantity" ${limit?'':'disabled'}>+</button></span></span></div>`}).join('')}<p class="help-text" data-option-count aria-live="polite">0 of ${g.required_count} selected</p></fieldset>`).join('')}<div class="pos-actions">${button('options-close','Cancel')}<button type="submit" class="button">Add to order</button></div></form></dialog>`;
 }
 function syncOptions(changed){
  let complete=true;
  for(const group of root.querySelectorAll('[data-option-group]')){
   const max=Number(optionProduct.option_groups[Number(group.dataset.optionGroup)].required_count),inputs=[...group.querySelectorAll('.option-count')];
   if(inputs.includes(changed)){const others=inputs.filter(i=>i!==changed).reduce((n,i)=>n+Number(i.value||0),0);changed.value=String(Math.max(0,Math.min(max-others,Number(changed.dataset.limit),Math.trunc(Number(changed.value)||0))))}
   const total=inputs.reduce((n,i)=>n+Number(i.value||0),0);
   for(const input of inputs){const stepper=input.closest('.option-stepper');stepper.querySelector('[data-pos-option-delta="-1"]').disabled=Number(input.value)<=0;stepper.querySelector('[data-pos-option-delta="1"]').disabled=total>=max||Number(input.value)>=Number(input.dataset.limit);input.max=String(Math.min(Number(input.dataset.limit),max-total+Number(input.value||0)))}
   group.querySelector('[data-option-count]').textContent=`${total} of ${max} selected`;if(total!==max)complete=false;
  }
  $('#pos-options-form button[type=submit]').disabled=!complete;
 }
 function render(){
  if(!root.isConnected)return;
  root.innerHTML=`${sectionNav()}${posAppMarkup()}<div class="notice danger pos-error" role="alert">${esc(error)}</div><p class="pos-status" role="status">${esc(feedback)}</p>${!connected?'<p class="notice">Connect the backend to record sales.</p>':screen==='drawer'?posCashView(events,cashSessions,cashEventId,cashMode,registerPending):screen==='methods'?posMethodsView(methodsDraft):screen==='setup'?setupView():screen==='orders'?recent():screen==='review'?renderReview():screen==='receipt'?renderReceipt():screen==='event'?renderEvent():screen==='options'?renderSale()+renderOptions():screen==='custom'?renderSale()+renderCustomItem():screen==='details'?`<section class="panel pos-review"><h2>Client details · ${esc(receipt.reference)}</h2><form id="pos-details-form">${customerFields(receipt)}${receipt.method==='delivery'?deliveryFields(receipt):''}<label class="field">Order notes · optional<textarea name="instructions" maxlength="2000">${esc(receipt.instructions||'')}</textarea></label><div class="pos-actions">${button('receipt-back','Back')}<button class="button" type="submit">Save details</button></div></form></section>`:screen==='void'?`<section class="panel pos-review"><h2>Void ${esc(receipt.reference)}</h2><p>This removes the sale from sales totals. Any refund must be handled separately. Record cash returned from an event drawer as Cash out in that cash session.</p><form id="pos-void-form">${field('reason','Reason','','text','required minlength="3" maxlength="500"')}${select('restore','Event stock',opt('','Choose whether stock can be restored','')+opt('yes','Return items to event stock','')+opt('no','Keep items deducted',''))}<div class="pos-actions">${button('receipt-back','Back')}<button class="button button-danger" type="submit">Void sale</button></div></form></section>`:renderSale()}`;
  refreshPOSConnection();
  root.dataset.screen=['options','custom'].includes(screen)?'sale':screen;syncMobile();dirty();
  if(screen==='review'||screen==='receipt') syncPayment();
  if(screen==='options'||screen==='custom'){
   if(screen==='options')syncOptions();
   const dialog=$(screen==='options'?'#pos-options-dialog':'#pos-custom-dialog'),closeAction=screen==='options'?'options-close':'custom-close';
   dialog.addEventListener('cancel',e=>{e.preventDefault();if(!busy)dialog.querySelector(`[data-pos="${closeAction}"]`).click()});dialog.showModal();
  }
  if(registerPending){root.insertAdjacentHTML('beforeend','<div class="notice"><p>The last save is unconfirmed. Retry to check and save it once.</p>'+button('register-retry','Retry this save')+'</div>');root.querySelectorAll('input,select,textarea,button').forEach(el=>{if(el.dataset.pos!=='register-retry')el.disabled=true})}
 }
 async function refresh(){const data=await api('pos_bootstrap');events=data.events||[];orders=data.orders||[];registerConfig=data.register_config||defaultPOSConfig();cashSessions=data.cash_sessions||[];if(!eventReady(event())&&!items.length)eventId=events.find(eventReady)?.id||'';}
 function addCartItem(item){
  const variant=selections=>JSON.stringify(Object.entries(selections||{}).sort(([a],[b])=>a.localeCompare(b)).map(([key,values])=>[key,Object.entries(values).filter(([,n])=>n>0).sort(([a],[b])=>a.localeCompare(b))]));
  const same=items.find(i=>item.product_id?i.product_id===item.product_id&&variant(i.selections)===variant(item.selections):item.custom_event_item_id?i.custom_event_item_id===item.custom_event_item_id&&variant(i.selections)===variant(item.selections):!i.product_id&&!i.custom_event_item_id&&i.name===item.name&&i.description===item.description&&i.unit_price_cents===item.unit_price_cents);
  if(same){const next=same.quantity+(item.product_id?1:item.quantity);if(next>10000)throw new Error('Use up to 10000 units per item.');same.quantity=next}else items.push(item);
 }
 function addCustomEventProduct(s,selections={}){
  const p={...s,custom_event_item_id:s.id},inBasket=items.filter(i=>i.custom_event_item_id===s.id).reduce((n,i)=>n+i.quantity,0);
  if(inBasket+1>s.remaining)throw new Error('Not enough event stock. Check the basket quantities.');
  for(const g of s.option_groups||[])for(const c of g.choices)if((selections[g.id]?.[c.id]||0)>choiceLeft(p,g,c))throw new Error(`Not enough stock for ${c.label}. Check the basket quantities.`);
  const surcharge=(s.option_groups||[]).reduce((sum,g)=>sum+g.choices.reduce((n,c)=>n+(selections[g.id]?.[c.id]||0)*c.surcharge_cents,0),0);
  const labels=(s.option_groups||[]).flatMap(g=>g.choices.filter(c=>selections[g.id]?.[c.id]>0).map(c=>`${selections[g.id][c.id]} × ${c.label}`));
  addCartItem({custom_event_item_id:s.id,name:s.name,description:[s.description,...labels].filter(Boolean).join(' · '),quantity:1,unit_price_cents:s.price_cents+surcharge,selections});
 }
 function addProduct(p,selections={}) {
  if(source==='popup'){
   const s=event().stock.find(s=>s.product_id===p.id),inBasket=items.filter(i=>i.product_id===p.id).reduce((n,i)=>n+i.quantity,0);
   if(inBasket+1>s.remaining)throw new Error('Not enough event stock. Check the basket quantities.');
   for(const g of p.option_groups||[])for(const c of g.choices)if((selections[g.id]?.[c.id]||0)>choiceLeft(p,g,c))throw new Error(`Not enough stock for ${c.label}. Check the basket quantities.`);
  }
  const surcharge=(p.option_groups||[]).reduce((sum,g)=>sum+g.choices.reduce((s,c)=>s+(selections[g.id]?.[c.id]||0)*c.surcharge_cents,0),0);
  addCartItem({product_id:p.id,name:p.name,quantity:source==='popup'?1:p.min_quantity||1,unit_price_cents:(source==='popup'?event().stock.find(s=>s.product_id===p.id).price_cents:p.price_cents)+surcharge,selections,
   description:(p.option_groups||[]).flatMap(g=>g.choices.filter(c=>selections[g.id]?.[c.id]>0).map(c=>`${g.label}: ${selections[g.id][c.id]} × ${c.label}`)).join(' · ')});
 }
 function syncPayment(){
  const form=$('#pos-confirm-form')||$('#pos-payment-form')||$('#pos-delivery-payment-form');if(!form||(editing&&form.id==='pos-confirm-form'))return;
  const paid=!form.elements.namedItem('payment_state')||value(form,'payment_state')==='paid',cash=value(form,'payment_method')==='cash';
  const panel=form.querySelector('.pos-payment');if(panel)panel.hidden=!paid;
  form.querySelectorAll('[data-pos-payment]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.posPayment===value(form,'payment_method'))));
  const shortcuts=form.querySelector('.pos-cash-shortcuts');if(shortcuts)shortcuts.hidden=!cash;
  const needsDrawer=form.id==='pos-confirm-form'&&source==='popup'&&paid&&cash&&!openDrawer(eventId);
  form.querySelector('.pos-drawer-warning').hidden=!needsDrawer;form.querySelector('button[type=submit]').disabled=needsDrawer;
  const input=form.elements.namedItem('cash_received');input.disabled=!paid||!cash;input.closest('label').hidden=!cash;
  const total=screen==='receipt'?(form.id==='pos-delivery-payment-form'?receipt.delivery_cents:productsDue(receipt)):quote.total_cents;
  let change=0;try{change=pesoCents(input.value)-total}catch{change=-total}
  form.querySelector('[data-change]').hidden=!cash;
  form.querySelector('[data-change]').textContent=change>=0?`Change: ${money(change)}`:`Still needed: ${money(-change)}`;
 }
 function readPayment(form,total){if(form.id==='pos-confirm-form'&&source==='popup'&&value(form,'payment_method')==='cash'&&!openDrawer(eventId))throw new Error('Open a cash session for this event first.');return {...(form.id==='pos-confirm-form'&&source==='popup'?{cash_session_id:openDrawer(eventId)?.id||null}:{}),method:value(form,'payment_method'),amount_cents:total,received_cents:value(form,'payment_method')==='cash'?pesoCents(value(form,'cash_received')):total,reference:value(form,'payment_reference')}}
 function syncCashCount(){
  const f=$('#pos-cash-close-form'),session=openDrawer(cashEventId);if(!f||!session)return;
  const note=f.elements.namedItem('note');let difference=null;try{difference=pesoCents(value(f,'counted'))-session.expected_cents}catch{}
  f.querySelector('[data-cash-difference]').textContent=difference===null?'Enter the counted cash to check the difference.':difference===0?'Cash matches the expected amount.':`${difference<0?'Short':'Over'} by ${money(Math.abs(difference))}`;
  note.required=difference!==null&&difference!==0;note.minLength=note.required?3:0;
 }
 function captureMethods(){const f=$('#pos-methods-form');if(!f)return;for(const m of methodsDraft.methods){m.label=value(f,'method_'+m.id);m.active=m.id==='cash'||checked(f,'active_'+m.id)}}
 async function saveRegister(action,payload){
  if(!registerPending)registerPending={action,payload:{...payload,idempotency_key:crypto.randomUUID()}};
  let result;
  try{result=await api(registerPending.action,registerPending.payload)}catch(e){
   try{result=await api('pos_register_find',{idempotency_key:registerPending.payload.idempotency_key});if(!result)registerPending=null}catch{}
   if(!result)throw e;
  }
  const savedAction=registerPending?.action||action;registerPending=null;registerDirty=false;cashMode='';
  if(savedAction==='pos_payment_methods_save')registerConfig=result;
  else cashSessions=[result,...cashSessions.filter(s=>s.id!==result.id)];
  if(screen==='methods')methodsDraft=structuredClone(registerConfig);
  feedback=savedAction==='pos_cash_close'?'Cash session closed.':savedAction==='pos_cash_open'?'Shared cash session opened.':savedAction==='pos_payment_methods_save'?'POS payment methods saved.':'Cash movement recorded.';
  await refresh().catch(()=>{feedback+=' Refresh again to get the latest activity.'});
 }
 async function saved(o){receipt=o;editing=null;items=[];draft={};pending=null;submissionKey=crypto.randomUUID();paymentKey=crypto.randomUUID();screen='receipt';onOrderSaved?.(o);await refresh().catch(()=>{});render();}
 async function run(task){
  if(busy)return;
  const previousScreen=screen,previousSection=section,previousPane=mobilePane,fields=[...root.querySelectorAll('form input,form select,form textarea')].map(el=>({formId:el.form?.id,name:el.name,value:el.value,checked:el.checked}));
  busy=true;dirty();root.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{error='';feedback='';await task()}catch(e){error=e.message||'Unable to save. Please retry.'}
  finally{
   busy=false;render();
   if(screen===previousScreen&&error){for(const f of fields){const el=[...root.querySelectorAll('[name]')].find(e=>e.form?.id===f.formId&&e.name===f.name);if(el){el.value=f.value;if(el.type==='checkbox')el.checked=f.checked}}capture();captureMethods();syncPayment();syncCashCount();if(screen==='options')syncOptions()}
   if((previousScreen!==screen||previousSection!==section||previousPane!==mobilePane)&&!['options','custom'].includes(previousScreen)&&!['options','custom'].includes(screen))scrollToPOS();
   if(previousScreen==='options'&&screen==='sale')$(`[data-pos="${optionReturnCustom?'add-event-custom':'add'}"][data-id="${optionReturnId}"]`)?.focus({preventScroll:true});
   if(previousScreen==='custom'&&screen==='sale'){
    const opener=$('[data-pos=custom]');(opener?.getClientRects().length?opener:$('[data-pos=mobile-products]'))?.focus({preventScroll:true});
   }
   if(error)$(screen==='options'?'#pos-options-dialog [role="alert"]':screen==='custom'?'#pos-custom-dialog [role="alert"]':'[role="alert"]')?.scrollIntoView({block:'nearest'});
  }
 }
 root.addEventListener('click',e=>{
  const tender=e.target.closest('[data-pos-payment]');if(tender){e.preventDefault();if(busy||pending||registerPending)return;const f=tender.closest('form');f.elements.namedItem('payment_method').value=tender.dataset.posPayment;syncPayment();return}
  const cash=e.target.closest('[data-pos-cash]');if(cash){e.preventDefault();if(busy||pending||cash.disabled||registerPending)return;cash.closest('form').elements.namedItem('cash_received').value=amount(cash.dataset.posCash);syncPayment();return}
  const step=e.target.closest('[data-pos-option-delta]');if(step){e.preventDefault();if(busy||step.disabled)return;const input=step.closest('.option-stepper').querySelector('input');input.value=String(Number(input.value||0)+Number(step.dataset.posOptionDelta));syncOptions(input);return}
  if(['pos-options-dialog','pos-custom-dialog'].includes(e.target.id)){const box=e.target.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)e.target.querySelector(`[data-pos="${e.target.id==='pos-custom-dialog'?'custom-close':'options-close'}"]`).click();return}
  const b=e.target.closest('[data-pos]');if(!b||busy||b.disabled)return;e.preventDefault();e.stopPropagation();capture();captureEvent();captureMethods();
  const action=b.dataset.pos;
  run(async()=>{
   if(registerPending&&action!=='register-retry'){error='Retry the unconfirmed save first.';return}
   if(pending&&!['copy','print'].includes(action)){error='Please retry saving this order before leaving this screen.';return}
   if(action==='register-retry'){await saveRegister();return}
   if(action==='register-refresh'){if(!await leaveEditor())return;await refresh();cashMode='';registerDirty=false;if(screen==='methods')methodsDraft=structuredClone(registerConfig)}
   else if(action==='cash-drawer'){cashEventId=eventId;section='drawer';screen='drawer';cashMode='';registerDirty=false;await refresh()}
   else if(action==='cash-mode'){if(registerDirty&&!await leaveEditor())return;cashMode=b.dataset.mode;registerDirty=false}
   else if(action==='cash-back'){if(!await leaveEditor())return;registerDirty=false;section='sell';screen='sale';mobilePane='basket'}
   else if(action==='method-add'){if(methodsDraft.methods.length>=50)throw new Error('Use up to 50 POS payment methods.');const id='pos-'+crypto.randomUUID();methodsDraft.methods.push({id,label:'',active:true});registerDirty=true;setTimeout(()=>$(`[name="method_${id}"]`)?.focus(),0)}
   else if(action==='section'){
    if(['setup','methods'].includes(b.dataset.section)&&role!=='owner')return;
    if(!await leaveEditor())return;
    section=b.dataset.section;screen=section==='sell'?'sale':section;cashMode='';registerDirty=false;
    if(section==='methods')methodsDraft=structuredClone(registerConfig);
    if(section==='drawer'){await refresh();cashEventId=eventId||cashEventId||events[0]?.id||''}
   }else if(action==='mobile-basket')mobilePane='basket';
   else if(action==='mobile-products')mobilePane='products';
   else if(action==='event-sell'){
    const target=events.find(e=>e.id===b.dataset.id);if(!eventReady(target))throw new Error('This event is not open today.');
    if(items.length&&(source!=='popup'||eventId!==target.id)&&!await confirmDialog('Your unsaved items will be cleared.',{title:'Switch counter?',confirmLabel:'Switch counter',cancelLabel:'Keep sale'}))return;
    if(source!=='popup'||eventId!==target.id){items=[];draft={};submissionKey=crypto.randomUUID()}
    editing=null;source='popup';eventId=target.id;section='sell';screen='sale';mobilePane='products';search='';
   }else if(action==='source'||action==='new-sale'){
    if(items.length&&!await confirmDialog('Your unsaved items will be cleared.',{title:'Start a new order?',confirmLabel:'Start new order'}))return;
    editing=null;source=b.dataset.source||source;items=[];draft={};section='sell';screen='sale';mobilePane='products';search='';submissionKey=crypto.randomUUID();
   }else if(action==='add'){const p=saleProduct(product(b.dataset.id));if(p.option_groups?.length){optionProduct=p;optionReturnId=p.id;optionReturnCustom=false;screen='options'}else addProduct(p)}
   else if(action==='quantity'){const item=items[Number(b.dataset.index)],next=item.quantity+Number(b.dataset.delta);if(next>=1&&(next<=cartLimit(item)||next<item.quantity))item.quantity=next}
   else if(action==='remove')items.splice(Number(b.dataset.index),1);
   else if(action==='options-close'){optionProduct=null;screen='sale'}
   else if(action==='custom')screen='custom';
   else if(action==='custom-close')screen='sale';
   else if(action==='edit-order'){if(items.length&&!await confirmDialog('Your unsaved items will be cleared.',{title:'Edit this order?',confirmLabel:'Edit order'}))return;startEdit(await api('pos_order_link',{order_id:receipt.id}))}
   else if(action==='edit-cancel'){if(!await confirmDialog('The saved order will stay unchanged.',{title:'Discard these edits?',confirmLabel:'Discard edits',cancelLabel:'Keep editing'}))return;receipt=await api('pos_order_link',{order_id:editing.id});editing=null;items=[];draft={};quote=null;screen='receipt';section='orders';submissionKey=crypto.randomUUID()}
   else if(action==='event-new'||action==='event-edit'){if(items.length&&!await confirmDialog('The items in your unsaved sale will be cleared before setting up the event.',{title:'Open event setup?',confirmLabel:'Open event setup',cancelLabel:'Keep sale'}))return;items=[];draft={};startEvent(action==='event-edit'?events.find(e=>e.id===b.dataset.id):null)}
   else if(action==='event-picker')eventPicker=!eventPicker;
   else if(action==='event-add'){const p=product(b.dataset.id);if(eventDraft.entries.some(s=>s.product_id===p.id))return;const previous=events.find(e=>e.id===eventDraft.id)?.stock.find(s=>s.product_id===p.id);eventDraft.entries.push({id:p.id,product_id:p.id,name:p.name,capacity:previous?.capacity||0,used:previous?.used||0,price:amount(previous?.price_cents??p.price_cents),flavor_groups:p.option_groups?.length||previous?.options_tracked?flavorDraft(p,previous):null})}
   else if(action==='event-custom-flavors'){const s=eventDraft.entries.find(s=>s.id===b.dataset.id);s.unassigned_used=s.used||0;s.flavor_groups=[{id:'flavor',label:'Flavor',required_count:1,choices:[{id:'event-'+crypto.randomUUID(),label:'',custom:true,active:true,capacity:0,used:0,surcharge_cents:0,price:'0.00'}]}];s.capacity=flavorCapacity(s)}
   else if(action==='event-flavors'){const s=eventDraft.entries.find(s=>s.id===b.dataset.id);s.flavor_groups=flavorDraft(product(s.product_id),s)}
   else if(action==='event-flavor-add'){const s=eventDraft.entries.find(s=>s.id===b.dataset.id),g=s.flavor_groups[Number(b.dataset.group)];if(g.choices.length>=100)throw new Error('Use up to 100 flavors per group.');const id='event-'+crypto.randomUUID();g.choices.push({id,label:'',custom:true,active:true,capacity:0,used:0,surcharge_cents:0,price:'0.00'});setTimeout(()=>$(`[data-flavor-id="${id}"] input[type="text"]`)?.focus(),0)}
   else if(action==='event-flavor-remove'){
    const s=eventDraft.entries.find(s=>s.id===b.dataset.id),g=s.flavor_groups[Number(b.dataset.group)],c=g.choices.find(c=>c.id===b.dataset.choice);
    if(!c?.custom)return;
    if(c.used)c.active=false;else g.choices=g.choices.filter(v=>v.id!==c.id);
    if(automaticStock(s))s.capacity=flavorCapacity(s);
   }
   else if(action==='event-custom'){const id=crypto.randomUUID();eventDraft.entries.push({id,custom:true,name:'',description:'',capacity:0,used:0,price:'0.00'});setTimeout(()=>$(`[name="custom_name_${id}"]`)?.focus(),0)}
   else if(action==='event-remove')eventDraft.entries=eventDraft.entries.filter(s=>s.id!==b.dataset.id);
   else if(action==='add-event-custom'){const s=event().custom_stock.find(s=>s.id===b.dataset.id);if(s.options_tracked){optionProduct={...s,custom_event_item_id:s.id};optionReturnId=s.id;optionReturnCustom=true;screen='options'}else addCustomEventProduct(s)}
   else if(action==='back'){if(screen==='event'&&!await confirmDialog('Your unsaved event changes will be lost.',{title:'Leave event setup?',confirmLabel:'Discard changes',cancelLabel:'Keep editing'}))return;screen=screen==='event'?'setup':'sale';quote=null}
   else if(action==='receipt'){if(items.length&&!await confirmDialog('Your unsaved items will be cleared.',{title:'Leave this draft?',confirmLabel:'Open order'}))return;editing=null;items=[];draft={};receipt=await api('pos_order_link',{order_id:b.dataset.id});screen='receipt';paymentKey=crypto.randomUUID()}
   else if(action==='receipt-back')screen='receipt';
   else if(action==='details')screen='details';
   else if(action==='void')screen='void';
   else if(action==='copy'){await navigator.clipboard.writeText(posOrderUrl(receipt,settings.site_url||document.baseURI));return setTimeout(()=>{if($('.pos-feedback'))$('.pos-feedback').textContent='Link copied.'},0)}
   else if(action==='print')await printOrderSlips([receipt],{products,settings});
   else if(action==='manage-order')openOrder(receipt.id);
   else if(action==='refresh'){await refresh();feedback='Orders refreshed.'}
  });
 });
 root.addEventListener('input',e=>{
  if(busy||registerPending)return;
  if(e.target.closest('#pos-methods-form')){captureMethods();registerDirty=true;dirty();return}
  if(e.target.closest('.pos-cash-form')){registerDirty=true;syncCashCount();dirty();return}
  if(e.target.closest('#pos-event-form')){captureEvent();if(e.target.name==='event_search'){eventSearch=e.target.value;const start=e.target.selectionStart;render();const f=$('[name="event_search"]');f.focus();f.setSelectionRange(start,start)}return}
  if(e.target.closest('#pos-options-form')){syncOptions(e.target);return}
  if(e.target.name==='search') {capture();search=e.target.value;const start=e.target.selectionStart;render();const f=$('[name="search"]');f.focus();f.setSelectionRange(start,start);return}
  if(e.target.name?.startsWith('qty_'))items[Number(e.target.name.slice(4))].quantity=Number(e.target.value);
  if(e.target.name?.startsWith('price_')){try{items[Number(e.target.name.slice(6))].unit_price_cents=pesoCents(e.target.value)}catch{}}
  if(e.target.closest('#pos-sale-form')){syncCart();capture();const total=$('[data-estimate]');if(total)total.textContent=money(estimate());syncMobile();dirty()}
  syncPayment();
 });
 root.addEventListener('change',e=>{
  if(busy)return;
  if(e.target.name==='cash_event_id'){const next=e.target.value;run(async()=>{if(!await leaveEditor())return;cashEventId=next;cashMode='';registerDirty=false});return}
  if(['method','discount_kind','delivery_fee_pending'].includes(e.target.name)){capture();render()}
  if(e.target.name==='event_id')run(async()=>{const id=e.target.value;if(items.length&&!await confirmDialog('Items in this unsaved sale will be cleared.',{title:'Switch event?',confirmLabel:'Switch event'}))return;eventId=id;items=[];capture()});
  syncPayment();
 });
 root.addEventListener('invalid',e=>{if(e.target.closest('.pos-basket-panel')){mobilePane='basket';syncMobile();const dock=$('.pos-mobile-dock');if(dock)dock.outerHTML=mobileDock()}},true);
 root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.name==='search')e.preventDefault()});
 root.addEventListener('submit',e=>{
  e.preventDefault();e.stopPropagation();const form=e.target;
  run(async()=>{
   if(registerPending){await saveRegister();return}
   if(form.id==='pos-methods-form'){captureMethods();await saveRegister('pos_payment_methods_save',methodsDraft)}
   else if(form.id==='pos-cash-open-form')await saveRegister('pos_cash_open',{event_id:cashEventId,opening_cents:pesoCents(value(form,'opening')),note:value(form,'note')});
   else if(['pos-cash-move-form','pos-cash-close-form'].includes(form.id)){
    const session=openDrawer(cashEventId);if(!session)throw new Error('Refresh to find the open cash session.');
    await saveRegister(form.id==='pos-cash-close-form'?'pos_cash_close':'pos_cash_move',{session_id:session.id,revision:session.revision,note:value(form,'note'),...(form.id==='pos-cash-close-form'?{counted_cents:pesoCents(value(form,'counted'))}:{kind:value(form,'kind'),amount_cents:pesoCents(value(form,'amount'))})});
   }
   else if(form.id==='pos-sale-form'){capture();const p=basePayload();if(p.email_notifications&&!p.buyer.email)throw new Error('Enter a client email or turn off email confirmations.');quote=await api(editing?'pos_preview_edit':'pos_quote',editing?{...p,order_id:editing.id,revision:editing.revision}:p);screen='review'}
   else if(form.id==='pos-confirm-form'){
    if(!pending)pending={...basePayload(),expected_quote:quote,idempotency_key:submissionKey,...(editing?{order_id:editing.id,revision:editing.revision,reason:value(form,'amendment_reason')||'N/A'}:value(form,'payment_state')==='paid'?{payment:readPayment(form,quote.total_cents)}:{})};
    const updating=Boolean(editing),editedId=editing?.id;
    try{await saved(await api(updating?'pos_update_order':'pos_create_order',pending))}catch(e){
     // Resolve a potentially lost success response before allowing any edits.
     try{const found=await api(updating?'pos_find_edit':'pos_find_submission',{idempotency_key:submissionKey,...(updating?{order_id:editedId}:{})});if(found){await saved(found);return}pending=null}catch{}
     throw e;
    }
   }else if(form.id==='pos-custom-form'){addCartItem({name:value(form,'name'),description:value(form,'description'),quantity:Number(value(form,'quantity')),unit_price_cents:pesoCents(value(form,'price')),selections:{}});screen='sale';mobilePane='basket'}
   else if(form.id==='pos-options-form'){const selections={};for(const g of optionProduct.option_groups){selections[g.id]={};let sum=0;for(const c of g.choices){const n=Number(value(form,`${g.id}:${c.id}`)||0);if(n)selections[g.id][c.id]=n;sum+=n}if(sum!==g.required_count)throw new Error(`Choose exactly ${g.required_count} for ${g.label}.`)}if(optionProduct.custom_event_item_id)addCustomEventProduct(optionProduct,selections);else addProduct(optionProduct,selections);screen='sale'}
   else if(form.id==='pos-event-form'){
    captureEvent();const {entries,...details}=eventDraft;
    const row=s=>({capacity:Number(s.capacity),price_cents:pesoCents(s.price),active:true});
    const flavorOptions=s=>s.flavor_groups?{options_tracked:true,option_groups:s.flavor_groups.map(g=>({...g,choices:g.choices.filter(c=>!blankFlavor(s,g,c)).map(c=>({...c,capacity:Number(c.capacity),surcharge_cents:c.custom?pesoCents(c.price):c.surcharge_cents}))}))}:{};
    const p={...details,stock:entries.filter(s=>!s.custom).map(s=>({...row(s),product_id:s.product_id,...flavorOptions(s)})),custom_stock:entries.filter(s=>s.custom).map(s=>({...row(s),id:s.id,name:s.name,description:s.description,...flavorOptions(s)}))};
    const result=await api('pos_save_event',p);eventId=result.id;items=[];eventDraft={...eventDraft,id:result.id,revision:result.revision};await refresh();section='setup';screen='setup';feedback='Event saved. Open its counter when you are ready to sell.';
   }else if(form.id==='pos-payment-form')await saved(await api('pos_payment',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,payment:readPayment(form,productsDue(receipt))}));
   else if(form.id==='pos-delivery-fee-form')await saved(await api('pos_delivery_fee',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,amount_cents:pesoCents(value(form,'delivery_fee')),note:value(form,'delivery_note')}));
   else if(form.id==='pos-delivery-payment-form')await saved(await api('pos_delivery_payment',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,payment:readPayment(form,receipt.delivery_cents)}));
   else if(form.id==='pos-delivery-reject-form')await saved(await api('pos_delivery_reject',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,reason:value(form,'reason')}));
   else if(form.id==='pos-details-form')await saved(await api('pos_update_details',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,buyer:{name:value(form,'name'),phone:value(form,'phone'),email:value(form,'email'),social_platform:value(form,'social_platform'),social_username:value(form,'social_username')},recipient:{name:value(form,'recipient_name'),phone:value(form,'recipient_phone')},address:{line1:value(form,'address')},instructions:value(form,'instructions'),email_notifications:checked(form,'email_notifications')}));
   else if(form.id==='pos-void-form'){if(!value(form,'restore'))throw new Error('Choose whether to return the items to stock.');await saved(await api('pos_void_sale',{order_id:receipt.id,revision:receipt.revision,idempotency_key:paymentKey,reason:value(form,'reason'),restore_stock:value(form,'restore')==='yes'}))}
  });
 });
 bindAccountingDates(root);
 if(!connected){render();return}
 root.textContent='Opening point of sale…';
 try{await refresh();if(orderId){receipt=await api('pos_order_link',{order_id:orderId});section='orders';screen='receipt'}}catch(e){error=e.message}
 render();
}
