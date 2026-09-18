let nextConfirmationId = 0;

const defaultMoney = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);

// This second modal leaves the edit form mounted so cancelling preserves the draft.
export function confirmOrderTotalChange({ oldTotal, newTotal, paymentStatus }, { money = defaultMoney, parentDialog, document: doc = globalThis.document } = {}) {
  if (parentDialog && (!parentDialog.open || !parentDialog.isConnected)) return Promise.resolve(false);
  if (![oldTotal, newTotal].every(value => Number.isSafeInteger(value) && value >= 0)) {
    return Promise.reject(new Error('The order totals are invalid. Check the order again before saving.'));
  }

  return new Promise((resolve, reject) => {
    const originalFocus = doc.activeElement;
    const dialog = doc.createElement('dialog');
    const id = `order-edit-confirmation-${++nextConfirmationId}`;
    dialog.className = 'order-edit-confirmation';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.setAttribute('aria-describedby', `${id}-description`);

    const make = (tag, className, text) => {
      const element = doc.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const shell = make('div', 'order-edit-confirmation__shell');
    const header = make('div', 'order-edit-confirmation__header');
    const title = make('h2', '', 'Confirm order changes');
    title.id = `${id}-title`;
    const close = make('button', 'order-edit-confirmation__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Keep editing');
    header.append(title, close);
    const description = make('p', 'order-edit-confirmation__description', 'Your changes update the order total. Review the amounts before saving.');
    description.id = `${id}-description`;
    const totals = make('dl', 'order-edit-confirmation__totals');
    for (const [label, value, className] of [['Current total', oldTotal, ''], ['New total', newTotal, 'order-edit-confirmation__new-total']]) {
      const amount = make('div', className);
      amount.append(make('dt', '', label), make('dd', '', money(value)));
      totals.append(amount);
    }
    const difference = newTotal - oldTotal;
    const differenceRow = make('p', 'order-edit-confirmation__difference');
    differenceRow.append(make('span', '', difference > 0 ? 'Increase' : difference < 0 ? 'Decrease' : 'Difference'), make('strong', '', money(Math.abs(difference))));
    shell.append(header, description, totals, differenceRow);
    if (paymentStatus === 'paid') {
      shell.append(make('p', 'order-edit-confirmation__payment', 'Payment will remain Paid. Settle any difference directly with the customer.'));
    }
    const actions = make('div', 'order-edit-confirmation__actions');
    const cancel = make('button', 'button button-secondary', 'Keep editing');
    cancel.type = 'button';
    cancel.autofocus = true;
    const approve = make('button', 'button', 'Confirm and save');
    approve.type = 'button';
    actions.append(cancel, approve);
    shell.append(actions);
    dialog.append(shell);

    let settled = false;
    const listeners = [];
    const listen = (element, type, handler) => {
      element.addEventListener(type, handler);
      listeners.push(() => element.removeEventListener(type, handler));
    };
    const finish = (approved, error) => {
      if (settled) return;
      settled = true;
      const parentAvailable = !parentDialog || (parentDialog.open && parentDialog.isConnected);
      listeners.forEach(remove => remove());
      if (dialog.open) dialog.close();
      dialog.remove();
      // The save handler can temporarily disable the original button.
      // In that case keep keyboard focus in the still-open edit dialog.
      try {
        if (parentAvailable && originalFocus?.isConnected && !originalFocus.disabled && !originalFocus.closest?.('[inert]')) {
          originalFocus.focus({ preventScroll: true });
        }
        if (parentDialog?.open && parentDialog.isConnected && !parentDialog.contains(doc.activeElement)) {
          const fallback = parentDialog.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
          (fallback || parentDialog).focus({ preventScroll: true });
        }
      } catch { /* A focus change must not leave the save promise pending. */ }
      if (error) reject(error);
      else resolve(approved === true && parentAvailable);
    };
    listen(cancel, 'click', () => finish(false));
    listen(close, 'click', () => finish(false));
    listen(approve, 'click', () => finish(true));
    listen(dialog, 'cancel', event => { event.preventDefault(); finish(false); });
    listen(dialog, 'close', () => finish(false));
    listen(dialog, 'click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) finish(false);
    });
    if (parentDialog) listen(parentDialog, 'close', () => finish(false));
    try {
      doc.body.append(dialog);
      dialog.showModal();
      cancel.focus({ preventScroll: true });
    } catch (error) {
      finish(false, error);
    }
  });
}
