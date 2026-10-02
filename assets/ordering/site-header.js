const header=document.querySelector('[data-site-header]');
if(header){
 const toggle=header.querySelector('.tlb-site-menu-toggle'),menu=header.querySelector('.tlb-site-menu'),specialties=header.querySelector('details');
 const mobile=matchMedia('(max-width: 991.98px)');
 const closeMenu=()=>{menu.classList.remove('is-open');toggle.setAttribute('aria-expanded','false');specialties.open=false;};
 header.dataset.ready='';
 toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';menu.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open));if(!open)specialties.open=false;});
 header.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(specialties.open){specialties.open=false;specialties.querySelector('summary').focus();}else if(menu.classList.contains('is-open')){closeMenu();toggle.focus();}});
 document.addEventListener('click',event=>{if(!header.contains(event.target))closeMenu();else if(!specialties.contains(event.target))specialties.open=false;});
 header.addEventListener('focusout',event=>{if(event.relatedTarget&&!header.contains(event.relatedTarget))closeMenu();});
 mobile.addEventListener('change',closeMenu);
 const current=location.pathname.replace(/\/$/,'/index.html');
 for(const link of header.querySelectorAll('a')){
  if(new URL(link.href).pathname===current&&!link.hash&&!link.classList.contains('tlb-site-brand'))link.setAttribute('aria-current','page');
 }
 if(/\/academy(?:-class)?\.html$|\/academy\//.test(current))header.querySelector('[data-site-page=academy]').setAttribute('aria-current','page');
 // Preserve return-to-shop behavior without retaining account callback tokens.
 if(/\/shop\.html$/.test(current))header.querySelector('[aria-label="My account"]').href=header.querySelector('[aria-label="My account"]').getAttribute('href')+'?next=shop.html';
 const updateHeight=()=>document.documentElement.style.setProperty('--tlb-site-header-height',header.getBoundingClientRect().height+'px');
 new ResizeObserver(updateHeight).observe(header);updateHeight();
}
