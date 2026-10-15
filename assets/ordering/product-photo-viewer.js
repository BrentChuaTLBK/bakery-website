let viewer;
let active;

function photoURL(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim(), document.baseURI);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function button(label, attribute, symbol) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'product-photo-viewer-button';
  element.setAttribute('aria-label', label);
  element.setAttribute(attribute, '');
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = symbol;
  element.append(icon);
  return element;
}

function rememberScroll(element) {
  const positions = [];
  for (let current = element; current instanceof HTMLElement; current = current.parentElement) {
    positions.push([current, current.scrollLeft, current.scrollTop]);
  }
  const left = window.scrollX;
  const top = window.scrollY;
  return () => {
    for (const [current, x, y] of positions) {
      if (current.isConnected) current.scrollTo({ left: x, top: y, behavior: 'instant' });
    }
    window.scrollTo({ left, top, behavior: 'instant' });
  };
}

function closeViewer() {
  if (viewer?.open) viewer.close();
  // Clean up synchronously so reopening never inherits the preceding session.
  finish();
}

function finish() {
  if (!active) return;
  const session = active;
  active = null;
  session.observer?.disconnect();
  session.parent?.removeEventListener('close', closeViewer);
  if (session.overflow) document.documentElement.style.setProperty('overflow', session.overflow, session.overflowPriority);
  else document.documentElement.style.removeProperty('overflow');
  const canRestore = !session.parent || (session.parent.isConnected && session.parent.open);
  if (canRestore) {
    if (session.returnFocus?.isConnected) session.returnFocus.focus({ preventScroll: true });
    session.restoreScroll();
  }
  viewer.querySelector('.product-photo-viewer-stage').replaceChildren();
}

function showPhoto() {
  const session = active;
  if (!session) return;
  const stage = viewer.querySelector('.product-photo-viewer-stage');
  const count = viewer.querySelector('#product-photo-viewer-count');
  const status = document.createElement('p');
  status.className = 'product-photo-viewer-status';
  status.setAttribute('role', 'status');
  const url = session.photos[session.index];
  count.textContent = `Photo ${session.index + 1} of ${session.photos.length}`;
  stage.replaceChildren(status);
  session.swipe = null;
  session.pointers.clear();
  if (!url) {
    status.textContent = 'This photo is unavailable.';
    return;
  }
  status.textContent = 'Loading photo…';
  const image = document.createElement('img');
  image.className = 'product-photo-viewer-image';
  image.alt = `${session.name} — photo ${session.index + 1}`;
  image.draggable = false;
  image.hidden = true;
  image.onload = () => {
    if (active !== session || !image.isConnected) return;
    status.hidden = true;
    image.hidden = false;
  };
  image.onerror = () => {
    if (active !== session || !image.isConnected) return;
    image.remove();
    status.textContent = session.photos.length > 1
      ? 'This photo could not be loaded. Try another photo.'
      : 'This photo could not be loaded. Please close and try again.';
  };
  stage.append(image);
  image.src = url;
}

function changePhoto(direction) {
  if (!active || active.photos.length < 2) return;
  active.index = (active.index + direction + active.photos.length) % active.photos.length;
  showPhoto();
  active.onChange?.(active.index);
}

function createViewer() {
  const dialog = document.createElement('dialog');
  dialog.id = 'product-photo-viewer';
  dialog.setAttribute('aria-labelledby', 'product-photo-viewer-title');
  dialog.setAttribute('aria-describedby', 'product-photo-viewer-count');

  const header = document.createElement('header');
  header.className = 'product-photo-viewer-header';
  const heading = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'product-photo-viewer-eyebrow';
  eyebrow.textContent = 'A closer look';
  const title = document.createElement('h2');
  title.id = 'product-photo-viewer-title';
  heading.append(eyebrow, title);
  const close = button('Close photo viewer', 'data-photo-close', '×');
  close.addEventListener('click', closeViewer);
  header.append(heading, close);

  const stage = document.createElement('div');
  stage.className = 'product-photo-viewer-stage';
  const footer = document.createElement('footer');
  footer.className = 'product-photo-viewer-footer';
  const previous = button('Previous photo', 'data-photo-previous', '←');
  const next = button('Next photo', 'data-photo-next', '→');
  const count = document.createElement('p');
  count.id = 'product-photo-viewer-count';
  count.setAttribute('aria-live', 'polite');
  count.setAttribute('aria-atomic', 'true');
  previous.addEventListener('click', () => changePhoto(-1));
  next.addEventListener('click', () => changePhoto(1));
  footer.append(previous, count, next);
  dialog.append(header, stage, footer);

  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    event.stopPropagation();
    closeViewer();
  });
  dialog.addEventListener('close', () => {
    // A queued close from the previous opening must not close a new session.
    if (!dialog.open) finish();
  });
  dialog.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      changePhoto(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  const outside = event => {
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };
  dialog.addEventListener('pointerdown', event => {
    if (active) active.backdropDown = event.target === dialog && outside(event);
  });
  dialog.addEventListener('click', event => {
    if (active?.backdropDown && event.target === dialog && outside(event)) closeViewer();
    else if (active) active.backdropDown = false;
  });
  stage.addEventListener('pointerdown', event => {
    if (!active || event.pointerType !== 'touch') return;
    active.pointers.add(event.pointerId);
    if (active.pointers.size !== 1 || (window.visualViewport?.scale || 1) > 1) {
      active.swipe = null;
      return;
    }
    active.swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
  });
  const endSwipe = event => {
    if (!active) return;
    const swipe = active.swipe;
    active.pointers.delete(event.pointerId);
    active.swipe = null;
    if (event.type !== 'pointerup' || !swipe || event.pointerId !== swipe.id) return;
    const x = event.clientX - swipe.x;
    const y = event.clientY - swipe.y;
    if (Math.abs(x) >= 50 && Math.abs(x) > Math.abs(y) * 1.5 && performance.now() - swipe.time < 900) changePhoto(x < 0 ? 1 : -1);
  };
  stage.addEventListener('pointerup', endSwipe);
  stage.addEventListener('pointercancel', endSwipe);
  document.body.append(dialog);
  return dialog;
}

/** Open the full photo above the existing product form, keeping its draft intact. */
export function openProductPhotoViewer({ photos = [], name = 'Product', index = 0, onChange, returnFocus } = {}) {
  if (active) closeViewer();
  viewer ||= createViewer();
  const trigger = returnFocus instanceof HTMLElement ? returnFocus : document.activeElement;
  const parent = trigger?.closest('dialog') || null;
  const urls = Array.isArray(photos) && photos.length ? photos.map(photoURL) : [''];
  const selected = Number.isInteger(index) ? Math.max(0, Math.min(index, urls.length - 1)) : 0;
  active = {
    photos: urls,
    name: String(name || 'Product'),
    index: selected,
    onChange: typeof onChange === 'function' ? onChange : null,
    returnFocus: trigger,
    parent,
    restoreScroll: rememberScroll(trigger),
    overflow: document.documentElement.style.getPropertyValue('overflow'),
    overflowPriority: document.documentElement.style.getPropertyPriority('overflow'),
    pointers: new Set(),
    swipe: null,
    backdropDown: false,
  };
  viewer.querySelector('#product-photo-viewer-title').textContent = active.name;
  viewer.querySelectorAll('[data-photo-previous], [data-photo-next]').forEach(element => { element.hidden = urls.length < 2; });
  showPhoto();
  document.documentElement.style.setProperty('overflow', 'hidden');
  try {
    viewer.showModal();
    viewer.querySelector('[data-photo-close]').focus({ preventScroll: true });
    if (parent) {
      parent.addEventListener('close', closeViewer);
      active.observer = new MutationObserver(() => {
        if (active?.parent && (!active.parent.isConnected || !active.parent.open)) closeViewer();
      });
      active.observer.observe(document.body, { childList: true, subtree: true });
      active.observer.observe(parent, { attributes: true, attributeFilter: ['open'] });
    }
  } catch (error) {
    closeViewer();
    throw error;
  }
  return viewer;
}
