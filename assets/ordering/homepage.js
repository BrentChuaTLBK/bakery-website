import { config } from './config.js';
import { heroMarkup, specialtyMarkup } from './homepage-view.js?v=synced-photos-1';
import { startSynchronizedCarousels } from './homepage-carousels.js?v=synced-photos-1';

const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
const settings = fetch(`${config.supabaseUrl}/rest/v1/rpc/homepage_api`, {
  method: 'POST', signal: AbortSignal.timeout(8000),
  headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_action: 'browse' }),
}).then(r => r.ok ? r.json() : null).catch(() => null);

function startCarousels() {
  const Carousel = window.bootstrap?.Carousel;
  if (!Carousel) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('#carousel-1').forEach(el => {
    const count = el.querySelectorAll('.carousel-item').length;
    const warmNext = () => {
      const slides = [...el.querySelectorAll('.carousel-item')], active = slides.findIndex(s => s.classList.contains('active'));
      [slides[active], slides[(active + 1) % slides.length]].forEach(slide => { const img=slide?.querySelector('img'); if(img)img.loading='eager'; });
    };
    warmNext(); el.addEventListener('slid.bs.carousel',warmNext);
    const instance = Carousel.getOrCreateInstance(el, { interval: 4000, pause: 'hover', touch: true });
    if (reduced || count < 2) instance.pause(); else instance.cycle();
    if (count < 2) return;
    el.addEventListener('slid.bs.carousel', () => { if(reduced) instance.pause(); });
    el.addEventListener('mouseleave', () => { if(reduced) instance.pause(); });
    el.addEventListener('focusin', () => instance.pause());
    el.addEventListener('focusout', e => { if(!reduced && !el.contains(e.relatedTarget)) instance.cycle(); });
  });
  startSynchronizedCarousels(document.querySelector('.specialty-grid'), Carousel);
}

try {
  const [result] = await Promise.all([settings,loaded]);
  // Keep the original HTML for the untouched default and during backend outages.
  if (result?.revision > 1 && result.content?.hero?.length && result.content?.specialties?.length === 4) {
    const hero = document.querySelector('#carousel-1'), grid = document.querySelector('.specialty-grid');
    const heroHTML = heroMarkup(result.content.hero), gridHTML = specialtyMarkup(result.content.specialties);
    const old = [...document.querySelectorAll('#carousel-1,.home-specialties .carousel')];
    await Promise.all(old.map(async el => {
      const instance = window.bootstrap?.Carousel.getInstance(el); instance?.pause();
      if (el.querySelector('.carousel-item-next,.carousel-item-prev')) await new Promise(resolve => { el.addEventListener('slid.bs.carousel',resolve,{once:true}); setTimeout(resolve,1000); });
      instance?.dispose();
    }));
    hero.innerHTML = heroHTML; hero.classList.add('home-managed-banner'); grid.innerHTML = gridHTML;
    document.documentElement.dataset.homepageRevision = result.revision;
  }
} catch { /* The existing homepage remains usable if configuration is unavailable. */ }
startCarousels();
