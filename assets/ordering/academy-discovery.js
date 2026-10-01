export function classSearchMarkup(classes){
 return classes.length>4?'<div class="ap-search-tools"><label>Find a class<input type="search" data-class-search placeholder="Search your class names" autocomplete="off"></label><button type="button" class="ap-button secondary" data-class-clear>Clear search</button></div><p class="ap-small" data-class-search-status role="status"></p>':'';
}
export function bindClassSearch(root){
 const input=root.querySelector('[data-class-search]');if(!input)return;
 const cards=[...root.querySelectorAll('.ap-class-card')],status=root.querySelector('[data-class-search-status]');
 const filter=()=>{const query=input.value.trim().toLocaleLowerCase();let count=0;for(const card of cards){card.hidden=!card.querySelector('h3').textContent.toLocaleLowerCase().includes(query);if(!card.hidden)count++;}status.textContent=query?`${count} matching ${count===1?'class':'classes'}${count?'':'. Try another class name.'}`:`${cards.length} classes`;};
 input.addEventListener('input',filter);root.querySelector('[data-class-clear]').onclick=()=>{input.value='';filter();input.focus();};filter();
}
export function enhanceClassDiscovery(root,c,{esc,link}){
 const header=root.querySelector('.ap-class-header'),materials=root.querySelector('.ap-learning-materials');
 header.insertAdjacentHTML('beforeend',`<div class="ap-actions ap-class-quick-actions">${link(`Ask ${c.instructor||'instructor'}`,`#ask/${c.id}`,true)}${c.sharing_enabled?link('Share what you made',`#share/${c.id}`):''}</div>`);
 if(c.modules.length<3&&c.recipes.length<6)return;
 const modules=[...materials.querySelectorAll('.ap-module')];modules.forEach((node,i)=>{node.id='ap-module-'+c.modules[i].id;node.tabIndex=-1;});
 materials.insertAdjacentHTML('afterbegin',`<div class="ap-search-tools"><label>Find a recipe in this class<input type="search" data-recipe-search placeholder="Search recipe names" autocomplete="off"></label><button type="button" class="ap-button secondary" data-recipe-clear>Show all recipes</button></div><p class="ap-small" data-recipe-search-status role="status"></p>${c.modules.length?`<nav class="ap-module-jumps" aria-label="Jump to a module">${c.modules.map((m,i)=>`<button type="button" class="ap-button secondary small" data-module-jump="${esc(m.id)}">${i+1}. ${esc(m.name)}</button>`).join('')}</nav>`:''}`);
 const input=materials.querySelector('[data-recipe-search]'),status=materials.querySelector('[data-recipe-search-status]'),recipes=[...materials.querySelectorAll('.ap-recipe-link')];
 const filter=()=>{const query=input.value.trim().toLocaleLowerCase();let count=0;for(const node of recipes){node.hidden=!node.firstElementChild.textContent.toLocaleLowerCase().includes(query);if(!node.hidden)count++;}for(const node of modules)node.hidden=Boolean(query)&&!node.querySelector('.ap-recipe-link:not([hidden])');status.textContent=query?`${count} matching ${count===1?'recipe':'recipes'}${count?' in their modules.':'. Try another recipe name.'}`:`${recipes.length} recipes in this class`;};
 const reset=()=>{input.value='';filter();};input.oninput=filter;materials.querySelector('[data-recipe-clear]').onclick=()=>{reset();input.focus();};
 materials.querySelectorAll('[data-module-jump]').forEach(b=>b.onclick=()=>{reset();const target=root.querySelector('#ap-module-'+b.dataset.moduleJump);target.scrollIntoView({block:'start'});target.focus({preventScroll:true});});filter();
}
