// Keep daily work easy to reach and collapse the grouped menu on small screens.
export function bindDashboardNav() {
  const nav = document.querySelector('#admin-nav');
  const toggle = document.querySelector('#admin-nav-toggle');
  const current = document.querySelector('#admin-nav-current');
  const mobile = matchMedia('(max-width:760px)');
  function close() {
    toggle.setAttribute('aria-expanded', 'false');
    nav.classList.remove('is-open');
  }
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  });
  nav.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobile.matches) {
      close();
      toggle.focus();
    }
  });
  mobile.addEventListener('change', close);
  return function syncNavigation() {
    const selected = nav.querySelector('.sidebar-link.active');
    current.textContent = selected?.dataset.label || 'Dashboard';
    nav.querySelectorAll('.sidebar-group').forEach(group => {
      group.hidden = [...group.querySelectorAll('.sidebar-link')].every(button => button.style.display === 'none');
    });
    // Do not leave keyboard focus inside a menu that has just been collapsed.
    const restoreFocus = mobile.matches && nav.contains(document.activeElement);
    close();
    if (restoreFocus) toggle.focus({preventScroll:true});
  };
}
