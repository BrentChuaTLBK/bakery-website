import { legacyPaymentOptions } from './payment-options.js?v=payment-options-1';
import { confirmDialog } from './site-dialog.js?v=branded-dialogs-1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(name,label,value,max)=>`<label class="field">${label}<input data-payment-field="${name}" value="${esc(value)}" maxlength="${max}" ${name==='note'?'':'required'} ${name==='account_number'?'spellcheck="false" autocomplete="off"':''}></label>`;
function itemMarkup(p,i,count,readonly){return `<details class="payment-admin-item" data-payment-method="${esc(p.id)}"><summary class="section-heading"><strong data-payment-heading>${esc(p.label||`Option ${i+1}`)}</strong><div class="row-actions"><button type="button" class="button button-secondary" data-payment-move="${i},-1" aria-label="Move payment option ${i+1} earlier" ${i===0||readonly?'disabled':''}>↑</button><button type="button" class="button button-secondary" data-payment-move="${i},1" aria-label="Move payment option ${i+1} later" ${i===count-1||readonly?'disabled':''}>↓</button><button type="button" class="button button-quiet" data-payment-remove="${i}" ${readonly?'disabled':''}>Remove</button></div></summary><div class="payment-admin-fields">${field('label','Payment method · e.g. GCash or bank name',p.label,60)}${field('account_name','Account name',p.account_name,150)}${field('account_number','Account / mobile number',p.account_number,100)}${field('note','Instructions for this method · optional',p.note,300)}<label class="check-field"><input type="checkbox" data-payment-field="enabled" ${p.enabled?'checked':''}><span>Show this payment option</span></label></div></details>`;}
export function paymentSettingsMarkup(settings,readonly=false){
  const existing=Array.isArray(settings.payment_options)?settings.payment_options:legacyPaymentOptions(settings.payment_instructions).map(p=>({...p,id:crypto.randomUUID()}));
  return `<section class="panel" id="payment-options-editor" data-revision="${Number(settings.payment_options_revision)||0}"><h2>Payment options</h2><p class="muted">Customers choose a method and copy its account name, number and amount. Changes apply to new orders; existing orders keep their original details.</p><fieldset ${readonly?'disabled':''} style="padding:0;margin:0;border:0;min-width:0"><div data-payment-list>${existing.map((p,i)=>itemMarkup(p,i,existing.length,readonly)).join('')}</div><button class="button button-secondary" type="button" data-payment-add ${readonly?'disabled':''}>+ Add payment option</button><label class="field payment-settings-note">Payment instructions · optional<textarea name="payment_note" maxlength="1000" rows="3">${esc(settings.payment_note||(!existing.length?settings.payment_instructions:'')||'')}</textarea><small>Shown with the options and included in payment emails.</small></label></fieldset><p class="help-text">Keep at least one option visible while orders are open. Save shop settings below to publish your changes. Payment proof is still required and reviewed by your team.</p><p data-payment-admin-status role="status"></p></section>`;
}
export function readPaymentSettings(form){
  const root=form.querySelector('#payment-options-editor');
  return {payment_options:[...root.querySelectorAll('[data-payment-method]')].map(el=>({id:el.dataset.paymentMethod,...Object.fromEntries([...el.querySelectorAll('[data-payment-field]')].map(input=>[input.dataset.paymentField,input.type==='checkbox'?input.checked:input.value.trim()]))})),payment_note:root.querySelector('[name=payment_note]').value.trim(),payment_options_revision:Number(root.dataset.revision)||0};
}
export function bindPaymentSettings(form,{readonly=false}={}){
  const root=form?.querySelector('#payment-options-editor');if(!root||readonly)return;
  const list=root.querySelector('[data-payment-list]'),status=root.querySelector('[data-payment-admin-status]');
  const changed=()=>{root.dataset.dirty='true';status.textContent='Unsaved payment options. Save shop settings to publish.';};
  root.addEventListener('input',event=>{changed();if(event.target.dataset.paymentField==='label')event.target.closest('[data-payment-method]').querySelector('[data-payment-heading]').textContent=event.target.value||'New option';});root.addEventListener('change',changed);
  root.addEventListener('invalid',event=>{const item=event.target.closest('details');if(item)item.open=true;},true);
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||button.disabled||root.dataset.busy==='true')return;event.preventDefault();
    const data=readPaymentSettings(form),items=data.payment_options;
    let focusIndex=0;
    if(button.hasAttribute('data-payment-add')){
      if(items.length>=20){status.textContent='You can add up to 20 payment options.';return;}
      items.push({id:crypto.randomUUID(),label:'',account_name:'',account_number:'',note:'',enabled:true});focusIndex=items.length-1;
    }else if(button.hasAttribute('data-payment-move')){
      const [i,step]=button.dataset.paymentMove.split(',').map(Number);if(i+step<0||i+step>=items.length)return;
      const [p]=items.splice(i,1);items.splice(i+step,0,p);focusIndex=i+step;
    }else if(button.hasAttribute('data-payment-remove')){
      const i=Number(button.dataset.paymentRemove),p=items[i];
      if(!await confirmDialog(`Remove ${p.label||'this payment option'} for new orders? Existing orders will keep their saved payment details.`,{title:'Remove payment option?',confirmLabel:'Remove option',cancelLabel:'Keep option',danger:true})||!root.isConnected)return;
      // Capture again after the confirmation, preserving edits made while it opened.
      const current=readPaymentSettings(form).payment_options.filter(item=>item.id!==p.id);items.splice(0,items.length,...current);focusIndex=Math.max(0,i-1);
    }else return;
    list.innerHTML=items.map((p,i)=>itemMarkup(p,i,items.length,false)).join('');changed();
    [...list.children].forEach((el,i)=>el.open=i===focusIndex);
    const focus=list.children[focusIndex]?.querySelector('input')||root.querySelector('[data-payment-add]');focus?.focus({preventScroll:true});focus?.scrollIntoView({block:'nearest'});
  });
}
