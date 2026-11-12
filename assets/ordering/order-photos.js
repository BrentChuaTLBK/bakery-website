import { prepareGalleryImage, galleryImageAccept } from './gallery-image.js?v=mobile-product-photos-20261022-1';
import { requestOrderPhotos, orderPhotoUrl } from './order-photo-client.js?v=order-workflow-20261113';

export function orderPhotosMarkup() {
  return `<section class="detail-section order-photos" data-order-photos tabindex="-1">
    <h3>Order photos</h3>
    <div class="order-photo-grid" data-photo-list></div>
    <label class="field">Attach photos
      <input type="file" data-attach-photos accept="${galleryImageAccept}" multiple disabled>
    </label>
    <p class="help-text">Up to 8 photos, 25 MB each. Anyone with the Google Calendar photo link can view them.</p>
    <p class="help-text" data-photo-status role="status">Loading photos…</p>
  </section>`;
}

export function mountOrderPhotos(root, orderId, { esc, confirm }) {
  const list = root.querySelector('[data-photo-list]');
  const input = root.querySelector('[data-attach-photos]');
  const status = root.querySelector('[data-photo-status]');
  let photos = [], busy = true, loaded = false;
  const request = payload => requestOrderPhotos(payload, { staff: true });
  function message(text, error = false) {
    status.className = error ? 'notice danger' : 'help-text';
    status.textContent = text;
  }
  function controls() {
    input.disabled = busy || !loaded || photos.length >= 8;
    for (const button of list.querySelectorAll('button')) button.disabled = busy;
  }
  async function refresh() {
    const result = await request({ action: 'list', order_id: orderId });
    photos = result.photos;
    loaded = true;
    list.innerHTML = photos.map(photo => {
      const url = orderPhotoUrl(photo.url), filename = esc(photo.filename || 'Order photo');
      return `<article class="order-photo-card">
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${filename}" referrerpolicy="no-referrer"></a>` : '<p>Preview unavailable</p>'}
        <button type="button" class="button button-secondary" data-remove-order-photo="${esc(photo.id)}" aria-label="Remove ${filename}">Remove</button>
      </article>`;
    }).join('');
  }
  async function run(work) {
    busy = true;
    controls();
    try { await work(); }
    catch (error) { message(error.message, true); }
    finally { busy = false; controls(); }
  }
  void run(async () => {
    await refresh();
    message(photos.length ? '' : 'No photos attached yet.');
  });

  input.addEventListener('change', async () => {
    const files = Array.from(input.files);
    input.value = '';
    if (busy || !files.length) return;
    if (photos.length + files.length > 8) {
      message(`Choose up to ${8 - photos.length} more photos.`, true);
      return;
    }
    await run(async () => {
      let uploaded = 0;
      try {
        for (const file of files) {
          message(`Uploading photo ${uploaded + 1} of ${files.length}…`);
          const prepared = await prepareGalleryImage(file, { fallbackFormat: 'png' });
          const body = new FormData();
          body.set('order_id', orderId);
          body.set('file', prepared.file);
          await request(body);
          uploaded++;
        }
      } finally {
        await refresh();
      }
      message(uploaded === 1 ? 'Photo attached.' : `${uploaded} photos attached.`);
    });
  });

  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-remove-order-photo]');
    if (!button || busy) return;
    await run(async () => {
      if (!await confirm('This photo will be removed from the order and its calendar link.', {
        title: 'Remove photo?', confirmLabel: 'Remove photo', cancelLabel: 'Keep photo',
      })) return;
      await request({ action: 'remove', order_id: orderId, photo_id: button.dataset.removeOrderPhoto });
      await refresh();
      message('Photo removed.');
    });
  });
}
