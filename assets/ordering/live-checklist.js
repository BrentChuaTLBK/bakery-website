import { renderChecklistItems } from './order-checklist-print.js?v=live-checklist-20261119';
import { accountingDatePicker, setAccountingDate } from './accounting-date-picker.js?v=production-calendar-20261015';
import { todayInManila } from './order-calendar.js';
import { validDate, shiftDate } from './production-summary.js?v=production-summary-20261015';

const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'full', timeZone: 'UTC' });
const referenceOrder = new Intl.Collator('en-PH', { numeric: true });
const methods = { pickup: 'Pickup', delivery: 'Delivery', unknown: 'Method not recorded' };
const dayLabel = date => date ? dateFormat.format(new Date(date + 'T12:00:00Z')) : 'Date not recorded';

const paymentNotes = {
  awaiting_payment: 'Awaiting payment',
  under_review: 'Payment under review',
  rejected: 'Payment rejected',
};

function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

// Retain existing nodes in place across polls so a focused checkbox stays usable.
function orderChildren(parent, children) {
  let next = parent.firstElementChild;
  for (const child of children) {
    if (child !== next) parent.insertBefore(child, next);
    next = child.nextElementSibling;
  }
  while (next) {
    const removed = next;
    next = next.nextElementSibling;
    removed.remove();
  }
}

function daySection(date) {
  const section = document.createElement('section');
  section.dataset.checklistDate = date;
  const heading = document.createElement('h2');
  heading.textContent = dayLabel(date);
  section.append(heading, document.createElement('div'));
  return section;
}

function methodSection(method) {
  const section = document.createElement('section');
  section.dataset.checklistMethod = method;
  const heading = document.createElement('h3');
  heading.textContent = methods[method];
  const orders = document.createElement('ul');
  orders.className = 'live-checklist-orders';
  section.append(heading, orders);
  return section;
}

function createRow(id) {
  const row = document.createElement('li');
  row.dataset.checklistOrder = id;
  row.innerHTML = `<label class="live-checklist-label">
      <input type="checkbox"><span class="live-checklist-identity"><strong data-client></strong><span data-reference></span></span>
    </label>
    <div class="live-checklist-copy">
      <p class="live-checklist-payment" hidden></p>
      <div class="live-checklist-items"></div>
      <p class="live-checklist-instructions" hidden><strong>Instructions</strong><span></span></p>
      <p class="live-checklist-error" role="alert" hidden></p>
    </div>`;
  return {
    row, input: row.querySelector('input'), client: row.querySelector('[data-client]'),
    reference: row.querySelector('[data-reference]'), items: row.querySelector('.live-checklist-items'),
    payment: row.querySelector('.live-checklist-payment'), instructions: row.querySelector('.live-checklist-instructions'),
    error: row.querySelector('[role=alert]'),
  };
}

function showOrder(entry, order, products) {
  entry.order = order;
  const reference = order.reference || order.id;
  entry.input.setAttribute('aria-label', 'Prepared · ' + reference);
  entry.input.checked = order.prepared === true;
  entry.row.classList.toggle('is-prepared', entry.input.checked);
  text(entry.client, order.buyer?.name || 'Client not recorded');
  text(entry.reference, reference);
  const payment = paymentNotes[order.payment_status] || '';
  entry.payment.hidden = !payment;
  text(entry.payment, payment);
  const items = renderChecklistItems(order, true, products);
  if (entry.itemsMarkup !== items) {
    entry.items.innerHTML = items;
    entry.itemsMarkup = items;
  }
  entry.instructions.hidden = !order.instructions;
  text(entry.instructions.lastElementChild, order.instructions || '');
}

export function mountLiveChecklist(root, { loadOrders, setPrepared, products = [] }) {
  const today = todayInManila();
  root.classList.add('live-checklist');
  root.innerHTML = `<div class="view-heading"><div><h1>Order checklist</h1>
      <p>New orders appear automatically. Check each order once it’s prepared.</p></div>
      <button type="button" class="button button-secondary" data-checklist-refresh>Refresh</button></div>
    <div class="live-checklist-filters">
      <div class="live-checklist-view" role="group" aria-label="View by fulfillment date">
        <button type="button" data-checklist-mode="all" aria-pressed="true">All dates</button>
        <button type="button" data-checklist-mode="day" aria-pressed="false">Single day</button>
      </div>
      <div class="live-checklist-day-nav" hidden>
        <button type="button" class="button button-secondary" data-checklist-step="-1" aria-label="Previous day">‹</button>
        ${accountingDatePicker('checklist_day', 'Fulfillment date', today, today)}
        <button type="button" class="button button-secondary" data-checklist-step="1" aria-label="Next day">›</button>
      </div>
    </div>
    <p class="live-checklist-summary" role="status">Loading orders…</p>
    <p class="live-checklist-error" role="alert" hidden></p>
    <div class="live-checklist-days"></div>`;
  const summary = root.querySelector('[role=status]');
  const loadError = root.querySelector('.live-checklist-error');
  const list = root.querySelector('.live-checklist-days');
  const dayNav = root.querySelector('.live-checklist-day-nav');
  const dayInput = dayNav.querySelector('[name="checklist_day"]');
  const modeButtons = root.querySelectorAll('[data-checklist-mode]');
  const refreshButton = root.querySelector('[data-checklist-refresh]');
  const rows = new Map();
  const saving = new Set();
  const events = new AbortController();
  const options = { signal: events.signal };
  let timer, reading = false, writeVersion = 0;
  let loaded = false, singleDay = false;
  const active = () => !events.signal.aborted && root.isConnected;

  function showCount() {
    const count = list.querySelectorAll('[data-checklist-order]').length;
    const prepared = list.querySelectorAll('input:checked').length;
    const empty = singleDay ? `No open orders for ${dayLabel(dayInput.value)}.` : 'No open orders.';
    text(summary, count ? `${prepared} of ${count} prepared` : empty);
  }

  function groupRows() {
    if (!loaded) return;
    const dates = new Map();
    for (const entry of rows.values()) {
      const date = validDate(entry.order.fulfillment_date) ? entry.order.fulfillment_date : '';
      if (singleDay && date !== dayInput.value) continue;
      const method = Object.hasOwn(methods, entry.order.method) ? entry.order.method : 'unknown';
      if (!dates.has(date)) dates.set(date, new Map());
      const groups = dates.get(date);
      if (!groups.has(method)) groups.set(method, []);
      groups.get(method).push(entry);
    }
    const focus = list.contains(document.activeElement) ? document.activeElement : null;
    const currentDays = new Map([...list.children].map(day => [day.dataset.checklistDate, day]));
    const dayNodes = [];
    // ISO dates sort chronologically. Keep any undated legacy orders at the end.
    const sortedDates = [...dates.keys()].filter(Boolean).sort();
    if (dates.has('')) sortedDates.push('');
    for (const date of sortedDates) {
      const day = currentDays.get(date) || daySection(date);
      const methodNodes = [];
      for (const method of Object.keys(methods)) {
        const entries = dates.get(date).get(method);
        if (!entries) continue;
        entries.sort((a, b) => referenceOrder.compare(a.order.reference || a.order.id, b.order.reference || b.order.id));
        const section = day.querySelector(`[data-checklist-method="${method}"]`) || methodSection(method);
        orderChildren(section.lastElementChild, entries.map(entry => entry.row));
        methodNodes.push(section);
      }
      orderChildren(day.lastElementChild, methodNodes);
      dayNodes.push(day);
    }
    orderChildren(list, dayNodes);
    if (focus?.isConnected && document.activeElement === document.body) focus.focus({ preventScroll: true });
    showCount();
  }

  function showOrders(orders) {
    const ids = new Set(orders.map(order => order.id));
    for (const [id, entry] of rows) {
      if (!ids.has(id)) {
        entry.row.remove();
        rows.delete(id);
      }
    }
    for (const order of orders) {
      const entry = rows.get(order.id) || createRow(order.id);
      rows.set(order.id, entry);
      showOrder(entry, order, products);
    }
    loaded = true;
    groupRows();
  }

  async function refresh() {
    clearTimeout(timer);
    if (!active() || document.hidden || reading || saving.size) return;
    reading = true;
    const version = writeVersion;
    try {
      const orders = await loadOrders();
      if (!active() || document.hidden || version !== writeVersion) return;
      showOrders(orders);
      loadError.hidden = true;
    } catch (error) {
      if (active() && !document.hidden && version === writeVersion) {
        if (!rows.size) text(summary, '');
        text(loadError, error?.message || 'Couldn’t refresh the checklist. Try Refresh again.');
        loadError.hidden = false;
      }
    } finally {
      reading = false;
      if (active() && !document.hidden && !saving.size) {
        // A read started before a checkmark changed may contain the previous value.
        timer = setTimeout(refresh, version === writeVersion ? 15000 : 0);
      }
    }
  }

  async function change(event) {
    const input = event.target;
    if (!input.matches('input[type=checkbox]')) return;
    const id = input.closest('[data-checklist-order]').dataset.checklistOrder;
    const entry = rows.get(id);
    if (!entry || saving.has(id)) return;
    const prepared = input.checked;
    saving.add(id);
    writeVersion++;
    clearTimeout(timer);
    input.setAttribute('aria-disabled', 'true');
    entry.row.setAttribute('aria-busy', 'true');
    entry.row.classList.toggle('is-prepared', prepared);
    entry.error.hidden = true;
    showCount();
    try {
      await setPrepared(entry.order, prepared);
      if (active()) entry.order = { ...entry.order, prepared };
    } catch (error) {
      if (active()) {
        input.checked = entry.order.prepared === true;
        entry.row.classList.toggle('is-prepared', input.checked);
        text(entry.error, error?.message || 'Couldn’t save this checkmark. Please try again.');
        entry.error.hidden = false;
        showCount();
      }
    } finally {
      saving.delete(id);
      if (active()) {
        input.removeAttribute('aria-disabled');
        entry.row.removeAttribute('aria-busy');
        refresh();
      }
    }
  }

  list.addEventListener('change', change, options);
  list.addEventListener('click', event => {
    if (event.target.matches('input[aria-disabled=true]')) event.preventDefault();
  }, options);
  for (const button of modeButtons) button.addEventListener('click', () => {
    singleDay = button.dataset.checklistMode === 'day';
    for (const mode of modeButtons) mode.setAttribute('aria-pressed', String(mode === button));
    dayNav.hidden = !singleDay;
    groupRows();
  }, options);
  const previous = dayNav.querySelector('[data-checklist-step="-1"]');
  const next = dayNav.querySelector('[data-checklist-step="1"]');
  dayInput.addEventListener('change', () => {
    previous.disabled = dayInput.value <= '0001-01-01';
    next.disabled = dayInput.value >= '9999-12-31';
    groupRows();
  }, options);
  for (const button of [previous, next]) button.addEventListener('click', () => {
    setAccountingDate(dayNav, 'checklist_day', shiftDate(dayInput.value, Number(button.dataset.checklistStep)), { notify: true });
  }, options);
  refreshButton.addEventListener('click', refresh, options);
  document.addEventListener('visibilitychange', refresh, options);
  window.addEventListener('focus', refresh, options);
  window.addEventListener('online', refresh, options);
  refresh();
  return { refresh, destroy() {
    events.abort();
    clearTimeout(timer);
    rows.clear();
  } };
}
