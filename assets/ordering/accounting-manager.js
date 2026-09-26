import {accountingTotals, monthRange, parseAccountingAmount, accountingPaymentMethods} from './accounting.js?v=shared-categories-1';
import {exportAccounting} from './accounting-export.js?v=continuous-entry-1';
import {accountingDatePicker, bindAccountingDates, setAccountingDate} from './accounting-date-picker.js?v=branded-calendars-1';
import {isCalendarDate} from './date-calendar.js?v=daily-quantities-1';
import {confirmDialog} from './site-dialog.js?v=branded-dialogs-1';

export function mountAccounting(root, {api, role, connected, money, escapeHtml: esc, today, filters, openOrder}) {
  if (!root) return;
  if (!connected || role !== 'owner') {root.innerHTML='<p class="notice">Sign in as the owner to use accounting.</p>';return;}
  const $ = selector => root.querySelector(selector);
  let report = null, loadId = 0, page = 0, draft = null, categoryDraft = null;
  const opt = (value,text,selected) => `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(text)}</option>`;
  const field = (name,label,value='',type='text',attrs='') => ['date','month'].includes(type) ? accountingDatePicker(name,label,value,today,{mode:type}) : `<label class="field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  const selection = (name,label,options) => `<label class="field">${label}<select name="${name}">${options}</select></label>`;
  const error = '<p class="form-error" role="alert"></p>';
  root.innerHTML=`<div class="view-heading"><div><span class="eyebrow">The Little Baker Kitchen</span><h1>Accounting</h1><p>Sales, expenses and delivery costs, together in one place.</p></div><div class="row-actions"><button class="button button-secondary" data-accounting="refresh">Refresh</button><button class="button button-secondary" data-accounting="export" disabled>Export to Excel</button><button class="button" data-accounting="add" disabled>Add entry</button></div></div>
    <form class="panel accounting-filters">${field('month','Choose a month',filters.start.slice(0,7),'month')}${field('start','From date',filters.start,'date','required')}${field('end','Through date',filters.end,'date','required')}<button class="button" type="submit">Apply timeframe</button>${error}</form>
    <p class="help-text">Only paid, confirmed orders and orders being prepared or already fulfilled are included. Cancelled and refunded orders are excluded entirely, including discounts and delivery costs. All dates use Manila time.</p>
    <p class="notice accounting-message" role="status" hidden></p><section class="panel accounting-editor" hidden></section>
    <div class="accounting-report"><p>Loading accounting…</p></div>
    <section class="panel accounting-categories"><details><summary>Manage categories</summary><p class="help-text">Use the same category for sales and expenses. Choose the type when you add an entry. Automatic website categories are managed by the system.</p><div class="accounting-category-form"></div></details></section>`;
  function message(text,bad=false) { const box=$('.accounting-message');box.hidden=!text;box.textContent=text;box.classList.toggle('danger',bad); }
  function summarySection(kind,title) {
    const key=kind==='sale'?'sales_cents':'expense_cents',rows=report.summary.filter(c=>Number(c[key])!==0),sum=rows.reduce((n,c)=>n+Number(c[key]),0);
    return `<section class="panel"><h2>${title}</h2><dl class="accounting-breakdown">${rows.map(c=>`<div><dt>${esc(c.name)}</dt><dd>${money(c[key])}</dd></div>`).join('')||'<p class="muted">No entries in this timeframe.</p>'}<div class="accounting-subtotal"><dt>Total ${kind==='sale'?'sales / income':'expenses'}</dt><dd>${money(sum)}</dd></div></dl></section>`;
  }
  function renderReport() {
    const t=accountingTotals(report),rows=report.entries.slice().reverse(),cats=new Map(report.categories.map(c=>[c.id,c]));
    page=Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1));
    $('.accounting-report').innerHTML=`<div class="accounting-summary">${summarySection('sale','Sales & income')}${summarySection('expense','Expenses')}</div>
      <section class="panel accounting-net"><div><span class="eyebrow">Overall total</span><h2>Income less expenses</h2><p>Based on the entries recorded for ${esc(report.start)} to ${esc(report.end)}.</p></div><strong>${money(t.net)}</strong></section>
      ${t.missingCosts?`<p class="notice">${t.missingCosts} delivery order${t.missingCosts===1?' needs':'s need'} an actual cost. The overall total will change when these expenses are recorded.</p>`:''}
      ${report.legacy_count?'<p class="notice">Some older orders had no detailed change history. Their current saved amounts were imported on the payment approval date.</p>':''}
      <section class="panel accounting-records"><div class="section-heading"><h2>Accounting entries</h2><span class="badge">${rows.length} entries</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Category / details</th><th>Source</th><th>Sales / income</th><th>Expense</th><th>Actions</th></tr></thead><tbody>${rows.slice(page*50,(page+1)*50).map(e=>{const c=cats.get(e.category_id);return `<tr><td>${esc(e.entry_date)}</td><td><strong>${esc(c?.name)}</strong><small class="accounting-note">${esc(e.note)}</small>${e.client_name?`<small class="accounting-note">${e.kind==='expense'?'Supplier':'Client'}: ${esc(e.client_name)}</small>`:''}${e.source==='Manual'?`<small>Payment: ${esc(accountingPaymentMethods[e.payment_method]||'Not recorded')}</small>`:''}${e.reference?`<button class="button button-quiet" data-accounting="order" data-id="${esc(e.order_id)}">${esc(e.reference)}</button>`:''}</td><td>${esc(e.source)}</td><td>${e.kind==='sale'?money(e.amount_cents):'—'}</td><td>${e.kind==='expense'?money(e.amount_cents):'—'}</td><td>${e.source==='Manual'?`<button class="button button-quiet" data-accounting="edit" data-id="${esc(e.id)}">Edit</button><button class="button button-quiet" data-accounting="delete" data-id="${esc(e.id)}">Remove</button><button class="button button-quiet" data-accounting="history" data-id="${esc(e.id)}">History</button>`:e.source==='Delivery cost'?'<span class="muted">Edit in order</span>':'<span class="muted">Automatic</span>'}</td></tr>`;}).join('')||'<tr><td colspan="6">No entries in this timeframe.</td></tr>'}</tbody></table></div>
      ${rows.length>50?`<div class="row-actions accounting-pagination"><button class="button button-secondary" data-accounting="previous" ${page===0?'disabled':''}>Previous</button><span>Page ${page+1} of ${Math.ceil(rows.length/50)}</span><button class="button button-secondary" data-accounting="next" ${(page+1)*50>=rows.length?'disabled':''}>Next</button></div>`:''}<p class="help-text">Excel includes all entries in the selected timeframe, across every page. Negative automatic entries adjust earlier amounts for included orders.</p><div class="accounting-history"></div></section>
      <section class="panel"><div class="section-heading"><h2>Delivery comparison</h2><span class="badge">${report.deliveries.length} orders</span></div><p class="help-text">Orders paid in this timeframe. Costs are expenses on their cost date. Difference for orders with a recorded cost: <strong>${money(t.deliveryDifference)}</strong>.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Order</th><th>Customer fee collected</th><th>Actual delivery cost</th><th>Difference</th></tr></thead><tbody>${report.deliveries.map(d=>`<tr><td><button class="button button-quiet" data-accounting="order" data-id="${esc(d.order_id)}">${esc(d.reference)}</button>${d.refund_label||['cancelled','expired'].includes(d.status)?'<small class="accounting-note">Sales reversed</small>':''}</td><td>${money(d.fee_cents)}</td><td>${d.cost_cents===null?'Not recorded':money(d.cost_cents)}</td><td>${d.cost_cents===null?'—':money(d.fee_cents-d.cost_cents)}</td></tr>`).join('')||'<tr><td colspan="4">No delivery orders in this timeframe.</td></tr>'}</tbody></table></div></section>`;
  }
  function renderCategories(selected='') {
    const cats=report.categories.filter(c=>!c.system_key),c=cats.find(c=>c.id===selected);
    categoryDraft=c?{...c}:{id:crypto.randomUUID(),revision:0,name:''};
    $('.accounting-category-form').innerHTML=`<form class="accounting-category-editor">${selection('existing','Category',opt('','Create a category',selected)+cats.map(c=>opt(c.id,`${c.name}${c.archived?' (archived)':''}`,selected)).join(''))}${field('name','Category name',categoryDraft.name,'text','required maxlength="80"')}${c?`<label class="check-field"><input name="archived" type="checkbox" ${c.archived?'checked':''}>Archive category (keeps existing entries)</label>`:''}${error}<button class="button button-secondary" type="submit">Save category</button></form>`;
  }
  function renderEntry(entry=null) {
    draft=entry?{...entry}:{id:crypto.randomUUID(),revision:0,entry_date:today,kind:'sale',category_id:'',note:'',client_name:'',payment_method:'',amount_cents:null};
    const panel=$('.accounting-editor');panel.hidden=false;
    panel.innerHTML=`<div class="section-heading"><h2>${entry?'Edit entry':'Add manual entry'}</h2><button class="button button-quiet" data-accounting="cancel-entry">Close</button></div><form class="accounting-entry-form"><div class="field-row three">${field('entry_date','Date',draft.entry_date,'date','required')}${selection('kind','Type',opt('sale','Sales / income',draft.kind)+opt('expense','Expense',draft.kind))}${field('amount','Amount · PHP',draft.amount_cents===null?'':(draft.amount_cents/100).toFixed(2),'number','required min="0.01" max="9999999.99" step="0.01" inputmode="decimal"')}</div><div class="field-row three"><div>${selection('category_id','Category','')}<div class="accounting-new-category" hidden>${field('new_category','New category name','','text','maxlength="80"')}</div></div>${field('client_name','Client name · optional',draft.client_name||'','text','maxlength="160" autocomplete="off"')}${selection('payment_method','Payment method · optional',opt('','Not recorded',draft.payment_method||'')+Object.entries(accountingPaymentMethods).map(([value,name])=>opt(value,name,draft.payment_method)).join(''))}</div><label class="field">Notes / reference · optional<textarea name="note" maxlength="2000">${esc(draft.note)}</textarea></label>${error}<button class="button" type="submit">Save entry</button></form>`;
    updateCategoryOptions(draft.category_id); updateNameLabel(); panel.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function updateNameLabel(){const form=$('.accounting-entry-form');if(form)form.elements.client_name.closest('label').firstChild.textContent=form.elements.kind.value==='expense'?'Supplier · optional':'Client name · optional';}
  function updateCategoryOptions(selected='') {
    const form=$('.accounting-entry-form');if(!form)return;
    form.elements.category_id.innerHTML=opt('','Choose a category',selected)+report.categories.filter(c=>!c.system_key&&(!c.archived||c.id===draft?.category_id)).map(c=>opt(c.id,c.name,selected)).join('')+opt('__new','+ Create a category',selected);
    form.elements.category_id.required=true; syncNewCategory();
  }
  function syncNewCategory() {const form=$('.accounting-entry-form');if(!form)return;const on=form.elements.category_id.value==='__new';$('.accounting-new-category').hidden=!on;form.elements.new_category.required=on;}
  async function load() {
    const request=++loadId;const range={...filters};
    $('[data-accounting=export]').disabled=true;
    try {
      const result=await api('accounting_report',{...range,report_version:2});
      if(result.report_version!==2)throw Error('The shared-category database update is still being installed. Please try again shortly.');
      if(request!==loadId||!root.isConnected)return;
      report=result;renderReport();renderCategories();
      $('[data-accounting=export]').disabled=false;$('[data-accounting=add]').disabled=false;
    } catch(e) {if(request===loadId&&root.isConnected){report=null;$('.accounting-report').innerHTML='<p class="notice">Accounting could not load. Please refresh to try again.</p>';message(e.message,true);}}
  }
  root.addEventListener('change',e=>{
    if(e.target.name==='month'){try{const range=monthRange(e.target.value);setAccountingDate($('.accounting-filters'),'start',range.start);setAccountingDate($('.accounting-filters'),'end',range.end);}catch(error){message(error.message,true);}}
    if(e.target.closest('.accounting-entry-form')&&e.target.name==='category_id')syncNewCategory();
    if(e.target.closest('.accounting-entry-form')&&e.target.name==='kind')updateNameLabel();
    if(e.target.name==='existing')renderCategories(e.target.value);
  });
  root.addEventListener('accounting-refresh',()=>load());
  root.addEventListener('input',e=>{if(e.target.closest('.accounting-entry-form,.accounting-category-editor'))root.dataset.dirty='true';});
  root.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();const form=event.target;
    if(root.dataset.busy==='true'||!form.reportValidity())return;
    const errorBox=form.querySelector('.form-error');errorBox.textContent='';
    root.dataset.busy='true';const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try {
      const f=new FormData(form);
      if(form.classList.contains('accounting-filters')) {
        if(!isCalendarDate(f.get('start'))||!isCalendarDate(f.get('end'))||f.get('start')>f.get('end'))throw Error('The end date must be on or after the start date.');
        filters.start=f.get('start');filters.end=f.get('end');page=0;message('');await load();
      } else if(form.classList.contains('accounting-category-editor')) {
        await api('accounting_save_category',{id:categoryDraft.id,revision:categoryDraft.revision,name:f.get('name'),archived:f.has('archived')});
        root.dataset.dirty='false';await load();message('Category saved.');if(draft)updateCategoryOptions(draft.category_id);
      } else if(form.classList.contains('accounting-entry-form')) {
        let category=f.get('category_id');
        if(category==='__new') {
          draft.new_category_id ||= crypto.randomUUID();
          const created=await api('accounting_save_category',{id:draft.new_category_id,revision:0,name:f.get('new_category')});
          report.categories.push(created);category=created.id;updateCategoryOptions(category);
        }
        const adding=draft.revision===0,position={top:window.scrollY,left:window.scrollX};
        const saved=await api('accounting_save_entry',{id:draft.id,revision:draft.revision,entry_date:f.get('entry_date'),kind:f.get('kind'),category_id:category,amount_cents:parseAccountingAmount(f.get('amount')),note:f.get('note'),client_name:f.get('client_name').trim(),payment_method:f.get('payment_method')});
        if(adding){
          // Keep the same form and context for rapid entry. A fresh ID prevents
          // the next record from overwriting this one; failed retries keep theirs.
          draft={id:crypto.randomUUID(),revision:0,entry_date:f.get('entry_date'),kind:f.get('kind'),category_id:category,payment_method:f.get('payment_method'),amount_cents:null,client_name:'',note:''};
          for(const name of ['amount','client_name','note','new_category'])form.elements[name].value='';
        }else draft={...draft,...saved,category_id:category,revision:saved.revision};
        root.dataset.dirty='false';await load();
        let status=form.querySelector('[data-entry-status]');
        if(!status){status=document.createElement('p');status.dataset.entryStatus='';status.className='help-text';status.setAttribute('role','status');form.append(status);}
        status.textContent=adding?'Entry saved. Ready for the next entry.':'Changes saved.';
        if(adding)form.elements.amount.focus({preventScroll:true});
        window.scrollTo({...position,behavior:'instant'});
      }
    } catch(e) {errorBox.textContent=e.message;}
    finally{root.dataset.busy='false';submit.disabled=false;}
  });
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-accounting]');if(!button)return;
    event.preventDefault();event.stopPropagation();if(root.dataset.busy==='true'||button.disabled)return;
    const action=button.dataset.accounting;
    if(action==='add'){renderEntry();return;}
    if(action==='cancel-entry'){draft=null;$('.accounting-editor').hidden=true;root.dataset.dirty='false';return;}
    if(action==='edit'){renderEntry(report.entries.find(e=>e.id===button.dataset.id));return;}
    if(action==='previous'||action==='next'){page+=action==='next'?1:-1;renderReport();return;}
    root.dataset.busy='true';button.disabled=true;
    try{
      if(action==='refresh'){message('');await load();}
      if(action==='export'&&report){
        // Recheck order eligibility immediately before export, using the loaded
        // timeframe rather than any unapplied date-picker edits.
        const fresh=await api('accounting_report',{start:report.start,end:report.end,report_version:2});
        if(fresh.report_version!==2)throw Error('The shared-category database update is still being installed. Please try again shortly.');
        if(!root.isConnected)return;
        report=fresh;renderReport();await exportAccounting(structuredClone(fresh));message('Excel file downloaded.');
      }
      if(action==='order')await openOrder(button.dataset.id);
      if(action==='delete'){
        const entry=report.entries.find(e=>e.id===button.dataset.id);
        if(await confirmDialog('Remove this manual accounting entry? Its change history will be kept.',{title:'Remove accounting entry?',confirmLabel:'Remove entry',cancelLabel:'Keep entry',danger:true})&&root.isConnected){
          await api('accounting_delete_entry',{id:entry.id,revision:entry.revision});await load();message('Entry removed.');
        }
      }
      if(action==='history'){
        const rows=await api('accounting_history',{id:button.dataset.id});
        $('.accounting-history').innerHTML=`<h3>Entry history</h3><ol class="history">${rows.map(r=>`<li>${esc(new Date(r.at).toLocaleString('en-PH',{timeZone:'Asia/Manila'}))} · ${r.action==='accounting_delete_entry'?'Removed':'Saved'}<p>${esc(r.after.entry_date)} · ${money(r.after.amount_cents)} · ${esc(r.after.note)}</p>${r.after.client_name?`<p>${r.after.kind==='expense'?'Supplier':'Client'}: ${esc(r.after.client_name)}</p>`:''}<p>Payment: ${esc(accountingPaymentMethods[r.after.payment_method]||'Not recorded')}</p></li>`).join('')}</ol>`;
      }
    }catch(e){message(e.message,true);}finally{root.dataset.busy='false';button.disabled=false;}
  });
  bindAccountingDates(root);
  load();
}

export async function mountDeliveryAccounting(root, order, {api, money, escapeHtml:esc, today}) {
  if(!root||order.method!=='delivery')return;
  root.innerHTML='<p class="help-text">Loading delivery accounting…</p>';
  bindAccountingDates(root);
  let saved,revision;
  const fee=order.payment_status==='paid'&&!order.refund_label&&!['cancelled','expired'].includes(order.fulfillment_status)?Number(order.delivery_cents||0):0;
  function render() {
    root.innerHTML=`<h3>Delivery accounting · owner only</h3><p>Customer delivery fee collected: <strong>${money(fee)}</strong>${order.payment_status!=='paid'?' · Payment not approved yet.':''}</p><form class="delivery-accounting-form"><div class="field-row"><label class="field">Actual delivery cost · PHP<input name="amount" type="number" step="0.01" min="0" max="9999999.99" inputmode="decimal" placeholder="Not recorded" value="${saved?.amount_cents==null?'':(saved.amount_cents/100).toFixed(2)}"><small>Leave blank if unknown. Enter 0 if delivery cost nothing.</small></label>${accountingDatePicker('cost_date','Cost date',saved?.cost_date||today,today)}</div><label class="field">Notes · optional<input name="note" maxlength="2000" value="${esc(saved?.note||'')}"></label><p class="delivery-difference"></p><p class="form-error" role="alert"></p><div class="row-actions"><button class="button button-secondary" type="submit">Save delivery cost</button><button class="button button-quiet" type="button" data-delivery-refresh>Refresh cost</button></div><p class="delivery-save-status" role="status"></p></form>`;
    compare();
  }
  function compare() {try{const value=parseAccountingAmount(root.querySelector('[name=amount]').value,true);root.querySelector('.delivery-difference').textContent=value===null?'Difference: waiting for actual cost.':`Difference: ${money(fee-value)}${fee-value<0?' · You cover the shortfall.':''}`;}catch{root.querySelector('.delivery-difference').textContent='Enter a valid cost to compare.';}}
  async function load(){const result=await api('accounting_get_delivery',{order_id:order.id});if(!root.isConnected)return;saved=result.cost;revision=result.order_revision;render();}
  try{await load();}catch(e){if(root.isConnected)root.innerHTML=`<p class="notice danger">${esc(e.message)}</p><button type="button" class="button button-secondary" data-delivery-refresh>Retry</button>`;}
  root.addEventListener('input',compare);
  root.addEventListener('click',async event=>{if(!event.target.closest('[data-delivery-refresh]'))return;event.preventDefault();event.stopPropagation();try{await load();}catch(e){root.querySelector('.form-error')?.replaceChildren(document.createTextNode(e.message));}});
  root.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();const form=event.target;if(form.dataset.busy==='true'||!form.reportValidity())return;
    form.dataset.busy='true';const button=form.querySelector('[type=submit]');button.disabled=true;form.querySelector('.form-error').textContent='';
    try{const f=new FormData(form);saved=await api('accounting_save_delivery',{order_id:order.id,order_revision:revision,revision:saved?.revision||0,amount_cents:parseAccountingAmount(f.get('amount'),true),cost_date:f.get('cost_date'),note:f.get('note')});if(root.isConnected)form.querySelector('.delivery-save-status').textContent=order.refund_label||['cancelled','expired'].includes(order.fulfillment_status)?'Delivery cost saved. This order is excluded from accounting.':'Delivery cost saved to accounting.';document.querySelector('#accounting-manager')?.dispatchEvent(new Event('accounting-refresh'));}
    catch(e){form.querySelector('.form-error').textContent=e.message;}
    finally{form.dataset.busy='false';button.disabled=false;}
  });
}
