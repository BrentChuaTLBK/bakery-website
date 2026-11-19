import { renderChecklistItems } from './order-checklist-print.js?v=live-checklist-20261119';

const paymentNotes = {
  awaiting_payment: 'Awaiting payment',
  under_review: 'Payment under review',
  rejected: 'Payment rejected',
};

function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
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
  root.classList.add('live-checklist');
  root.innerHTML = `<div class="view-heading"><div><h1>Order checklist</h1>
      <p>New orders appear automatically. Check each order once it’s prepared.</p></div>
      <button type="button" class="button button-secondary" data-checklist-refresh>Refresh</button></div>
    <p class="live-checklist-summary" role="status">Loading orders…</p>
    <p class="live-checklist-error" role="alert" hidden></p>
    <ul class="live-checklist-orders" aria-label="Orders"></ul>`;
  const summary = root.querySelector('[role=status]');
  const loadError = root.querySelector('[role=alert]');
  const list = root.querySelector('.live-checklist-orders');
  const refreshButton = root.querySelector('[data-checklist-refresh]');
  const rows = new Map();
  const saving = new Set();
  const events = new AbortController();
  const options = { signal: events.signal };
  let timer, reading = false, writeVersion = 0;
  const active = () => !events.signal.aborted && root.isConnected;

  function showCount() {
    let prepared = 0;
    for (const { input } of rows.values()) if (input.checked) prepared++;
    text(summary, rows.size ? `${prepared} of ${rows.size} prepared` : 'No open orders.');
  }

  function showOrders(orders) {
    const ids = new Set(orders.map(order => order.id));
    for (const [id, entry] of rows) {
      if (!ids.has(id)) {
        entry.row.remove();
        rows.delete(id);
      }
    }
    let next = list.firstElementChild;
    const focus = list.contains(document.activeElement) ? document.activeElement : null;
    for (const order of orders) {
      const entry = rows.get(order.id) || createRow(order.id);
      rows.set(order.id, entry);
      showOrder(entry, order, products);
      if (entry.row !== next) list.insertBefore(entry.row, next);
      next = entry.row.nextElementSibling;
    }
    if (focus?.isConnected && document.activeElement === document.body) focus.focus({ preventScroll: true });
    showCount();
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
