const bar = (short = false) => `<span class="tlb-skeleton-line${short ? ' tlb-skeleton-short' : ''}"></span>`;
const cards = (count, photos = true) => `<div class="tlb-skeleton-grid">${Array.from({length: count}, () => `<div class="tlb-skeleton-card">${photos ? '<div class="tlb-skeleton-photo"></div>' : ''}${bar()}${bar(true)}${bar()}${bar(true)}</div>`).join('')}</div>`;

// Static equivalents in the public HTML reserve space before modules arrive.
// Only the status is announced; placeholders are neither content nor controls.
export function loadingMarkup(kind) {
  if (kind === 'academy') return `<div class="tlb-loading tlb-loading--academy" data-loading-state><p class="tlb-loading-status" role="status">Opening our class albums…</p><div class="academy-layout" aria-hidden="true"><div class="academy-sidebar">${bar()}${bar(true)}${cards(3, false)}</div><div class="academy-content">${bar(true)}${bar()}<div class="tlb-skeleton-title"></div>${bar()}<div class="tlb-skeleton-hero"></div>${bar()}${bar(true)}</div></div></div>`;
  if (kind === 'packages') return `<div class="tlb-loading tlb-loading--packages" data-loading-state aria-hidden="true"><div class="tlb-skeleton-inclusions"></div>${bar(true)}${cards(3, false)}</div>`;
  return `<div class="tlb-loading tlb-loading--shop" data-loading-state><p class="tlb-loading-status" role="status">Opening the kitchen…</p><div aria-hidden="true"><div class="shop-hero"><div class="hero-copy">${bar(true)}<div class="tlb-skeleton-title"></div>${bar()}${bar(true)}</div><div class="hero-photo"></div></div><div class="shop-layout"><div><div class="tlb-skeleton-date"></div>${bar(true)}${bar()}${cards(4)}</div><div class="panel tlb-skeleton-basket">${bar()}${bar(true)}</div></div></div></div>`;
}

export function showLoading(root, kind) {
  root.setAttribute('aria-busy', 'true');
  root.innerHTML = loadingMarkup(kind);
}

export function finishLoading(root) {
  root.removeAttribute('aria-busy');
}
