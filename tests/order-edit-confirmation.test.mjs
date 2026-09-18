import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmOrderTotalChange } from '../assets/ordering/order-edit-confirmation.js';

// A small DOM boundary harness exercises promise and listener lifecycles without
// adding browser dependencies. Visual rendering still needs browser review.
class Element extends EventTarget {
  constructor(tag, doc) {
    super();
    Object.assign(this, { tagName: tag.toUpperCase(), ownerDocument: doc, children: [], attributes: {}, listeners: new Map(), open: false, disabled: false, textContent: '' });
  }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parent?.isConnected); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, handler) {
    super.addEventListener(type, handler);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { super.removeEventListener(type, handler); this.listeners.get(type)?.delete(handler); }
  focus() { if (this.isConnected && !this.disabled) this.ownerDocument.activeElement = this; }
  showModal() { if (this.ownerDocument.showError) throw this.ownerDocument.showError; this.open = true; }
  close() { if (this.open) { this.open = false; this.dispatchEvent(new Event('close')); } }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  closest() { return null; }
  querySelector() { return descendants(this).find(node => ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) && !node.disabled) || null; }
  getBoundingClientRect() { return { left: 100, top: 100, right: 580, bottom: 500 }; }
}
const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
const texts = element => [element, ...descendants(element)].map(node => node.textContent);
const button = (dialog, text) => descendants(dialog).find(node => node.tagName === 'BUTTON' && node.textContent === text);
const click = element => element.dispatchEvent(new Event('click'));
const listenerCount = element => [...element.listeners.values()].reduce((sum, set) => sum + set.size, 0);

function fixture(details = {}) {
  const doc = { createElement: tag => new Element(tag, doc) };
  doc.body = doc.createElement('body');
  doc.activeElement = doc.body;
  const parent = doc.createElement('dialog');
  const originalFocus = doc.createElement('button');
  originalFocus.textContent = 'Save changes';
  parent.append(originalFocus);
  doc.body.append(parent);
  parent.showModal();
  originalFocus.focus();
  const amount = { oldTotal: 10000, newTotal: 15000, paymentStatus: 'paid', ...details };
  const options = { document: doc, parentDialog: parent, money: value => `PHP ${(value / 100).toFixed(2)}` };
  return { doc, parent, originalFocus, amount, options,
    start() { this.pending = confirmOrderTotalChange(amount, options); this.dialog = doc.body.children.find(node => node !== parent); return this.pending; } };
}

test('custom modal labels both totals, explains paid status and focuses Keep editing', async () => {
  const f = fixture();
  f.start();
  assert.equal(f.dialog.open, true);
  assert.equal(f.parent.open, true);
  assert.equal(f.doc.activeElement, button(f.dialog, 'Keep editing'));
  const copy = texts(f.dialog);
  for (const expected of ['Confirm order changes', 'Current total', 'New total', 'PHP 100.00', 'PHP 150.00', 'Increase', 'PHP 50.00', 'Payment will remain Paid. Settle any difference directly with the customer.']) assert.ok(copy.includes(expected), expected);
  assert.equal(f.dialog.attributes['aria-labelledby'], descendants(f.dialog).find(node => node.tagName === 'H2').id);
  assert.ok(f.dialog.attributes['aria-describedby']);
  click(button(f.dialog, 'Confirm and save'));
  assert.equal(await f.pending, true);
  assert.equal(f.doc.activeElement, f.originalFocus);
  assert.equal(f.dialog.isConnected, false);
  assert.equal(listenerCount(f.parent), 0);
  assert.equal(listenerCount(f.dialog), 0);
});

for (const label of ['Keep editing', '×']) {
  test(`${label} cancels and preserves the parent edit form`, async () => {
    const f = fixture();
    const draft = f.doc.createElement('input');
    draft.value = 'Unsaved customer correction';
    f.parent.append(draft);
    f.start();
    click(button(f.dialog, label));
    assert.equal(await f.pending, false);
    assert.equal(f.parent.open, true);
    assert.equal(f.parent.children[1], draft);
    assert.equal(draft.value, 'Unsaved customer correction');
    assert.equal(f.doc.body.children.length, 1);
    assert.equal(listenerCount(f.parent), 0);
  });
}

test('Escape cancels once and cleans listeners before a subsequent click', async () => {
  const f = fixture();
  f.start();
  const event = new Event('cancel', { cancelable: true });
  f.dialog.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(await f.pending, false);
  click(button(f.dialog, 'Confirm and save'));
  assert.equal(await f.pending, false);
  for (const node of [f.dialog, ...descendants(f.dialog)]) assert.equal(listenerCount(node), 0);
});

test('clicking dialog padding keeps it open; clicking the backdrop cancels', async () => {
  const f = fixture();
  f.start();
  const eventAt = (x, y) => Object.assign(new Event('click'), { clientX: x, clientY: y });
  f.dialog.dispatchEvent(eventAt(101, 101));
  assert.equal(f.dialog.open, true);
  f.dialog.dispatchEvent(eventAt(20, 20));
  assert.equal(await f.pending, false);
});

test('an external close settles as cancellation and removes the popup', async () => {
  const f = fixture();
  f.start();
  f.dialog.close();
  assert.equal(await f.pending, false);
  assert.equal(f.dialog.isConnected, false);
  assert.equal(listenerCount(f.parent), 0);
});

test('closing the parent cancels without reopening or approving it', async () => {
  const f = fixture();
  f.start();
  f.parent.close();
  assert.equal(await f.pending, false);
  assert.equal(f.parent.open, false);
  assert.equal(f.dialog.isConnected, false);
});

test('a closed or detached parent never opens a confirmation', async () => {
  for (const mutation of [f => f.parent.close(), f => f.parent.remove()]) {
    const f = fixture();
    mutation(f);
    assert.equal(await confirmOrderTotalChange(f.amount, f.options), false);
    assert.equal(f.doc.body.children.some(node => node.className === 'order-edit-confirmation'), false);
  }
});

test('approval cannot succeed if the parent has become stale without firing close', async () => {
  const f = fixture();
  f.start();
  f.parent.open = false;
  click(button(f.dialog, 'Confirm and save'));
  assert.equal(await f.pending, false);
});

test('focus falls back inside the parent if the original Save button is disabled', async () => {
  const f = fixture();
  const fallback = f.doc.createElement('button');
  f.parent.append(fallback);
  f.originalFocus.disabled = true;
  f.start();
  click(button(f.dialog, 'Keep editing'));
  assert.equal(await f.pending, false);
  assert.equal(f.doc.activeElement, fallback);
});

test('a decrease uses a positive difference and unpaid orders omit paid instructions', async () => {
  const f = fixture({ newTotal: 0, paymentStatus: 'awaiting_payment' });
  f.start();
  const copy = texts(f.dialog);
  assert.ok(copy.includes('Decrease'));
  assert.ok(copy.includes('PHP 0.00'));
  assert.equal(copy.some(value => value.includes('Payment will remain')), false);
  click(button(f.dialog, 'Keep editing'));
  await f.pending;
});

test('formatted values are inserted only as text', async () => {
  const f = fixture();
  f.options.money = () => '<img src=x onerror=alert(1)>';
  f.start();
  assert.ok(texts(f.dialog).includes('<img src=x onerror=alert(1)>'));
  assert.equal(descendants(f.dialog).some(node => node.tagName === 'IMG'), false);
  click(button(f.dialog, 'Keep editing'));
  await f.pending;
});

test('showModal failure rejects and leaves no popup or listeners behind', async () => {
  const f = fixture();
  f.doc.showError = new Error('The popup could not open.');
  await assert.rejects(f.start(), /popup could not open/);
  assert.equal(f.doc.body.children.length, 1);
  assert.equal(listenerCount(f.parent), 0);
  assert.equal(f.doc.activeElement, f.originalFocus);
});

test('invalid totals reject without creating a popup', async () => {
  const f = fixture({ newTotal: NaN });
  await assert.rejects(f.start(), /totals are invalid/);
  assert.equal(f.doc.body.children.length, 1);
});
