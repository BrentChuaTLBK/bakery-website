import {galleryThumbnails} from './gallery-thumbnail-map.js?v=gallery-thumbnails-1';
import {safePhotoUrl} from './gallery-import.js';

// Keep older saved URLs working while the matching data migration rolls out.
const webpOriginals = Object.fromEntries(['IMG_4116','IMG_4140','IMG_8639'].map(name =>
  [`/assets/pastries/CookieBottle/${name}.jpeg`, `/assets/pastries/CookieBottle/${name}.webp`]));

export function galleryPhoto(value) {
  const original = safePhotoUrl(value);
  if (!original) return '';
  try {
    const url = new URL(original);
    if (url.hostname === 'thelittlebakerkitchen.com' && !url.search && !url.hash) {
      const replacement = webpOriginals[decodeURIComponent(url.pathname)];
      if (replacement) return url.origin + replacement;
    }
  } catch { /* Preserve a validated URL with an unfamiliar path. */ }
  return original;
}

export function galleryThumbnail(value) {
  const original = galleryPhoto(value);
  if (!original) return '';
  try {
    const url = new URL(original);
    if (url.hostname === 'thelittlebakerkitchen.com' && !url.search && !url.hash) {
      return galleryThumbnails[decodeURIComponent(url.pathname)] || original;
    }
  } catch { /* An unfamiliar path retains its validated original URL. */ }
  return original;
}

export function bindThumbnailFallback(root) {
  root.addEventListener('error', event => {
    const img = event.target;
    if (img?.tagName !== 'IMG' || !img.dataset.fullPhoto) return;
    const original = safePhotoUrl(img.dataset.fullPhoto);
    delete img.dataset.fullPhoto;
    if (original && img.src !== original) {
      // Let the original load before another gallery error handler replaces
      // the image with an unavailable placeholder.
      event.stopImmediatePropagation();
      img.src = original;
    }
  }, true);
}
