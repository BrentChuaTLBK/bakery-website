import {inputQuantity} from './recipe-math.js?v=production-audit-1';
import {recipeStatusLabel} from './recipe-status.js?v=production-audit-1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const saleUnits=[['each','Each'],['box','Box'],['whole_cake','Whole cake'],['tray','Tray'],['set','Set']];
const unitLabel=value=>value==='each'?'Item':saleUnits.find(([id])=>id===value)?.[1]||'Unit';
export function costMoney(value,currency='PHP'){
 if(value==null||value==='')return '—';
 try{return new Intl.NumberFormat('en-PH',{style:'currency',currency}).format(Number(value));}catch{return `${currency} ${Number(value).toFixed(2)}`;}
}
const countLabel=(unit,count)=>{const noun=unitLabel(unit).toLowerCase();return `${count} ${noun}${Number(count)===1?'':unit==='box'?'es':'s'}`;};
const percent=value=>value==null?'—':`${Number(value).toLocaleString('en-PH',{maximumFractionDigits:2})}%`;
const when=value=>value?new Date(value).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}):'Not recorded';
export function costingEditor(v,path,{field,button}){
 const c=v.costing,sale=c.mode==='saleable',direct=(v.additional_costs||[]).map((cost,index)=>({cost,index})).filter(({cost})=>!cost.resource_id);
 return `<section class="recipe-card recipe-costing-editor"><h2>Costing & profitability</h2><p class="recipe-muted">These settings belong to this size and are saved with each recipe version.</p><div class="recipe-fields two">
 ${field('Costing mode',`${path}.costing.mode`,{options:[['costing_only','Costing Only'],['saleable','Saleable Product Costing']]})}
 ${field('Labor & Utilities Allowance (%)',`${path}.costing.labor_percent`)}
 </div><p class="recipe-muted">The allowance increases cost. It is separate from profit and selling-price markup.</p>
 <div class="recipe-fields two" data-saleable-settings ${sale?'':'hidden'}>
 ${field('Saleable units per base batch',`${path}.costing.saleable_yield`)}
 ${field('Saleable unit',`${path}.costing.sale_unit`,{options:saleUnits})}
 ${field('Selling price · '+(v.currency||'PHP'),`${path}.costing.selling_price`)}
 ${field('Selling price applies to',`${path}.costing.price_basis`,{options:[['unit','One saleable unit'],['batch','One base batch']]})}
 <p class="recipe-muted wide">Use the number of finished items you can sell, such as 6 cakes or 2 boxes. This is separate from raw batter weight and recipe portions.</p></div>
 <div class="recipe-section-head"><h3>Other direct costs</h3>${button('+ Direct cost','add-direct-cost')}</div><p class="recipe-muted">Linked packaging is included from the Packaging section. Enter only additional charges here.</p>
 ${direct.map(({cost:c,index})=>`<div class="recipe-direct-cost"><div class="recipe-fields two">${field('Charge',`${path}.additional_costs.${index}.name`)}${field('Amount · PHP',`${path}.additional_costs.${index}.amount`)}${field('Cost category',`${path}.additional_costs.${index}.kind`,{options:[['direct','Other direct cost'],['packaging','Manual packaging cost']]})}<label class="recipe-inline-check"><input type="checkbox" data-cost-fixed="${index}" ${c.per_batch===false?'checked':''}>Fixed amount for this production run</label></div>${button('Remove charge','remove-cost',`data-index="${index}"`,'danger')}</div>`).join('')}
 <div class="recipe-actions">${button('Calculate costing','cost-preview','','primary')}</div></section>`;
}
export function costSummaryMarkup(snapshot,summary,{source='saved',version=null,pricesChanged=false,details=true}={}){
 if(!summary)return '<p class="recipe-muted">Costing has not been calculated for this size.</p>';
 const money=value=>costMoney(value,snapshot.currency||'PHP'),sale=summary.mode==='saleable',complete=summary.complete;
 const key=(label,value,name)=>`<div><dt>${label}</dt><dd data-cost-value="${name}">${esc(value)}</dd></div>`;
 const old=source==='saved'&&snapshot.calculated_at&&Date.now()-new Date(snapshot.calculated_at).getTime()>90*86400000;
 const hasZero=(summary.lines||[]).some(line=>line.price&&Number(line.price.amount)===0);
 return `<div class="recipe-cost-summary" data-cost-source="${source}"><p class="recipe-muted">${source==='current'?'Current active prices for this formula and its pinned component formulas.':'Saved cost snapshot. Linked components retain their saved version prices.'}${version!=null?` Recipe version ${esc(version)}.`:''} ${esc(summary.variant_name||'')} · Production multiplier ×${esc(summary.factor||'1')} · ${esc(when(snapshot.calculated_at))}</p>
 ${pricesChanged?'<p class="recipe-notice">Current prices differ from this version’s saved costing. The saved formula and snapshot are unchanged.</p>':''}
 ${old?'<p class="recipe-notice">This cost snapshot is over 90 days old. Check current prices before making a selling-price decision.</p>':''}
 ${!complete?`<div class="recipe-notice" role="status"><strong>Costing incomplete — ${summary.missing?.length||1} missing price or conversion${summary.missing?.length===1?'':'s'}.</strong><ul>${(summary.missing||[]).map(m=>`<li>${esc(m.name||m.row_id)}: ${esc(m.reason)}</li>`).join('')}</ul><p>Known costs total ${esc(money(summary.known_total))}. Full cost and profitability remain unavailable.</p></div>`:''}
 ${summary.below_cost?'<p class="recipe-error" role="status">Selling price is below adjusted production cost.</p>':''}
 ${hasZero?'<p class="recipe-muted">A saved purchase price is zero. Confirm that this item is intentionally free.</p>':''}
 <dl class="recipe-cost-highlights">${key('Base cost · batch',money(summary.base_cost),'base_cost')}${key('Adjusted cost · batch',money(summary.adjusted_cost),'adjusted_cost')}${sale?`${key('Revenue · batch',money(summary.revenue),'revenue')}${key('Estimated profit · batch',money(summary.profit),'profit')}${key('Profit margin',percent(summary.margin),'margin')}`:''}</dl>
 <dl class="recipe-cost-breakdown">${key(complete?'Ingredients':'Known ingredient cost',money(summary.ingredient_cost),'ingredient_cost')}${key(complete?'Packaging':'Known packaging cost',money(summary.packaging_cost),'packaging_cost')}${key('Other direct costs',money(summary.other_direct_cost),'other_direct_cost')}${key('Labor & Utilities',`${percent(summary.labor_percent)} = ${money(summary.labor_allowance)}`,'labor_allowance')}</dl>
 ${sale?`<h3>Per saleable ${esc(unitLabel(summary.sale_unit).toLowerCase())}</h3><p class="recipe-muted">Saleable yield: ${esc(countLabel(summary.sale_unit,summary.saleable_yield))}. Entered selling price: ${esc(money(summary.selling_price))} / ${summary.price_basis==='batch'?'base batch':esc(unitLabel(summary.sale_unit).toLowerCase())}.</p><dl class="recipe-cost-breakdown">${key('Base cost',money(summary.unit_base),'unit_base')}${key('Adjusted cost',money(summary.unit_adjusted),'unit_adjusted')}${key('Selling price',money(summary.unit_revenue),'unit_revenue')}${key('Estimated profit',money(summary.unit_profit),'unit_profit')}${key('Profit margin',percent(summary.margin),'unit_margin')}${key('Markup',percent(summary.markup),'markup')}${key('Break-even selling price',money(summary.break_even),'break_even')}</dl>
 <p class="recipe-muted">Break-even is per ${summary.price_basis==='batch'?'base batch':esc(unitLabel(summary.sale_unit).toLowerCase())}. Margin = profit ÷ revenue; markup = profit ÷ adjusted cost. ${summary.margin==null&&complete?'Margin is undefined when selling revenue is zero. ':''}${summary.markup==null&&complete?'Markup is undefined when adjusted cost is zero. ':''}Estimated product-level profit excludes costs outside this model.</p>`:'<p class="recipe-muted">Costing Only: no selling price or profit is assumed for this component.</p>'}
 ${details?`<details class="recipe-cost-lines"><summary>Ingredient, component and charge details</summary><div class="recipe-table-wrap"><table class="recipe-table"><thead><tr><th>Item</th><th class="numeric">Cost · ${esc(snapshot.currency||'PHP')}</th></tr></thead><tbody>${(summary.lines||[]).map(l=>`<tr><td>${esc(l.name||l.row_id)}${l.component_version_id?' · pinned component':''}</td><td class="numeric">${esc(money(l.amount))}</td></tr>`).join('')}</tbody></table></div></details>`:''}</div>`;
}
export async function openCosting({record,document,variant,editing,factor='1',scalingMode='multiplier',api,dialog,host}){
 let request=0;const doc=structuredClone(document),version=record?.version,versionId=record?.version_id,variantId=doc.variants[variant].id;
 dialog('Recipe costing',`<div class="recipe-fields two"><label>Price source<select data-cost-source-choice>${editing?'':'<option value="saved">Saved cost snapshot</option>'}<option value="current">Current active prices</option></select></label><label>Production multiplier<input data-cost-factor value="${esc(factor)}" inputmode="decimal"></label></div><p class="recipe-muted">${editing?'Working draft preview. Save the recipe to capture these settings.':'A current-price calculation never rewrites this saved version.'}</p><div data-cost-results aria-live="polite"></div>`);
 const source=host.querySelector('[data-cost-source-choice]'),factorInput=host.querySelector('[data-cost-factor]'),results=host.querySelector('[data-cost-results]');
 async function refresh(){
  const ticket=++request;results.innerHTML='<p role="status">Calculating costing…</p>';
  try{
   if(!inputQuantity(factorInput.value).n)throw Error('Costing multiplier must be greater than zero.');
   const data=editing?await api('cost_preview',{document:doc,factor:factorInput.value,scaling_mode:scalingMode,source:source.value}):await api('costing',{id:record.id,version_id:versionId,factor:factorInput.value,scaling_mode:scalingMode,source:source.value});
   if(ticket!==request||!results.isConnected)return;
   results.innerHTML=costSummaryMarkup(data.snapshot,data.snapshot.variants.find(v=>v.variant_id===variantId),{source:source.value,version,pricesChanged:data.prices_changed});
  }catch(error){if(ticket===request&&results.isConnected){results.innerHTML=`<p class="recipe-error" role="alert">${esc(error.message)}</p><button type="button" data-retry-cost>Try calculation again</button>`;results.querySelector('button').onclick=refresh;}}
 }
 source.addEventListener('change',refresh);factorInput.addEventListener('change',refresh);await refresh();
}
export function costingOverviewMarkup(data,filters,categories,{button}){
 const option=(value,label,current)=>`<option value="${esc(value)}" ${current===value?'selected':''}>${esc(label)}</option>`;
 return `<section class="recipe-card recipe-cost-overview"><h2>Costing Overview</h2><p class="recipe-muted">Saved cost snapshots by recipe version and size. Open a product to compare current prices. Batch amounts use each size’s base batch.</p><div class="recipe-filters">
 <label>Find product<input type="search" data-cost-filter="query" value="${esc(filters.query||'')}"></label>
 <label>Category<select data-cost-filter="category_id">${option('','All categories',filters.category_id||'')}${categories.filter(c=>!c.deleted_at).map(c=>option(c.id,c.name,filters.category_id)).join('')}</select></label>
 <label>Product line<input data-cost-filter="product_line" value="${esc(filters.product_line||'')}"></label>
 <label>Status<select data-cost-filter="status">${[['','Active recipes'],['draft','Draft'],['production','Final'],['hidden','Hidden'],['archived','Archive']].map(([v,l])=>option(v,l,filters.status||'')).join('')}</select></label>
 <label>Costing mode<select data-cost-filter="mode">${[['saleable','Saleable products'],['costing_only','Costing only'],['all','All recipes']].map(([v,l])=>option(v,l,filters.mode||'saleable')).join('')}</select></label>
 <label>Cost condition<select data-cost-filter="condition">${[['','All costs'],['missing','Missing costs'],['profitable','Profitable'],['negative','Negative profit']].map(([v,l])=>option(v,l,filters.condition||'')).join('')}</select></label>
 <label>Sort<select data-cost-filter="sort">${[['','Name A–Z'],['highest_cost','Highest adjusted cost'],['lowest_cost','Lowest adjusted cost'],['highest_profit','Highest profit'],['lowest_margin','Lowest margin'],['highest_margin','Highest margin'],['updated','Recently updated']].map(([v,l])=>option(v,l,filters.sort||'')).join('')}</select></label>
 <label>Updated<select data-cost-filter="recent">${option('','Any time',filters.recent?'true':'')}${option('true','Last 30 days',filters.recent?'true':'')}</select></label></div>
 <p role="status">${data.total} matching recipe sizes</p><div class="recipe-cost-overview-list">${data.rows.map(r=>{const s=r.summary,money=v=>costMoney(v,r.currency||'PHP');return `<article class="recipe-cost-product" data-cost-product="${r.id}" data-cost-variant="${esc(s.variant_id)}"><div class="recipe-section-head"><div><h3>${esc(r.name)} · ${esc(s.variant_name)}</h3><p class="recipe-muted">Version ${r.version} · ${recipeStatusLabel(r.status)} · ${esc(r.yield.quantity)} ${esc(r.yield.unit)}${s.mode==='saleable'?` · ${esc(countLabel(s.sale_unit,s.saleable_yield))} to sell`:''}</p></div>${button('Open costing','open-costing-product',`data-id="${r.id}" data-variant="${esc(s.variant_id)}"`)}</div>
 ${!s.complete?'<p class="recipe-notice">Costing incomplete — missing prices or conversions</p>':''}${s.below_cost?'<p class="recipe-error">Selling below adjusted cost</p>':''}
 <dl class="recipe-cost-breakdown">${[['Ingredients',money(s.ingredient_cost)],['Packaging',money(s.packaging_cost)],['Base · batch',money(s.base_cost)],['Labor & Utilities',percent(s.labor_percent)],['Adjusted · batch',money(s.adjusted_cost)],['Selling price',s.mode==='saleable'?`${money(s.selling_price)} / ${s.price_basis==='batch'?'batch':unitLabel(s.sale_unit).toLowerCase()}`:'—'],['Profit · batch',money(s.profit)],['Margin',percent(s.margin)]].map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="recipe-muted">Last costing: ${esc(when(r.costed_at))}</p></article>`;}).join('')||'<p class="recipe-empty">No products match. Set a recipe size to Saleable Product Costing or change the filters.</p>'}</div>
 <div class="recipe-pagination">${button('Previous','costing-page',`data-offset="${Math.max(0,(filters.offset||0)-24)}" ${(filters.offset||0)===0?'disabled':''}`)}<span>${data.total?`${(filters.offset||0)+1}–${Math.min((filters.offset||0)+24,data.total)} of ${data.total}`:'0 results'}</span>${button('Next','costing-page',`data-offset="${(filters.offset||0)+24}" ${(filters.offset||0)+24>=data.total?'disabled':''}`)}</div></section>`;
}
