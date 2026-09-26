export const galleryImageAccept = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/heic,image/heif,.heic,.heif';

async function decode(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

export async function prepareGalleryImage(file) {
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
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob || blob.type !== 'image/webp') throw new Error('Your browser cannot create WebP images. Try a current Chrome, Edge, or Firefox browser.');
    if (blob.size > 5 * 1024 * 1024) throw new Error('The converted image is still too large. Choose a smaller image.');
    const converted = new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.webp`, { type: 'image/webp' });
    return { file: converted, width: canvas.width, height: canvas.height, originalSize: file.size };
  } finally {
    image.close?.();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}
