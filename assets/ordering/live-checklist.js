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
  row.innerHTML = `<div class="live-checklist-order-heading">
      <label class="live-checklist-label">
        <input type="checkbox" data-order-prepared><span class="live-checklist-identity"><strong data-client></strong><span data-reference></span></span>
      </label>
      <span class="live-checklist-progress" data-item-progress hidden></span>
    </div>
    <div class="live-checklist-copy">
      <p class="live-checklist-payment" hidden></p>
      <div class="live-checklist-items"></div>
      <p class="live-checklist-instructions" hidden><strong>Instructions</strong><span></span></p>
      <details class="live-checklist-notes">
        <summary>Prep notes<span data-note-saved hidden>Saved</span></summary>
        <form class="live-checklist-note-form">
          <textarea aria-label="Private prep note" maxlength="2000" rows="3" placeholder="Add a note for the kitchen…"></textarea>
          <div class="live-checklist-note-actions">
            <button class="button button-secondary" type="submit" disabled>Save note</button>
            <span data-note-status role="status"></span>
          </div>
          <div data-note-conflict hidden>
            <p role="status">A teammate saved a newer note. Copy any edits you want to keep before loading it.</p>
            <button class="button button-quiet" type="button" data-load-note>Load saved note</button>
          </div>
        </form>
      </details>
      <p class="live-checklist-error" role="alert" hidden></p>
    </div>`;
  return {
    row, input: row.querySelector('[data-order-prepared]'), client: row.querySelector('[data-client]'),
    reference: row.querySelector('[data-reference]'), items: row.querySelector('.live-checklist-items'),
    payment: row.querySelector('.live-checklist-payment'), instructions: row.querySelector('.live-checklist-instructions'),
    progress: row.querySelector('[data-item-progress]'), error: row.querySelector('[role=alert]'), itemInputs: [],
    noteInput: row.querySelector('textarea'), noteSave: row.querySelector('button[type=submit]'),
    noteMarker: row.querySelector('[data-note-saved]'), noteStatus: row.querySelector('[data-note-status]'),
    noteConflict: row.querySelector('[data-note-conflict]'), noteLoad: row.querySelector('[data-load-note]'),
    noteBase: '', noteVersion: 0, saving: false,
  };
}

const itemNumber = input => Number(input.dataset.checklistItem);

function showProgress(entry, { prepared, prepared_items }) {
  const marked = new Set(prepared_items);
  let count = 0;
  for (const input of entry.itemInputs) {
    input.checked = prepared_items ? marked.has(itemNumber(input)) : prepared === true;
    if (input.checked) count++;
  }
  entry.input.checked = prepared === true;
  entry.input.indeterminate = count > 0 && !entry.input.checked;
  entry.row.classList.toggle('is-prepared', entry.input.checked);
  entry.progress.hidden = !entry.itemInputs.length;
  text(entry.progress, `${count} of ${entry.itemInputs.length} items`);
}

function updateNoteControls(entry) {
  const saved = entry.order.prep_note || '';
  const dirty = entry.noteInput.value.trim() !== saved;
  const conflict = dirty && entry.noteVersion !== (entry.order.prep_note_version ?? 0);
  entry.noteMarker.hidden = !saved;
  entry.noteConflict.hidden = !conflict;
  entry.noteLoad.disabled = entry.saving;
  entry.noteSave.disabled = !dirty || conflict || entry.saving;
}

function showNote(entry) {
  const note = entry.order.prep_note || '';
  // Keep a draft if a poll returns changes from another staff member.
  if (entry.noteInput.value === entry.noteBase || entry.noteInput.value === note) {
    if (entry.noteInput.value !== note) entry.noteInput.value = note;
    entry.noteBase = note;
    entry.noteVersion = entry.order.prep_note_version ?? 0;
  }
  updateNoteControls(entry);
}

function showOrder(entry, order, products) {
  entry.order = order;
  const reference = order.reference || order.id;
  entry.input.setAttribute('aria-label', 'Prepared · ' + reference);
  text(entry.client, order.buyer?.name || 'Client not recorded');
  text(entry.reference, reference);
  const payment = paymentNotes[order.payment_status] || '';
  entry.payment.hidden = !payment;
  text(entry.payment, payment);
  const items = renderChecklistItems(order, true, products);
  if (entry.itemsMarkup !== items) {
    entry.items.innerHTML = items;
    entry.itemsMarkup = items;
    entry.itemInputs = [...entry.items.querySelectorAll('li')].map((line, index) => {
      const label = document.createElement('label');
      label.className = 'live-checklist-item-label';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.checklistItem = String(index + 1);
      const details = document.createElement('span');
      details.append(...line.childNodes);
      label.append(input, details);
      line.append(label);
      return input;
    });
  }
  showProgress(entry, order);
  entry.instructions.hidden = !order.instructions;
  text(entry.instructions.lastElementChild, order.instructions || '');
  showNote(entry);
}

export function mountLiveChecklist(root, { loadOrders, setPrepared, setPrepNote, products = [] }) {
  const today = todayInManila();
  root.classList.add('live-checklist');
  root.innerHTML = `<div class="view-heading"><div><h1>Order checklist</h1>
      <p>Check items as you prepare them, or check the whole order when it’s ready.</p></div>
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
    const prepared = list.querySelectorAll('[data-order-prepared]:checked').length;
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

  function entryFor(node) {
    return rows.get(node.closest('[data-checklist-order]')?.dataset.checklistOrder);
  }

  function lockEntry(entry, locked) {
    entry.saving = locked;
    for (const control of [entry.row, entry.input, ...entry.itemInputs]) {
      const attr = control === entry.row ? 'aria-busy' : 'aria-disabled';
      if (locked) control.setAttribute(attr, 'true');
      else control.removeAttribute(attr);
    }
    updateNoteControls(entry);
  }

  async function save(entry, request) {
    const id = entry.order.id;
    saving.add(id);
    writeVersion++;
    clearTimeout(timer);
    lockEntry(entry, true);
    try {
      await request();
    } finally {
      saving.delete(id);
      if (active()) {
        lockEntry(entry, false);
        refresh();
      }
    }
  }

  async function change(event) {
    const input = event.target;
    if (!input.matches('input[type=checkbox]')) return;
    const entry = entryFor(input);
    if (!entry || entry.saving) return;
    const item = input === entry.input ? null : itemNumber(input);
    const checked = input.checked;
    const marked = entry.itemInputs.filter(itemInput => item === null ? checked : itemInput.checked).map(itemNumber);
    const prepared = item === null ? checked : marked.length === entry.itemInputs.length;
    entry.error.hidden = true;
    showProgress(entry, { prepared, prepared_items: marked });
    showCount();
    await save(entry, async () => {
      try {
        const result = await setPrepared(entry.order, checked, item);
        if (active()) entry.order = { ...entry.order, prepared_items: marked, ...result };
      } catch (error) {
        if (active()) {
          text(entry.error, error?.message || 'Couldn’t save this checkmark. Please try again.');
          entry.error.hidden = false;
        }
      } finally {
        if (active()) {
          showProgress(entry, entry.order);
          showCount();
        }
      }
    });
  }

  async function saveNote(event) {
    event.preventDefault();
    const entry = entryFor(event.target);
    if (!entry || entry.noteSave.disabled) return;
    const draft = entry.noteInput.value;
    const noteVersion = entry.noteVersion;
    text(entry.noteStatus, 'Saving…');
    await save(entry, async () => {
      try {
        const result = await setPrepNote(entry.order, draft.trim(), noteVersion);
        if (!active()) return;
        entry.order = { ...entry.order, prep_note: result.note, prep_note_version: result.note_version };
        if (!result.conflict) {
          if (entry.noteInput.value === draft) entry.noteInput.value = result.note;
          entry.noteBase = result.note;
          entry.noteVersion = result.note_version;
        }
        text(entry.noteStatus, result.conflict ? '' : 'Note saved.');
        showNote(entry);
      } catch (error) {
        if (active()) text(entry.noteStatus, error?.message || 'Couldn’t save the note. Please try again.');
      }
    });
  }

  list.addEventListener('change', change, options);
  list.addEventListener('input', event => {
    if (!event.target.matches('textarea')) return;
    const entry = entryFor(event.target);
    if (!entry) return;
    if (!entry.saving) text(entry.noteStatus, '');
    updateNoteControls(entry);
  }, options);
  list.addEventListener('submit', saveNote, options);
  list.addEventListener('click', event => {
    if (event.target.matches('input[aria-disabled=true]')) event.preventDefault();
    if (!event.target.matches('[data-load-note]')) return;
    const entry = entryFor(event.target);
    if (!entry || entry.saving) return;
    entry.noteInput.value = entry.order.prep_note || '';
    text(entry.noteStatus, '');
    showNote(entry);
    entry.noteInput.focus();
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
