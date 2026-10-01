const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountTestWorkspace(root,workspace,{button}){
 const form=root.querySelector('#recipe-editor'),footer=form.querySelector('.recipe-sticky-save'),data=workspace.data;
 const tabs=document.createElement('div');tabs.className='recipe-test-tabs recipe-segmented';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Test workspace view');
 tabs.innerHTML='<button type="button" data-test-pane="formula">Test formula</button><button type="button" data-test-pane="notes">Observations</button>';
 const layout=document.createElement('div');layout.className='recipe-test-workspace';
 const notes=document.createElement('aside');notes.className='recipe-test-notes recipe-card';notes.setAttribute('aria-label','Test observations');
 notes.innerHTML=`<h2>Test observations</h2><p class="recipe-muted">Source version ${esc(workspace.source.version)} · ${workspace.record?`Test #${workspace.record.number}`:'New test'}. Save the formula and notes together. Promotion is a separate owner action.</p><div class="recipe-fields two"><label>Test date<input data-test-field="date" type="date" value="${esc(data.date)}" required></label><label>Rating · 0 to 5<input data-test-field="rating" type="number" min="0" max="5" step="0.5" value="${esc(data.rating??'')}"></label></div>${[['Changes made','changes'],['Bake settings','bake_settings'],['Ingredient changes','ingredient_changes'],['Observations','observations'],['Result','result'],['Next test','next_test']].map(([label,key])=>`<label>${label}<textarea data-test-field="${key}" rows="3">${esc(data[key])}</textarea></label>`).join('')}<div class="recipe-photos" data-test-photos></div>${button('+ Test photo','test-photo')}<p class="recipe-muted">Test photos are private.</p>`;
 form.before(tabs,layout);layout.append(form,notes);layout.after(footer);
 function show(pane){workspace.pane=pane;layout.dataset.testPane=pane;tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.testPane===pane)));}
 tabs.addEventListener('click',event=>{const b=event.target.closest('[data-test-pane]');if(b)show(b.dataset.testPane);});show(workspace.pane||'formula');
 return notes;
}
