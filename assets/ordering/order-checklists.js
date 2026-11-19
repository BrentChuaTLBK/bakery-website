import { accountingDatePicker } from './accounting-date-picker.js?v=production-calendar-20261015';
import { isCalendarDate } from './date-calendar.js?v=daily-quantities-1';
import { renderOrderChecklist } from './order-checklist-print.js?v=order-checklists-20261119';

const dayMs = 86400000;
const outstanding = new Set(['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery']);

function belongsOnChecklist(order, type) {
  if (type === 'preparation') return order.status === 'confirmed' || order.status === 'preparing';
  return order.method === type && outstanding.has(order.status);
}

export function mountOrderChecklists(panel, { api, today, initialDate, formatDate }) {
  panel.innerHTML = `<summary>Print checklists</summary>
    <p class="muted">Choose a fulfillment date for paid orders. Add an end date to print a range.</p>
    <div class="order-checklist-fields">
      <label class="field">Checklist<select name="checklist_type"><option value="preparation">Preparation</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select></label>
      ${accountingDatePicker('checklist_from', 'Fulfillment date', initialDate || today, today)}
      ${accountingDatePicker('checklist_to', 'Through (optional)', '', today, { optional: true })}
    </div>
    <div class="order-checklist-actions"><button type="button" class="button" data-checklist-print disabled>Print checklist</button>
      <span role="status" aria-live="polite"></span>
      <button type="button" class="button button-quiet" data-checklist-retry hidden>Try again</button></div>`;
  const type = panel.querySelector('[name=checklist_type]');
  const start = panel.querySelector('[name=checklist_from]');
  const end = panel.querySelector('[name=checklist_to]');
  const status = panel.querySelector('[role=status]');
  const print = panel.querySelector('[data-checklist-print]');
  const retry = panel.querySelector('[data-checklist-retry]');
  let version = 0;
  let orders = null;
  let sheet;

  function updateCount() {
    if (!orders) return;
    const count = orders.filter(order => belongsOnChecklist(order, type.value)).length;
    const description = { preparation: 'to prepare', pickup: 'for pickup', delivery: 'for delivery' }[type.value];
    status.textContent = count ? `${count} ${count === 1 ? 'order' : 'orders'} ${description}.` : `No orders ${description} for these dates.`;
    print.disabled = count === 0;
  }

  async function load() {
    const current = ++version;
    orders = null;
    print.disabled = true;
    retry.hidden = true;
    if (!panel.open) return;
    const from = start.value;
    const to = end.value || from;
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
      status.textContent = 'Choose a valid fulfillment date and an end date on or after it.';
      return;
    }
    status.textContent = 'Loading orders…';
    const rows = new Map();
    const last = Date.parse(to + 'T00:00:00Z');
    const isoDate = value => new Date(value).toISOString().slice(0, 10);
    try {
      // The staff calendar accepts up to 63 fulfillment dates per request.
      for (let cursor = Date.parse(from + 'T00:00:00Z'); cursor <= last; cursor += 63 * dayMs) {
        const range = { from: isoDate(cursor), to: isoDate(Math.min(cursor + 62 * dayMs, last)) };
        const result = await api('calendar_list', range);
        if (current !== version || !panel.isConnected || !panel.open) return;
        if (!Array.isArray(result?.orders)) throw new Error('Order data was incomplete.');
        for (const order of result.orders) {
          if (order.date >= range.from && order.date <= range.to) rows.set(order.id, order);
        }
      }
      orders = [...rows.values()];
      updateCount();
    } catch (error) {
      if (current !== version || !panel.isConnected || !panel.open) return;
      status.textContent = `Couldn’t load the full checklist. ${error.message || 'Please try again.'}`;
      retry.hidden = false;
    }
  }

  function clearSheet() {
    if (!sheet) return;
    document.body.classList.remove('order-checklist-printing');
    sheet.remove();
    sheet = null;
  }

  print.addEventListener('click', () => {
    if (!orders || print.disabled) return;
    clearSheet();
    const from = formatDate(start.value);
    const to = end.value && end.value !== start.value ? formatDate(end.value) : '';
    const selected = orders.filter(order => belongsOnChecklist(order, type.value));
    sheet = document.createElement('div');
    sheet.id = 'order-checklist-print';
    sheet.innerHTML = renderOrderChecklist({ orders: selected, type: type.value, periodLabel: to ? `${from} – ${to}` : from });
    document.body.append(sheet);
    document.body.classList.add('order-checklist-printing');
    try { window.print(); } catch { clearSheet(); status.textContent = 'Printing could not start. Please try again.'; }
  });
  panel.addEventListener('toggle', event => { if (event.target === panel) load(); });
  panel.addEventListener('change', event => {
    if (event.target === type) updateCount();
    if (event.target === start || event.target === end) load();
  });
  retry.addEventListener('click', load);
  window.addEventListener('afterprint', clearSheet);
  window.addEventListener('pagehide', clearSheet);
  return () => {
    version++;
    window.removeEventListener('afterprint', clearSheet);
    window.removeEventListener('pagehide', clearSheet);
    clearSheet();
  };
}
