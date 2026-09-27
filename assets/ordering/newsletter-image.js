import {prepareGalleryImage} from './gallery-image.js?v=newsletter-photos-1';

export const newsletterImageAccept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

export async function uploadNewsletterImage(file, onProgress = () => {}) {
  onProgress('Preparing photo…');
  // JPEG keeps uploaded photos compatible with email clients. The shared
  // converter also resizes large originals and decodes iPhone HEIC photos.
  const prepared = await prepareGalleryImage(file, {format: 'jpeg'});
  onProgress('Uploading photo…');
  const {upload} = await import('./client.js?v=academy-1');
  // This existing public-image endpoint verifies the signed-in owner before
  // storing a new immutable file. No catalogue product is created or changed.
  const result = await upload(prepared.file, {kind: 'product'});
  let url;
  try { url = new URL(result?.url); } catch { /* Report an incomplete upload. */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('The upload did not return a usable photo. Please try again.');
  }
  return url.href;
}
