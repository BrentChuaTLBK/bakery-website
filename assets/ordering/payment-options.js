const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const selectedMethods = new Map();

export function legacyPaymentOptions(instructions) {
  if(typeof instructions!=='string'||!/^Accepted Payment Methods:/i.test(instructions))return [];
  const blocks=instructions.replace(/\r/g,'').replace(/^Accepted Payment Methods:\s*/i,'').trim().split(/\n[ \t]*\n+/);
  if(!blocks.length||blocks.length>20)return [];
  const result=[];
  for(const [i,block] of blocks.entries()){
    const lines=block.trim().split('\n').map(s=>s.trim());
    if(lines.length!==3||!lines[0]||!lines[1]||!/^\d[\d -]{3,99}$/.test(lines[2]))return [];
    result.push({id:`legacy-${i}`,label:lines[0],account_name:lines[1],account_number:lines[2],note:'',enabled:true});
  }
  return result;
}
export function orderPaymentDetails(order,settings={}) {
  // An order's instructions and accounts are a single snapshot. Never substitute
  // today's bank account into an order with older saved payment instructions.
  const hasSnapshot=order.payment_options!=null||order.payment_instructions!=null;
  const source=hasSnapshot?order:settings;
  const options=Array.isArray(source.payment_options)?source.payment_options.filter(p=>p?.enabled===true&&typeof p.account_name==='string'&&typeof p.account_number==='string'):legacyPaymentOptions(source.payment_instructions);
  return {options,note:source.payment_note||'',fallback:source.payment_instructions||'Please contact the kitchen for payment details.'};
}
function copyField(label,value,key) {
  return `<div class="payment-copy-row"><label for="payment-${key}">${label}</label><div><input id="payment-${key}" value="${esc(value)}" readonly aria-label="${label}" spellcheck="false"><button type="button" class="button-secondary" data-payment-copy="${key}" aria-label="Copy ${label.toLowerCase()}">Copy</button></div></div>`;
}
function selectedDetails(option) {
  return `<h3>${esc(option.label)}</h3>${copyField('Account name',option.account_name,'name')}${copyField(/gcash/i.test(option.label)?'Mobile number':'Account number',option.account_number,'number')}${option.note?`<p class="payment-method-note">${esc(option.note)}</p>`:''}`;
}
export function renderPaymentOptions(order,settings={}) {
  const details=orderPaymentDetails(order,settings), options=details.options;
  if(!options.length)return `<div class="payment-details">${esc(details.fallback)}</div>`;
  const selected=options.find(p=>p.id===selectedMethods.get(order.id))||options[0];
  return `<div class="payment-options" data-payment-options><fieldset><legend>Choose how to pay</legend><div class="payment-method-list">${options.map(p=>`<label class="payment-method"><input type="radio" name="payment-method" value="${esc(p.id)}" ${p.id===selected.id?'checked':''}><span>${esc(p.label)}</span></label>`).join('')}</div></fieldset><div class="payment-selected" data-payment-selected>${selectedDetails(selected)}</div>${copyField('Amount to pay',(Number(order.total_cents)/100).toFixed(2),'amount')}<p class="payment-copy-status" data-payment-status role="status" aria-live="polite"></p>${details.note?`<p class="payment-method-note">${esc(details.note)}</p>`:''}<p class="help-text">Pay using one option, then upload your receipt below.</p></div>`;
}
export function bindPaymentOptions(root,order,settings={}) {
  const widget=root.querySelector('[data-payment-options]');if(!widget)return;
  const options=orderPaymentDetails(order,settings).options;
  widget.addEventListener('change',event=>{
    if(event.target.name!=='payment-method')return;
    const option=options.find(p=>p.id===event.target.value);if(!option)return;
    selectedMethods.set(order.id,option.id);widget.querySelector('[data-payment-selected]').innerHTML=selectedDetails(option);widget.querySelector('[data-payment-status]').textContent='';
  });
  widget.addEventListener('click',async event=>{
    const button=event.target.closest('[data-payment-copy]');if(!button||button.disabled)return;
    const input=widget.querySelector(`#payment-${button.dataset.paymentCopy}`),value=input.value,status=widget.querySelector('[data-payment-status]');
    button.disabled=true;let copied=false;
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);copied=true;}}catch{/* Use the selectable field below. */}
    if(!copied&&input.isConnected){input.focus({preventScroll:true});input.select();input.setSelectionRange(0,value.length);try{copied=document.execCommand('copy')===true;}catch{}}
    if(!button.isConnected)return;
    button.disabled=false;button.textContent=copied?'Copied!':'Copy';
    status.textContent=copied?`${input.getAttribute('aria-label')} copied.`:'Automatic copying is unavailable. The details are selected—use your device’s Copy command.';
    if(copied)button.focus({preventScroll:true});setTimeout(()=>{if(button.isConnected)button.textContent='Copy';},2000);
  });
}
