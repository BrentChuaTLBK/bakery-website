import {esc,photoAttributes} from './homepage-view.js?v=banner-900-1';

export const defaultShopFeature = Object.freeze({
  photo_url:'assets/img/products-webp/Pastries_4-800w.webp',
  alt:'Pastries from TLB Kitchen',
  caption:'Baked with a little love.',
});

export function shopFeatureMarkup(value) {
  const feature={...defaultShopFeature,...value};
  const attributes=photoAttributes(feature)||photoAttributes(defaultShopFeature);
  const caption=typeof feature.caption==='string'?feature.caption:defaultShopFeature.caption;
  return `<img ${attributes}>${caption.trim()?`<span class="hero-stamp">${esc(caption)}</span>`:''}`;
}
