export const packageEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const packagePrice = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);

export function packageGroups(items, categories = []) {
  const groups = categories.map(category => ({ ...category, items: items.filter(p => p.category_id === category.id) }));
  const other = items.filter(p => !categories.some(category => category.id === p.category_id));
  if (other.length || !groups.length) groups.push({ id: '', name: 'More packages', items: other });
  return groups;
}

export function packageSections(items, categories = []) {
  const groups = packageGroups(items, categories).filter(group => group.items.length);
  if (!categories.length) return `<div class="party-grid">${items.map(item => packageCard(item)).join('')}</div>`;
  const anchor = group => `package-category-${group.id || 'more'}`;
  return (groups.length > 1 ? `<nav class="party-category-links" aria-label="Jump to package category"><span>Browse packages</span>${groups.map(group => `<a href="#${packageEscape(anchor(group))}">${packageEscape(group.name)}</a>`).join('')}</nav>` : '')
    + groups.map(group => `<section class="party-category" aria-labelledby="${packageEscape(anchor(group))}"><header class="party-category-heading"><h2 id="${packageEscape(anchor(group))}" tabindex="-1">${packageEscape(group.name)}</h2><span>${group.items.length} package${group.items.length === 1 ? '' : 's'}</span></header><div class="party-grid">${group.items.map(item => packageCard(item)).join('')}</div></section>`).join('');
}

export function packageCard(item, { preview = false } = {}) {
  const esc = packageEscape;
  return `<article class="party-card${item.badge?.trim().toLowerCase() === 'most popular' ? ' party-card--featured' : ''}"><div class="party-card-heading"><div class="party-card-top"><span class="party-package-name">${item.subtitle ? esc(item.name) : ''}</span>${item.badge ? `<span class="party-badge">${esc(item.badge)}</span>` : ''}</div><h3>${esc(item.subtitle || item.name)}</h3><p class="party-price">${esc(packagePrice(item.price_cents))}<small>/ package</small></p></div><ul class="party-features">${item.features.map(feature => `<li><span aria-hidden="true">✓</span><div><strong>${esc(feature.label)}</strong>${feature.detail ? `<p class="party-feature-detail">${esc(feature.detail)}</p>` : ''}</div></li>`).join('')}</ul>${preview ? '<span class="party-inquire">Contact us ↗</span>' : `<a class="party-inquire" href="contactus.html" aria-label="Contact us about ${esc(item.name)}">Contact us <span aria-hidden="true">↗</span></a>`}</article>`;
}

export function packageInclusions(inclusions) {
  if (!inclusions.length) return '';
  return `<section class="party-inclusions" aria-label="Included in every package"><div><p class="party-eyebrow">Every package includes</p><h2>Ready for your celebration</h2></div><ul>${inclusions.map(item => `<li><strong>${packageEscape(item.label)}</strong>${item.detail ? `<span>${packageEscape(item.detail)}</span>` : ''}</li>`).join('')}</ul></section>`;
}
