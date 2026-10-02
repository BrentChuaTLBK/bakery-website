import {allRecipeSuppliers} from './recipe-catalog.js?v=approved-20261002-1';
import {unitOptionsMarkup,setUnitSelection} from './recipe-units.js?v=refinement-20261002-1';
import {unitInfo} from './recipe-math.js?v=approved-20261002-1';
import {costMoney} from './recipe-costing.js?v=refinement-20261002-1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const key=user=>user?'tlb-recipe-purchase-v1:'+user:null;
const draftEpochs=new Map();
export const purchaseDraft={
 read(user){try{const value=key(user)&&JSON.parse(sessionStorage.getItem(key(user)));return value?.request_id&&value?.data?value:null;}catch{return null;}},
 write(user,value){try{if(key(user))sessionStorage.setItem(key(user),JSON.stringify(value));}catch{}},
 clear(user){draftEpochs.set(user,(draftEpochs.get(user)||0)+1);try{if(key(user))sessionStorage.removeItem(key(user));}catch{}}
};
export async function openItemPrice(options){return openPurchase({...options,kind:options.record.kind});}
export async function openPurchase({api,dialog,body,close,onSaved,kind='ingredient',userId,record=null}){
 const draftEpoch=draftEpochs.get(userId)||0;
 const draft=record?null:purchaseDraft.read(userId),request_id=draft?.request_id||crypto.randomUUID();
 const suppliers=(await allRecipeSuppliers(api)).filter(s=>s.active!==false&&!s.deleted_at),price=record?.price||{};
 const saved=draft?.data||{kind,name:record?.name||'',brand:record?.data?.brand||'',supplier_id:price.supplier_id||'',unit:price.unit||record?.data?.default_unit||'',quantity:record?price.quantity||'':'',purchased_on:today()};
 let selected=record||draft?.selected||null,items=[],searchTimer,previewTimer,sequence=0,previewSequence=0;
 const option=(value,label,current)=>'<option value="'+esc(value)+'" '+(value===current?'selected':'')+'>'+esc(label)+'</option>';
 const input=(name,label,{attrs='',value=saved[name]||''}={})=>'<label>'+label+'<input name="'+name+'" value="'+esc(value)+'" '+attrs+'></label>';
 dialog(record?'Record price':'Record purchase','<form id="'+(record?'recipe-item-price-form':'recipe-purchase-form')+'"><p class="recipe-muted">'+(draft?'Your unfinished purchase has been restored.':'Choose a saved supplier and record the total paid.')+' '+(record?'Saved recipe snapshots stay unchanged.':'Your unfinished purchase is kept in this browser tab until you save or discard it.')+'</p><div class="recipe-fields two">'+
 '<label>Purchase type<select name="kind" '+(record?'disabled':'')+'>'+option('ingredient','Ingredient',saved.kind)+option('packaging','Packaging',saved.kind)+'</select></label>'+
 input('name','Ingredient or packaging name',{attrs:'list="purchase-items" required maxlength="200" autocomplete="off" '+(record?'readonly':'')})+'<datalist id="purchase-items"></datalist>'+
 input('brand','Brand · optional',{attrs:'maxlength="200" '+(record?'readonly':'')})+
 '<label>Supplier<select name="supplier_id" required>'+option('','Choose a supplier',saved.supplier_id)+suppliers.map(s=>option(s.id,s.name,saved.supplier_id)).join('')+'</select></label>'+
 input('amount','Total price paid · PHP',{attrs:'inputmode="decimal" required'})+input('quantity','Total quantity bought',{attrs:'inputmode="decimal" required'})+
 '<label>Purchase unit<select name="unit" required>'+unitOptionsMarkup(saved.unit)+'</select></label>'+input('purchased_on','Purchase date',{attrs:'type="date" required',value:saved.purchased_on||today()})+
 '<div class="wide recipe-fields two" data-pack-contents hidden>'+input('contents_quantity','Contents of one <span data-pack-label>pack</span>',{attrs:'inputmode="decimal" placeholder="e.g. 1000"'})+'<label>Contents unit<select name="contents_unit">'+unitOptionsMarkup(saved.contents_unit||selected?.data?.default_unit||'g')+'</select></label><p class="recipe-muted wide">For example, one bag contains 1000 g. Use the quantity printed on this item’s pack.</p></div>'+
 '<label class="wide">Notes · optional<textarea name="notes">'+esc(saved.notes)+'</textarea></label></div>'+
 (suppliers.length?'':'<p class="recipe-notice">Add a supplier in Manage → Suppliers before recording a purchase.</p>')+
 '<label class="recipe-inline-check"><input name="preferred" type="checkbox" '+(saved.preferred?'checked':'')+'>Use this as my preferred supplier for this item</label>'+
 '<div class="recipe-purchase-preview" data-purchase-preview aria-live="polite">Enter the amount, quantity and unit to preview the cost.</div><p role="status" data-purchase-status data-price-entry-status></p>'+
 '<div class="recipe-actions"><button type="submit" class="primary">'+(record?'Save price':'Save purchase')+'</button><button type="button" data-keep-purchase>'+(record?'Close':'Keep draft & close')+'</button>'+(record?'':'<button type="button" data-discard-purchase>Discard draft</button>')+'</div></form>');
 const form=body.querySelector('form'),field=name=>form.elements.namedItem(name),status=form.querySelector('[data-purchase-status]');
 if(record){const heading=document.createElement('h3');heading.textContent=record.name;form.prepend(heading);if(record.data?.brand){const brand=document.createElement('p');brand.className='recipe-muted';brand.textContent='Brand: '+record.data.brand;heading.after(brand);}}
 function data(){return {...Object.fromEntries(new FormData(form)),kind:field('kind').value,preferred:field('preferred').checked};}
 function persist(){if(!record&&draftEpoch===(draftEpochs.get(userId)||0))purchaseDraft.write(userId,{request_id,data:data(),selected});}
 function contents({prefill=false}={}){
  const unit=field('unit').value,custom=unit&&unitInfo(unit).dimension.startsWith('custom:');
  const panel=form.querySelector('[data-pack-contents]');panel.hidden=!custom;form.querySelector('[data-pack-label]').textContent=unit||'pack';
  if(prefill&&custom){const conversion=selected?.data?.unit_conversions?.[unit];field('contents_quantity').value=conversion?.quantity||'';setUnitSelection(field('contents_unit'),conversion?.unit||selected?.data?.default_unit||'g');}
  field('contents_quantity').required=Boolean(custom&&selected&&unitInfo(selected.data?.default_unit||unit).dimension!==unitInfo(unit).dimension);
 }
 function payload(){const values=data(),supplier=suppliers.find(s=>s.id===values.supplier_id);if(!supplier)throw Error('Choose a saved supplier.');return {...values,request_id,resource_id:selected?.id||null,supplier_name:supplier.name,
  ...(form.querySelector('[data-pack-contents]').hidden?{contents_quantity:'',contents_unit:''}:{}),notes:[values.purchased_on?'Purchased '+values.purchased_on:'',values.notes].filter(Boolean).join(' · ')};}
 async function preview(){
  const ticket=++previewSequence,host=form.querySelector('[data-purchase-preview]');
  try{const result=await api('purchase_preview',payload());if(ticket!==previewSequence||!form.isConnected)return;
   host.innerHTML='<strong>'+esc(costMoney(result.proposed_unit_cost))+' / '+esc(result.unit)+'</strong><p>'+esc(result.quantity)+' '+esc(result.unit)+' bought in total.'+(result.current_unit_cost==null?'':' Current cost: '+esc(costMoney(result.current_unit_cost))+' / '+esc(result.unit)+'.')+'</p><p>'+(result.effective_unit_cost==null?'':'Cost after saving: '+esc(costMoney(result.effective_unit_cost))+' / '+esc(result.unit)+'. ')+result.affected_recipes+' saved recipe'+(result.affected_recipes===1?'':'s')+' linked to this item.</p><small>Saved historical snapshots stay unchanged.</small>';
  }catch(error){if(ticket===previewSequence&&form.isConnected)host.textContent=error.message;}
 }
 const schedule=()=>{++previewSequence;clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(form.isConnected)preview();},300);persist();};
 const search=async()=>{const ticket=++sequence,result=await api('resources',{kind:field('kind').value,query:field('name').value,limit:50,include_inactive:true});if(ticket!==sequence||!form.isConnected)return;items=result.rows;form.querySelector('#purchase-items').innerHTML=items.map(r=>'<option value="'+esc(r.name)+'">'+esc(r.data.brand||'')+'</option>').join('');};
 function selectMatch(){if(record)return;const matches=items.filter(r=>r.name.toLowerCase()===field('name').value.trim().toLowerCase()&&(!field('brand').value||String(r.data.brand||'').toLowerCase()===field('brand').value.trim().toLowerCase()));selected=matches.length===1?matches[0]:null;if(selected){field('brand').value=selected.data.brand||'';if(!field('unit').value)setUnitSelection(field('unit'),selected.data.default_unit||'');}contents({prefill:true});schedule();}
 field('name').addEventListener('input',()=>{if(record)return;selected=null;clearTimeout(searchTimer);searchTimer=setTimeout(()=>search().catch(error=>status.textContent=error.message),200);});
 field('name').addEventListener('change',selectMatch);field('brand').addEventListener('change',selectMatch);
 field('kind').addEventListener('change',()=>{selected=null;search().catch(error=>status.textContent=error.message);});field('unit').addEventListener('change',()=>contents({prefill:true}));
 field('supplier_id').addEventListener('change',()=>{if(!record)return;const quote=record.suppliers?.find(s=>s.supplier_id===field('supplier_id').value)?.price;if(quote){field('quantity').value=quote.quantity;setUnitSelection(field('unit'),quote.unit);contents({prefill:true});}});
 form.addEventListener('input',schedule);form.addEventListener('change',schedule);form.querySelector('[data-keep-purchase]').onclick=()=>{persist();close();};
 if(!record)form.querySelector('[data-discard-purchase]').onclick=()=>{purchaseDraft.clear(userId);close();};
 form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;const submit=form.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;status.textContent='Saving purchase…';persist();try{
  const values=payload();await api('record_purchase',values);if(!record)purchaseDraft.clear(userId);close();await onSaved(values.kind);
 }catch(error){status.textContent=error.message;}finally{if(submit.isConnected)submit.disabled=false;}});
 contents();if(!record)await search();if(saved.amount&&saved.quantity)schedule();
}
