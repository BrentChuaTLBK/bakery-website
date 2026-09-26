import {config} from './config.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Photos are decorative catalog information. Saved names, choices, quantities
// and prices continue to come exclusively from the private order snapshot.
export function orderProductPhoto(item,products,{siteUrl=location.href,storageUrl=config.supabaseUrl}={}){
 const product=products.find(product=>product.id===item.product_id);
 if(!Array.isArray(product?.photos))return '';
 for(const value of product.photos){
  if(typeof value!=='string'||!value.trim())continue;
  try{
   const site=new URL(siteUrl),photo=new URL(value,site);
   if(photo.username||photo.password||photo.search||photo.hash)continue;
   if(photo.origin===site.origin&&photo.pathname.startsWith('/assets/')&&/\.(webp|png|jpe?g|avif|gif)$/i.test(photo.pathname))return photo.href;
   const storage=new URL(storageUrl);
   if(photo.protocol==='https:'&&photo.origin===storage.origin&&photo.pathname.startsWith('/storage/v1/object/public/product-images/'))return photo.href;
  }catch{/* An invalid or private URL should never break access to the order. */}
 }
 return '';
}

export function renderOrderItemPhoto(item,products){
 const photo=orderProductPhoto(item,products);
 return `<span class="order-item-photo"><span class="order-item-photo-fallback" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg><small>Photo unavailable</small></span>${photo?`<img data-order-item-photo src="${escape(photo)}" alt="${escape(item.name)}" width="80" height="80" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}

export function bindOrderItemPhotos(root){
 for(const img of root.querySelectorAll('[data-order-item-photo]')){
  const unavailable=()=>img.remove();
  img.addEventListener('error',unavailable,{once:true});
  if(img.complete&&!img.naturalWidth)unavailable();
 }
}
