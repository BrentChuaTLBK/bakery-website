// Shared public/preview markup. Text is escaped and links are limited to local pages.
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const validPage = value => /^[A-Za-z0-9_-]+\.html([?#][A-Za-z0-9_~.%=&/?#:+,-]*)?$/.test(value) && value.length <= 300;
const link = value => validPage(value) ? value : 'index.html';
const banner900 = new Set(['HomePage1', 'Home_Page_2', 'Home_Page_3', 'HomePage4'].map(name => `assets/img/products-webp/${name}-1600w.webp`));
export function photoAttributes(photo, hero = false) {
  const url = String(photo.photo_url || '');
  if (!/^assets\/img\/(products-webp\/([A-Za-z0-9_-]|%20)+|baking-classes)\.webp$/.test(url)
    && !/^https:\/\/aulhqofjjckwwjmdvqgi\.supabase\.co\/storage\/v1\/object\/public\/product-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/.test(url)) return '';
  const responsive = url.endsWith('-1600w.webp') && url.startsWith('assets/img/products-webp/');
  // The tall mobile banner crops a landscape image; its source must cover the height too.
  const sizes = hero ? '(max-width:900px) 900px, 100vw' : '(min-width:1400px) 306px, (min-width:1200px) 261px, (min-width:992px) 456px, (min-width:768px) 336px, (min-width:576px) 246px, calc(100vw - 24px)';
  const intermediate = hero && banner900.has(url) ? `${esc(url.replace('-1600w','-900w'))} 900w, ` : '';
  return `src="${esc(url)}" ${responsive ? `srcset="${esc(url.replace('-1600w','-400w'))} 400w, ${esc(url.replace('-1600w','-800w'))} 800w, ${intermediate}${esc(url)} 1600w" sizes="${sizes}"` : ''} alt="${esc(photo.alt)}" decoding="async"`;
}
function controls(id, count) {
  if (count < 2) return '';
  return `<button class="carousel-control-prev" type="button" data-bs-target="#${id}" data-bs-slide="prev"><span class="carousel-control-prev-icon" aria-hidden="true"></span><span class="visually-hidden">Previous photo</span></button><button class="carousel-control-next" type="button" data-bs-target="#${id}" data-bs-slide="next"><span class="carousel-control-next-icon" aria-hidden="true"></span><span class="visually-hidden">Next photo</span></button><div class="carousel-indicators">${Array.from({length:count},(_,i)=>`<button type="button" data-bs-target="#${id}" data-bs-slide-to="${i}" ${i===0?'class="active" aria-current="true"':''} aria-label="Photo ${i+1}"></button>`).join('')}</div>`;
}
export function heroMarkup(photos) {
  return `<div class="carousel-inner h-100">${photos.map((p,i)=>`<div class="carousel-item h-100 ${i===0?'active':''}"><img class="home-banner-photo" ${photoAttributes(p,true)} ${i===0?'fetchpriority="high"':'loading="lazy"'}><div class="container d-flex align-items-center justify-content-end h-100"><div class="home-banner-copy"><h1>${esc(p.title)}</h1><p>${esc(p.description)}</p><div class="home-banner-buttons">${p.buttons.map(b=>`<a class="btn btn-primary" href="${esc(link(b.href))}">${esc(b.label)}</a>`).join('')}</div></div></div></div>`).join('')}</div>${controls('carousel-1',photos.length)}`;
}
export function specialtyMarkup(cards) {
  return cards.map((s,i)=>{const id=`home-specialty-${i}`;return `<div class="col"><div class="carousel slide carousel-fade" id="${id}" data-bs-interval="false"><div class="carousel-inner">${s.photos.map((p,n)=>`<div class="carousel-item ${n===0?'active':''}"><a class="specialty-photo-link" href="${esc(link(s.href))}"><img class="rounded" ${photoAttributes(p)} loading="lazy" width="1200" height="1600"></a></div>`).join('')}</div>${controls(id,s.photos.length)}</div><div class="text-center py-4"><a class="btn btn-outline-secondary btn-lg" href="${esc(link(s.href))}">${esc(s.title)}</a></div></div>`;}).join('');
}
