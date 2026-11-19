import { accountingDatePicker } from './accounting-date-picker.js?v=production-calendar-20261015';
import { isCalendarDate } from './date-calendar.js?v=daily-quantities-1';
import { checklistOrders, checklistSource, loadChecklistPeriod } from './order-checklist-data.js?v=checklist-dates-20261119';

export function mountOrderChecklists(panel, { api, today, initialDate }) {
  panel.innerHTML = `<summary>Print checklists</summary>
    <p class="muted">Choose a fulfillment date. Add an end date to print a range.</p>
    <div class="order-checklist-fields">
      <label class="field">Checklist<select name="checklist_type"><option value="orders">All orders</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select></label>
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
  let source;
  let orders = null;

  function updateCount() {
    if (!orders) return;
    const count = checklistOrders(orders, type.value).length;
    const description = { orders: '', pickup: ' for pickup', delivery: ' for delivery' }[type.value];
    status.textContent = count ? `${count} ${count === 1 ? 'order' : 'orders'}${description}.` : `No orders${description} for these dates.`;
    print.disabled = count === 0;
  }

  async function load() {
    const current = ++version;
    const isCurrent = () => current === version && panel.isConnected && panel.open;
    orders = null;
    print.disabled = true;
    retry.hidden = true;
    if (!panel.open) return;
    source = checklistSource(type.value);
    const from = start.value;
    const to = end.value || from;
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
      status.textContent = 'Choose a valid fulfillment date and an end date on or after it.';
      return;
    }
    status.textContent = 'Loading orders…';
    try {
      const rows = await loadChecklistPeriod(api, type.value, from, to, isCurrent);
      if (!isCurrent()) return;
      orders = rows;
      updateCount();
    } catch (error) {
      if (!isCurrent()) return;
      status.textContent = `Couldn’t load the full checklist. ${error.message || 'Please try again.'}`;
      retry.hidden = false;
    }
  }

  print.addEventListener('click', () => {
    if (print.disabled) return;
    const url = new URL('./order-checklist-preview.html', import.meta.url);
    url.search = new URLSearchParams({ type: type.value, from: start.value, to: end.value || start.value });
    const preview = window.open(url.href, '_blank');
    if (preview) preview.opener = null;
    else window.location.assign(url.href);
  });
  panel.addEventListener('toggle', event => { if (event.target === panel) load(); });
  panel.addEventListener('change', event => {
    if (event.target === type && checklistSource(type.value) === source) updateCount();
    else if (event.target === type || event.target === start || event.target === end) load();
  });
  retry.addEventListener('click', load);
  return () => { version++; };
}
