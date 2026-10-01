// Enhance the same complete recipe markup used by the reader. Printing uses
// its own document and is never limited to the selected kitchen section.
export function mountKitchenReader(root,state){
 const panels=[...root.querySelectorAll('[data-kitchen-panel]')];
 if(!panels.length)return;
 for(const panel of panels){
  const table=panel.querySelector(':scope>.recipe-table-wrap'),methods=[...panel.querySelectorAll(':scope>.recipe-procedure-view')];
  if(table&&methods.length){
   const grid=document.createElement('div');grid.className='recipe-kitchen-columns';
   const procedure=document.createElement('div');procedure.className='recipe-kitchen-methods';procedure.append(...methods);
   table.classList.add('recipe-kitchen-ingredients');grid.append(table,procedure);panel.append(grid);
  }
 }
 const nav=document.createElement('div');nav.className='recipe-kitchen-nav';
 nav.innerHTML='<div class="recipe-kitchen-selector"><button type="button" data-kitchen-prev aria-label="Previous section">←</button><label>Recipe section<select data-kitchen-section></select></label><button type="button" data-kitchen-next aria-label="Next section">→</button></div><div class="recipe-kitchen-pane" aria-label="Component view"><button type="button" data-kitchen-pane="ingredients">Ingredients</button><button type="button" data-kitchen-pane="method">Method</button></div>';
 const select=nav.querySelector('select');
 panels.forEach((panel,index)=>{const option=document.createElement('option');option.value=panel.dataset.kitchenPanel;option.textContent=`${index+1}. ${panel.querySelector('h2')?.textContent||'Reference'}`;select.append(option);});
 const names=document.createElement('div');names.className='recipe-kitchen-sections';names.setAttribute('role','group');names.setAttribute('aria-label','Jump to recipe section');
 panels.forEach((panel,index)=>{const b=document.createElement('button');b.type='button';b.dataset.kitchenJump=String(index);b.textContent=panel.querySelector('h2')?.textContent||'Reference';names.append(b);});nav.prepend(names);
 panels[0].before(nav);
 let active=Math.max(0,panels.findIndex(p=>p.dataset.kitchenPanel===state.kitchenSection));
 function show({focus=false}={}){
  panels.forEach((p,i)=>{p.hidden=i!==active;p.dataset.kitchenPane=state.kitchenPane||'ingredients';});
  state.kitchenSection=panels[active].dataset.kitchenPanel;select.value=state.kitchenSection;
  names.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===active)));
  nav.querySelector('[data-kitchen-prev]').disabled=active===0;nav.querySelector('[data-kitchen-next]').disabled=active===panels.length-1;
  nav.querySelector('.recipe-kitchen-pane').hidden=!panels[active].querySelector('.recipe-kitchen-columns');
  nav.querySelectorAll('[data-kitchen-pane]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kitchenPane===(state.kitchenPane||'ingredients'))));
  if(focus){const title=panels[active].querySelector('h2');title.tabIndex=-1;title.focus({preventScroll:true});nav.scrollIntoView({block:'start'});}
 }
 select.addEventListener('change',()=>{active=panels.findIndex(p=>p.dataset.kitchenPanel===select.value);state.kitchenPane='ingredients';show();});
 nav.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||b.disabled)return;if(b.hasAttribute('data-kitchen-jump')){active=Number(b.dataset.kitchenJump);state.kitchenPane='ingredients';show();}else if(b.hasAttribute('data-kitchen-prev')){active--;state.kitchenPane='ingredients';show({focus:true});}else if(b.hasAttribute('data-kitchen-next')){active++;state.kitchenPane='ingredients';show({focus:true});}else{state.kitchenPane=b.dataset.kitchenPane;show();}});
 show();
}
