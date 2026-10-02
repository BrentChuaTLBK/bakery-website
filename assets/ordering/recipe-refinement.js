import {costMoney} from './recipe-costing.js?v=refinement-20261002-1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function costToggle(aside){
 const toggle=document.createElement('button');toggle.type='button';toggle.className='recipe-mobile-cost-toggle';toggle.textContent='Breakdown';toggle.setAttribute('aria-expanded','false');
 toggle.onclick=()=>{const expanded=aside.classList.toggle('expanded');toggle.setAttribute('aria-expanded',String(expanded));toggle.textContent=expanded?'Hide breakdown':'Breakdown';};aside.prepend(toggle);
}

export function currentCostMarkup(snapshot,summary){
 if(!summary)return '<p class="recipe-muted">Choose a size to see its costs.</p>';
 const money=value=>costMoney(value,snapshot.currency),row=(label,value)=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
 return `<p class="recipe-eyebrow">Current cost · ${esc(summary.variant_name)}</p><strong class="recipe-live-total">${summary.complete?money(summary.adjusted_cost):'Incomplete'}</strong><p class="recipe-muted">${esc(summary.factor||'1')} × base batch · includes labor & utilities</p>
 <dl class="recipe-live-breakdown">${row('Ingredients',money(summary.ingredient_cost))}${row('Packaging',money(summary.packaging_cost))}${row('Other direct costs',money(summary.other_direct_cost))}${row(`Labor & utilities · ${esc(summary.labor_percent)}%`,money(summary.labor_allowance))}</dl>
 ${summary.complete?'':`<p role="status" class="recipe-notice">${(summary.missing||[]).map(m=>`${esc(m.name||'Item')}: ${esc(m.reason)}`).join('<br>')||'Add the missing quantities, prices or conversions.'}</p>`}
 ${summary.mode==='saleable'?`<dl class="recipe-live-breakdown">${row('Selling revenue',money(summary.revenue))}${row('Estimated profit',money(summary.profit))}${row('Margin',summary.margin==null?'—':Number(summary.margin).toFixed(1)+'%')}${row('Cost per saleable unit',money(summary.unit_adjusted))}</dl>`:''}${summary.below_cost?'<p class="recipe-error">Selling price is below cost.</p>':''}<p class="recipe-muted">Linked prices update this estimate. Saved snapshots keep their original costs.</p>`;
}

export function arrangeEditor(root,state,{api,onError}){
 const form=root.querySelector('#recipe-editor');if(!form)return;
 const footer=form.querySelector('.recipe-sticky-save'),children=[...form.children];
 const layout=document.createElement('div');layout.className='recipe-workspace-layout';
 const main=document.createElement('div');main.className='recipe-workspace-body';
 const nav=document.createElement('nav');nav.className='recipe-editor-sections';nav.setAttribute('aria-label','Recipe editor sections');
 const sections=[['ingredients','Ingredients & method'],['yield','Yield & pricing'],['details','Details & notes']];
 const panels=new Map(sections.map(([key])=>{const panel=document.createElement('div');panel.dataset.editorPanel=key;panel.id='recipe-panel-'+key;return[key,panel];}));
 nav.innerHTML=sections.map(([key,label])=>`<button type="button" data-editor-section="${key}" aria-controls="recipe-panel-${key}">${label}</button>`).join('');
 for(const child of children){
  if(child===footer||child.matches('.recipe-editor-outline'))continue;
  const title=child.querySelector('h2,h3')?.textContent||'';
  const key=child.matches('.recipe-costing-editor')||/^(Size variants|Raw weight)/.test(title)?'yield':title==='Recipe details'||title==='Review imported recipe'?'details':'ingredients';
  panels.get(key).append(child);
 }
 const ingredients=panels.get('ingredients'),packaging=ingredients.querySelector('.recipe-packaging-editor');if(packaging)ingredients.append(packaging);
 const aside=document.createElement('aside');aside.className='recipe-card recipe-live-cost';aside.setAttribute('aria-label','Live recipe cost');aside.innerHTML='<h2>Cost at a glance</h2><div data-live-cost role="status">Calculating current costs…</div><button type="button" data-action="cost-preview">Full cost details</button>';
 const name=panels.get('details').querySelector('[data-path="name"]')?.closest('label');if(name){name.classList.add('recipe-editor-name');main.append(name);}
 main.append(nav,...panels.values());layout.append(main,aside);form.prepend(layout);costToggle(aside);
 function select(key){state.editorSection=panels.has(key)?key:'ingredients';for(const [id,panel]of panels)panel.hidden=id!==state.editorSection;for(const b of nav.children)b.setAttribute('aria-pressed',String(b.dataset.editorSection===state.editorSection));}
 nav.addEventListener('click',event=>{const button=event.target.closest('[data-editor-section]');if(button)select(button.dataset.editorSection);});select(state.editorSection);
 let timer,ticket=0;
 async function refresh(){
  const request=++ticket,host=aside.querySelector('[data-live-cost]'),variantId=state.doc.variants[state.variant].id;
  try{const data=await api('cost_preview',{document:structuredClone(state.doc),source:'current',factor:'1'});if(request===ticket&&host.isConnected)host.innerHTML=currentCostMarkup(data.snapshot,data.snapshot.variants.find(v=>v.variant_id===variantId));}
  catch(error){if(request===ticket&&host.isConnected)host.innerHTML=`<p class="recipe-muted">Complete the recipe fields to calculate its current cost.</p><p class="recipe-error">${esc(error.message)}</p>`;}
 }
 const schedule=()=>{clearTimeout(timer);++ticket;timer=setTimeout(()=>{if(form.isConnected&&state.editing)refresh().catch(onError);},350);};
 form.addEventListener('input',schedule);form.addEventListener('change',schedule);refresh().catch(onError);
}

export function arrangeReader(root){
 const cost=root.querySelector('[data-saved-cost-card]')?.closest('section');if(!cost)return;
 const layout=document.createElement('div');layout.className='recipe-workspace-layout';
 const body=document.createElement('div');body.className='recipe-workspace-body';
 const start=root.querySelector('.recipe-reader-reference');if(!start)return;
 const nodes=[];for(let node=start;node;node=node.nextElementSibling)nodes.push(node);
 start.before(layout);for(const node of nodes)if(node!==cost)body.append(node);
 const packaging=body.querySelector('[data-kitchen-panel="packaging"]');if(packaging)body.append(packaging);
 cost.classList.add('recipe-live-cost');layout.append(body,cost);costToggle(cost);
}

export function arrangeCosting(root){
 const filters=root.querySelector('.recipe-cost-overview .recipe-filters');if(!filters||filters.dataset.refined)return;
 filters.dataset.refined='true';const extra=document.createElement('details');extra.className='recipe-extra-filters';extra.innerHTML='<summary>More filters</summary><div class="recipe-fields"></div>';
 for(const label of [...filters.children]){const input=label.querySelector('[data-cost-filter]');if(!input||['query','mode'].includes(input.dataset.costFilter))continue;extra.querySelector('div').append(label);if(input.value)extra.open=true;}
 filters.append(extra);
}

export function allowanceMarkup(setting,owner){
 return `<section class="recipe-card recipe-shared-allowance"><div><h2>Labor & utilities</h2><p class="recipe-muted">One allowance for current costs across every recipe and size. Saved historical snapshots stay unchanged.</p></div>${owner?`<form data-shared-allowance><label>Shared allowance · %<input name="percent" type="number" min="0" max="10000" step="any" required value="${esc(setting?.configured?setting.percent:'')}" placeholder="Choose a percentage"></label><button type="submit" class="primary">Apply to all recipes</button><p role="status" data-allowance-status></p></form>`:`<strong>${setting?.configured?esc(setting.percent)+'%':'Not configured'}</strong>`}${!setting?.configured?'<p class="recipe-muted">Existing recipes keep their saved allowances until the owner sets a shared value.</p>':''}</section>`;
}

export async function fillLibraryCosts(root,rows,api){
 const hosts=[...root.querySelectorAll('[data-library-cost]')];if(!hosts.length)return;
 try{const result=await api('library_costs',{recipes:rows.filter(r=>!r.deleted_at).map(r=>({id:r.id,version_id:r.version_id}))});
  for(const host of hosts){if(!host.isConnected)continue;const recipe=result.rows.find(r=>r.id===host.dataset.libraryCost),s=recipe?.variants[0];if(!s){host.textContent='Historical recipe';continue;}host.innerHTML=`<strong>${s.complete?esc(costMoney(s.adjusted_cost,recipe.currency)):'Cost incomplete'}</strong><span> / batch</span><small>${esc(s.yield?.quantity||'—')} ${esc(s.yield?.unit||'')} · ${esc(s.variant_name)}${recipe.variants.length>1?` · +${recipe.variants.length-1} size${recipe.variants.length>2?'s':''}`:''}</small>${s.margin==null?'':`<small>Estimated margin ${Number(s.margin).toFixed(1)}%</small>`}${s.below_cost?'<small class="recipe-error">Selling price below cost</small>':''}${s.complete?'':'<small>Missing price or conversion</small>'}`;}
 }catch(error){for(const host of hosts)if(host.isConnected)host.textContent='Cost unavailable. Open recipe to retry.';}
}
