import {api,escapeHtml as esc} from './client.js';
import {renderVoucherEmail} from './voucher-email.js?v=brand-20261001';

export function createVoucherEmailPreview(){
 let dialog=null,version=0,alive=true;
 function close(){version++;dialog?.close();dialog?.remove();dialog=null;}
 async function open(payload){
  close();if(!alive)return;
  const request=++version,el=document.createElement('dialog');dialog=el;
  el.className='offer-email-preview';el.setAttribute('aria-labelledby','offer-email-preview-title');
  el.innerHTML='<div class="offer-email-heading"><div><span class="eyebrow">Customer email</span><h2 id="offer-email-preview-title">Email preview</h2></div><button class="button button-secondary" type="button" data-preview-close aria-label="Close email preview" autofocus>Close</button></div><div class="offer-email-content"><p role="status">Preparing your email preview…</p></div>';
  document.body.append(el);
  el.querySelector('[data-preview-close]').onclick=()=>el.close();
  el.addEventListener('close',()=>{el.remove();if(dialog===el){dialog=null;version++;}});
  el.showModal();
  try{
   const sample=await api('voucher_email_preview',payload);
   const result={subject:sample.subject,...renderVoucherEmail(sample.payload)};
   if(!alive||request!==version||!el.open)return;
   if(typeof result.html!=='string'||typeof result.text!=='string')throw Error('The email preview could not be loaded.');
   el.querySelector('.offer-email-content').innerHTML=`<p class="offer-email-subject"><strong>Subject:</strong> ${esc(result.subject)}</p><p class="offer-help">Sample code and customer email. For expiry in days, the sample assumes the voucher is issued today. Previewing does not send an email or issue a voucher.</p><div class="voucher-tabs offer-email-controls" role="group" aria-label="Email preview format"><button type="button" data-preview-mode="desktop" aria-pressed="true">Desktop</button><button type="button" data-preview-mode="mobile" aria-pressed="false">Mobile</button><button type="button" data-preview-mode="text" aria-pressed="false">Plain text</button></div><div class="offer-email-canvas" data-preview-canvas><iframe title="Thank-you voucher email" sandbox="" referrerpolicy="no-referrer"></iframe></div><pre class="offer-email-text" data-preview-text hidden></pre>`;
   // Links are inert in the preview; sending uses the unmodified renderer output.
   const doc=new DOMParser().parseFromString(result.html,'text/html');
   doc.querySelectorAll('a').forEach(a=>a.removeAttribute('href'));
   el.querySelector('iframe').srcdoc=doc.documentElement.outerHTML;
   el.querySelector('[data-preview-text]').textContent=result.text;
   el.querySelectorAll('[data-preview-mode]').forEach(button=>button.onclick=()=>{
    const mode=button.dataset.previewMode;
    el.querySelectorAll('[data-preview-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    el.querySelector('[data-preview-canvas]').hidden=mode==='text';
    el.querySelector('[data-preview-canvas]').classList.toggle('is-mobile',mode==='mobile');
    el.querySelector('[data-preview-text]').hidden=mode!=='text';
   });
  }catch(error){
   if(!alive||request!==version||!el.open)return;
   el.querySelector('.offer-email-content').innerHTML=`<p class="notice danger" role="alert">${esc(error.message||'Unable to load the email preview.')}</p><button type="button" class="button" data-preview-retry>Try again</button>`;
   el.querySelector('[data-preview-retry]').onclick=()=>open(payload);
  }
 }
 return {open,destroy(){alive=false;close();}};
}
