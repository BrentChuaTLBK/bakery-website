import { calendarAddress } from './order-calendar.js';

const titles = { preparation: 'Preparation checklist', pickup: 'Pickup checklist', delivery: 'Delivery checklist' };
const dateFormat = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
const orderCount = count => `${count} ${count === 1 ? 'order' : 'orders'}`;
const reference = order => order.reference || order.id || 'Order';
const dateOf = order => order.date || order.fulfillment_date || '';

function optionsFor(item) {
  const saved = Array.isArray(item.selection_labels) && item.selection_labels.length > 0;
  const choices = saved ? item.selection_labels : item.flavor_contents;
  if (!Array.isArray(choices)) return '';
  const labels = choices.map(choice => {
    if (typeof choice === 'string') return choice;
    const name = choice?.label || choice?.name;
    if (!name) return '';
    const count = Number(choice.quantity ?? choice.count);
    return [choice.group, `${count > 1 ? count + ' × ' : ''}${name}`].filter(Boolean).join(' — ');
  }).filter(Boolean);
  return labels.length ? `<span class="checklist-item-detail">${saved && Number(item.quantity) > 1 ? 'Per unit · ' : ''}${esc(labels.join(' · '))}</span>` : '';
}

function itemsFor(order, preparation) {
  const items = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
  if (!items.length) return '<p>Item details unavailable</p>';
  return `<ul class="${preparation ? 'checklist-prep-items' : 'checklist-handoff-items'}">${items.map(item => {
    const name = item.name || item.custom_name || 'Unnamed item';
    const description = item.description || item.custom_description;
    const label = `${esc(item.quantity ?? '?')} × ${esc(name)}`;
    return preparation ? `<li><strong>${label}</strong>${description ? `<span class="checklist-item-detail">${esc(description)}</span>` : ''}${optionsFor(item)}</li>` : `<li>${label}</li>`;
  }).join('')}</ul>`;
}

function detail(label, value) {
  return value ? `<p class="checklist-detail"><strong>${label}</strong> ${esc(value)}</p>` : '';
}

function orderRow(order, type) {
  const preparation = type === 'preparation';
  const pickup = order.method === 'pickup';
  const buyer = order.buyer || {};
  const recipient = order.recipient || {};
  const timeWindow = order.window || (pickup ? order.pickup_hours : order.delivery_window);
  const meta = [preparation ? (pickup ? 'Pickup' : 'Delivery') : '', timeWindow].filter(Boolean).join(' · ');
  let handoff = '';
  if (type === 'pickup') {
    handoff = detail('Phone', buyer.phone) + detail('Pickup point', calendarAddress(order));
  } else if (type === 'delivery') {
    handoff = detail('Recipient', [recipient.name, recipient.phone].filter(Boolean).join(' · ')) +
      detail('Deliver to', calendarAddress(order) || 'Address not recorded');
    if (!recipient.phone) handoff += detail('Buyer phone', buyer.phone);
  }
  return `<tr class="checklist-order" data-order-reference="${esc(reference(order))}">
    <td class="checklist-mark"><span class="checklist-tick" aria-hidden="true"></span></td>
    <td class="checklist-order-body"><h3>${esc(buyer.name || recipient.name || 'Customer')} <span>${esc(reference(order))}</span></h3>
      ${meta ? `<p class="checklist-window">${esc(meta)}</p>` : ''}${handoff}
      ${itemsFor(order, preparation)}${detail('Instructions', order.instructions)}
    </td></tr>`;
}

export function renderOrderChecklist({ orders, type, periodLabel }) {
  if (!Object.hasOwn(titles, type)) throw new Error('Choose a checklist type.');
  const days = new Map();
  for (const order of orders) {
    const date = dateOf(order);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(order);
  }
  const tables = [...days.keys()].sort().map(date => {
    const dayOrders = days.get(date).sort((a, b) => reference(a).localeCompare(reference(b), 'en', { numeric: true }));
    const day = new Date(date + 'T12:00:00Z');
    const dayLabel = Number.isFinite(day.getTime()) ? dateFormat.format(day) : 'Date not recorded';
    return `<table class="checklist-day" aria-label="${esc(dayLabel)}"><colgroup><col class="checklist-mark-column"><col></colgroup>
      <thead><tr><th colspan="2"><div class="checklist-day-heading"><h2>${esc(dayLabel)}</h2><span>${titles[type]} · ${orderCount(dayOrders.length)}</span></div></th></tr></thead>
      <tbody>${dayOrders.map(order => orderRow(order, type)).join('')}</tbody></table>`;
  });
  return `<section class="order-checklist-sheet"><header class="checklist-heading"><div><h1>${titles[type]}</h1><p>${esc(periodLabel)} · ${orderCount(orders.length)}</p></div><strong>TLB Kitchen</strong></header>
    ${tables.join('') || '<p>No orders in this period.</p>'}</section>`;
}
