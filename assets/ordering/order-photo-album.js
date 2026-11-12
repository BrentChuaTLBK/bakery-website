import { requestOrderPhotos, orderPhotoUrl } from './order-photo-client.js?v=order-workflow-20261113';
import './heic-preview.js?v=approved-20261002-1';

const status = document.querySelector('#photo-album-status');
const gallery = document.querySelector('#photo-album');
const token = new URLSearchParams(location.hash.slice(1)).get('photos') || '';

try {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('Use the photo link from Google Calendar.');
  const { photos } = await requestOrderPhotos({ action: 'shared', token });
  photos.forEach((photo, index) => {
    const card = document.createElement('div');
    card.className = 'order-photo-card';
    const url = orderPhotoUrl(photo.url);
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const img = document.createElement('img');
      img.alt = `Order photo ${index + 1}`;
      img.referrerPolicy = 'no-referrer';
      img.src = url;
      link.append(img);
      card.append(link);
    } else card.textContent = 'This photo could not be loaded. Reload to try again.';
    gallery.append(card);
  });
  status.hidden = true;
} catch (error) {
  status.textContent = error.message;
}
