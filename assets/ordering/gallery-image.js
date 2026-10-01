import {inspectImage} from './image-format.js?v=approved-20261002-1';
import './heic-preview.js?v=approved-20261002-1';
export const preparedImageFiles = new WeakSet();
export const galleryImageAccept = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/heic,image/heif,.heic,.heif';

async function decode(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

async function convertGalleryImage(file, { format = 'webp' } = {}) {
  if (!['webp', 'jpeg'].includes(format)) throw new Error('Choose a supported image format.');
  if (!file?.size) throw new Error('Choose an image.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image up to 25 MB.');
  if (!/\.(jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i.test(file.name) && !/^image\/(jpeg|png|webp|avif|gif|bmp|heic|heif)$/.test(file.type)) {
    throw new Error('Choose a JPG, PNG, WebP, AVIF, GIF, BMP, or HEIC photo.');
  }
  let image;
  try { image = await decode(file); }
  catch {
    if (!/hei[cf]/i.test(file.type + file.name)) throw new Error('This image could not be opened. Try another image file.');
    try {
      // Load the pinned, same-origin decoder only when native HEIC is unavailable.
      // Its current libheif supports iPhone HDR/gain-map auxiliary images.
      const { heicTo } = await import('./vendor/heic-to-1.5.2/heic-to.js');
      image = await heicTo({ blob: file, type: 'bitmap' });
    } catch { throw new Error('This HEIC photo could not be converted. Try the original photo again, or choose a JPG or PNG copy.'); }
  }
  let canvas;
  try {
    const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
    if (!width || !height || width * height > 60_000_000) throw new Error('Choose an image under 60 megapixels.');
    const scale = Math.min(1, 1600 / Math.max(width, height));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion is unavailable. Try a current Chrome, Edge, or Firefox browser.');
    if (format === 'jpeg') {
      context.fillStyle = '#fffaf0';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mime = `image/${format}`, extension = format === 'jpeg' ? 'jpg' : 'webp';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, format === 'jpeg' ? 0.86 : 0.82));
    if (!blob || blob.type !== mime) throw new Error(`Your browser cannot create ${format === 'jpeg' ? 'JPEG' : 'WebP'} images. Try a current Chrome, Edge, or Firefox browser.`);
    if (blob.size > 5 * 1024 * 1024) throw new Error('The converted image is still too large. Choose a smaller image.');
    const converted = new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.${extension}`, { type: mime });
    return { file: converted, width: canvas.width, height: canvas.height, originalSize: file.size, converted: true };
  } finally {
    image.close?.();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

export async function prepareGalleryImage(file, options = {}) {
  if (!file?.size) throw Error('Choose an image.');
  if (file.size > 25 * 1024 * 1024) throw Error('Choose an image up to 25 MB.');
  let timeout;
  try {
    const result = await Promise.race([convertGalleryImage(file, options), new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Image conversion took too long.')),20000);})]);
    preparedImageFiles.add(result.file); return result;
  }
  catch (conversionError) {
    // Preserve a valid original when its encoder/decoder is unavailable. Never
    // relabel PNG bytes as WebP or accept a renamed non-image.
    let original;
    try { original = inspectImage(new Uint8Array(await file.arrayBuffer())); }
    catch { throw conversionError; }
    const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase();
    const correctExtension = extension === original.extension || (original.mime === 'image/jpeg' && extension === 'jpeg') || (original.mime === 'image/heic' && extension === 'heif');
    const name = correctExtension ? file.name : `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.${original.extension}`;
    const preserved = file.type === original.mime && file.name === name ? file : new File([file], name, {type: original.mime, lastModified: file.lastModified});
    preparedImageFiles.add(preserved);
    return {file: preserved, width: original.width, height: original.height, originalSize: file.size, converted: false};
  } finally { clearTimeout(timeout); }
}
