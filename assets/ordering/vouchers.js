import {api,money,escapeHtml as esc} from './client.js';
const date=value=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const shortDate=value=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric'}).format(new Date(value));
export const voucherValue=v=>v.kind==='fixed'?`${money(v.value)} off`:`${v.value}% off`;
export const voucherTerms=v=>`Minimum product spend ${money(v.min_subtotal_cents)}${v.kind==='percent'&&v.cap_cents!=null?` · Up to ${money(v.cap_cents)} off`:''}`;

export function mountVouchers(root){
 if(!root)return {refresh(){},destroy(){}};
 const pageSize=4;
 let alive=true,tab='available',offset=0,request=0,visible=[],dialog=null;
 function closeDetails(){dialog?.close();dialog?.remove();dialog=null;}
 function showDetails(v){
  closeDetails();if(!v)return;
  const el=document.createElement('dialog');dialog=el;el.className='voucher-details-dialog';el.setAttribute('aria-labelledby','voucher-details-title');
  el.innerHTML=`<div class="voucher-details-heading"><h2 id="voucher-details-title">Voucher details</h2><button class="button button-secondary" type="button" data-voucher-close autofocus>Close</button></div>${card(v)}<p data-voucher-message role="status"></p>`;
  el.addEventListener('click',handleClick);el.addEventListener('close',()=>{el.remove();if(dialog===el)dialog=null;});document.body.append(el);el.showModal();
 }
 function compactCard(v,index){return `<article class="voucher-compact"><div class="voucher-compact-main"><p class="voucher-compact-name">${esc(v.title)}</p><h3>${esc(voucherValue(v))}</h3><p class="voucher-compact-terms">${v.min_subtotal_cents?`Min. ${esc(money(v.min_subtotal_cents))}`:'No minimum spend'}${v.kind==='percent'&&v.cap_cents!=null?` · Max. ${esc(money(v.cap_cents))} off`:''}</p><p class="voucher-compact-expiry">${v.status==='used'?'Used':v.status==='inactive'?'Unavailable':v.status==='expired'?'Expired':v.status==='reserved'?'Reserved · Expires':'Expires'} ${['used','inactive'].includes(v.status)?'':esc(shortDate(v.expires_at))}</p></div><div class="voucher-compact-actions">${v.status==='available'?`<a class="button" aria-label="Use ${esc(v.title)} at checkout" href="shop.html#voucher=${encodeURIComponent(v.code)}">Use</a>`:''}<button class="button button-secondary" type="button" data-voucher-details="${index}" aria-label="Details for ${esc(v.title)}" aria-haspopup="dialog">Details</button></div></article>`;}
 function header(counts={}){return `<div class="account-orders-heading"><div><h2>My vouchers</h2><p>A little something for your next order.</p></div><button type="button" class="button button-secondary" data-voucher-refresh>Refresh</button></div><div class="voucher-tabs" aria-label="Voucher status">${[['available','Available'],['used','Used'],['expired','Expired / unavailable']].map(([key,label])=>`<button type="button" data-voucher-tab="${key}" aria-pressed="${tab===key}">${label}${counts[key]!==undefined?` <span>${counts[key]}</span>`:''}</button>`).join('')}</div>`;}
 function card(v){return `<article class="voucher-card"><div class="voucher-card-top"><span class="eyebrow">${v.source==='newsletter'?'Newsletter treat':'A thank-you from TLB'}</span><span class="badge">${esc(v.status==='reserved'?'Reserved for an order':v.status)}</span></div><h3>${esc(voucherValue(v))} your next order</h3><p>${esc(v.title)}</p><p class="voucher-terms">${esc(voucherTerms(v))}<br>Valid until ${esc(date(v.expires_at))} · Manila time</p><p class="voucher-code">${esc(v.code)}</p>${v.status==='reserved'?'<p class="voucher-note">This voucher is attached to an unpaid order. Open Your orders to finish payment.</p>':v.status==='inactive'?'<p class="voucher-note">This offer is no longer available. Contact TLB if you need help.</p>':''}<div class="voucher-actions">${v.status==='available'?`<a class="button" href="shop.html#voucher=${encodeURIComponent(v.code)}">Use at checkout</a>`:''}<button class="button button-secondary" type="button" data-voucher-copy="${esc(v.code)}">Copy code</button></div></article>`;}
 async function refresh(focus){
  closeDetails();visible=[];
  const version=++request;root.innerHTML=header()+'<p role="status">Loading your vouchers…</p>';
  try{
   const data=await api('my_vouchers',{status:tab,offset});if(!alive||version!==request)return;
   if(offset&&offset>=data.total){offset=Math.max(0,Math.floor((data.total-1)/pageSize)*pageSize);return refresh(focus);}
   visible=data.vouchers.slice(0,pageSize);
   const multiple=data.total>1;
   root.innerHTML=header(data.counts)+`<div class="${multiple?'voucher-compact-list':'voucher-grid'}">${visible.map(multiple?compactCard:card).join('')||'<p class="voucher-empty">No vouchers here yet. Eligible offers will appear automatically.</p>'}</div>${data.total>pageSize?`<nav class="voucher-pagination voucher-compact-pagination" aria-label="Voucher pages"><button class="button button-secondary" data-voucher-page="previous" ${offset?'':'disabled'}>Previous</button><span tabindex="-1" data-voucher-range aria-live="polite">${offset+1}–${offset+visible.length} of ${data.total}</span><button class="button button-secondary" data-voucher-page="next" ${offset+pageSize<data.total?'':'disabled'}>Next</button></nav>`:''}<p class="voucher-note">Website orders only. One code per order; delivery is excluded. Your newsletter code keeps its original expiry.</p><p data-voucher-message role="status"></p>`;
   if(focus)(root.querySelector(focus)||root.querySelector('[data-voucher-refresh]'))?.focus();
  }catch(error){if(alive&&version===request)root.innerHTML=header()+`<p class="notice" role="alert">${esc(error.message||'Your vouchers could not load. Try again.')}</p>`;}
 }
 async function handleClick(e){
  const button=e.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-voucher-refresh'))return refresh('[data-voucher-refresh]');
  if(button.dataset.voucherTab){tab=button.dataset.voucherTab;offset=0;return refresh(`[data-voucher-tab="${tab}"]`);}
  if(button.dataset.voucherPage){offset=Math.max(0,offset+(button.dataset.voucherPage==='next'?pageSize:-pageSize));return refresh('[data-voucher-range]');}
  if(button.hasAttribute('data-voucher-details'))return showDetails(visible[Number(button.dataset.voucherDetails)]);
  if(button.hasAttribute('data-voucher-close'))return closeDetails();
  if(button.dataset.voucherCopy){const message=(button.closest('dialog')||root).querySelector('[data-voucher-message]');try{await navigator.clipboard.writeText(button.dataset.voucherCopy);if(message)message.textContent='Code copied.';}catch{if(message)message.textContent='Copy is unavailable. Select the code above to copy it.';}}
 }
 root.addEventListener('click',handleClick);
 void refresh();return {refresh,destroy(){alive=false;request++;closeDetails();root.removeEventListener('click',handleClick);root.replaceChildren();}};
}
