let pendingConfirmation = false;
let nextDialogId = 0;

function loadStyles(doc) {
  const stylesheet = new URL('./site-dialog.css', import.meta.url);
  stylesheet.search = new URL(import.meta.url).search;
  const href = stylesheet.href;
  let link = [...doc.querySelectorAll('link[rel="stylesheet"]')].find(item => item.href === href);
  if (link?.sheet) return Promise.resolve(true);
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
  }
  return new Promise(resolve => {
    let timer;
    const finish = loaded => {
      clearTimeout(timer);
      link.removeEventListener('load', onLoad);
      link.removeEventListener('error', onError);
      resolve(loaded);
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    link.addEventListener('load', onLoad);
    link.addEventListener('error', onError);
    timer = setTimeout(onError, 8000);
    if (!link.isConnected) doc.head.append(link);
  });
}

function rememberScroll(doc, focus, parent) {
  const positions = new Map();
  for (const start of [focus, parent, doc.scrollingElement]) {
    for (let element = start; element; element = element.parentElement) {
      if (!positions.has(element)) positions.set(element, [element.scrollLeft, element.scrollTop]);
    }
  }
  const win = doc.defaultView;
  const windowPosition = [win.scrollX, win.scrollY];
  return () => {
    for (const [element, [left, top]] of positions) {
      if (element.isConnected && (element.scrollLeft !== left || element.scrollTop !== top)) {
        element.scrollTo({ left, top, behavior: 'instant' });
      }
    }
    if (win.scrollX !== windowPosition[0] || win.scrollY !== windowPosition[1]) {
      win.scrollTo({ left: windowPosition[0], top: windowPosition[1], behavior: 'instant' });
    }
  };
}

// A confirmation leaves its editor mounted. Concurrent requests and stale editors
// cancel safely instead of applying an action to a different view or draft.
export async function confirmDialog(message, {
  title = 'Please confirm',
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  danger = false,
  parentDialog,
} = {}) {
  if (pendingConfirmation) return false;
  const doc = globalThis.document;
  if (!doc?.body) return false;
  const originalFocus = doc.activeElement;
  const parent = parentDialog === undefined ? originalFocus?.closest?.('dialog[open]') : parentDialog;
  let parentInvalidated = false;
  let parentObserver;
  const invalidateParent = () => { parentInvalidated = true; };
  const inspectParentChanges = records => {
    if (records.some(record => (record.target === parent && record.attributeName === 'open' && record.oldValue !== null)
      || [...record.removedNodes].some(node => node === parent || node.contains?.(parent)))) invalidateParent();
  };
  const parentAvailable = () => {
    if (parentObserver) inspectParentChanges(parentObserver.takeRecords());
    return !parent || (!parentInvalidated && parent.open && parent.isConnected);
  };
  if (!parentAvailable()) return false;
  pendingConfirmation = true;
  // Watch from the start, including the first stylesheet load. Closing and
  // reopening an editor must not revive an earlier pending confirmation.
  if (parent) {
    parent.addEventListener('close', invalidateParent);
    parentObserver = new MutationObserver(inspectParentChanges);
    parentObserver.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });
  }
  try {
    if (!await loadStyles(doc) || !parentAvailable()) return false;
    return await new Promise(resolve => {
      const restoreScroll = rememberScroll(doc, originalFocus, parent);
      const dialog = doc.createElement('dialog');
      const id = `site-dialog-${++nextDialogId}`;
      dialog.className = 'site-dialog';
      dialog.setAttribute('aria-labelledby', `${id}-title`);
      dialog.setAttribute('aria-describedby', `${id}-description`);
      dialog.setAttribute('closedby', 'closerequest');
      const make = (tag, className, text) => {
        const element = doc.createElement(tag);
        element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
      };
      const shell = make('div', 'site-dialog__shell');
      const header = make('div', 'site-dialog__header');
      const heading = make('h2', 'site-dialog__title', title);
      heading.id = `${id}-title`;
      const close = make('button', 'site-dialog__close', '\u00d7');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close confirmation');
      const eyebrow = make('p', 'site-dialog__eyebrow', 'The Little Baker Kitchen');
      const description = make('p', 'site-dialog__description', message);
      description.id = `${id}-description`;
      const actions = make('div', 'site-dialog__actions');
      const cancel = make('button', 'site-dialog__button site-dialog__button--cancel', cancelLabel);
      cancel.type = 'button';
      cancel.autofocus = true;
      const approve = make('button', `site-dialog__button site-dialog__button--confirm${danger ? ' site-dialog__button--danger' : ''}`, confirmLabel);
      approve.type = 'button';
      header.append(heading, close);
      actions.append(cancel, approve);
      shell.append(eyebrow, header, description, actions);
      dialog.append(shell);

      const root = doc.documentElement;
      const oldOverflow = [root.style.getPropertyValue('overflow'), root.style.getPropertyPriority('overflow')];
      const oldGutter = [root.style.getPropertyValue('scrollbar-gutter'), root.style.getPropertyPriority('scrollbar-gutter')];
      let settled = false;
      let observer;
      const cleanups = [];
      const listen = (target, type, handler) => {
        target.addEventListener(type, handler);
        cleanups.push(() => target.removeEventListener(type, handler));
      };
      const finish = approved => {
        if (settled) return;
        settled = true;
        const available = parentAvailable();
        observer?.disconnect();
        cleanups.forEach(remove => remove());
        if (dialog.open) dialog.close();
        dialog.remove();
        root.style.setProperty('overflow', ...oldOverflow);
        root.style.setProperty('scrollbar-gutter', ...oldGutter);
        try {
          if (available && originalFocus?.isConnected && !originalFocus.disabled && !originalFocus.closest('[inert]')) {
            originalFocus.focus({ preventScroll: true });
          }
          if (parent?.open && parent.isConnected && !parent.contains(doc.activeElement)) {
            const fallback = parent.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
            (fallback || parent).focus({ preventScroll: true });
          }
        } catch { /* Focus must never prevent resolution. */ }
        restoreScroll();
        resolve(approved === true && available);
      };
      listen(cancel, 'click', () => finish(false));
      listen(close, 'click', () => finish(false));
      listen(approve, 'click', () => finish(true));
      listen(dialog, 'cancel', event => { event.preventDefault(); finish(false); });
      listen(dialog, 'close', () => finish(false));
      // Keep tab navigation inside the three actions, including browsers that
      // otherwise let the last native-dialog tab stop move into browser chrome.
      listen(dialog, 'keydown', event => {
        if (event.key !== 'Tab') return;
        if (event.shiftKey && doc.activeElement === close) {
          event.preventDefault();
          approve.focus({ preventScroll: true });
        } else if (!event.shiftKey && doc.activeElement === approve) {
          event.preventDefault();
          close.focus({ preventScroll: true });
        }
      });
      if (parent) listen(parent, 'close', () => finish(false));
      try {
        root.style.setProperty('scrollbar-gutter', 'stable');
        root.style.setProperty('overflow', 'hidden');
        doc.body.append(dialog);
        dialog.showModal();
        cancel.focus({ preventScroll: true });
        restoreScroll();
        observer = new MutationObserver(() => {
          if (!dialog.isConnected || !dialog.open || !parentAvailable()) finish(false);
        });
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
      } catch {
        finish(false);
      }
    });
  } finally {
    parentObserver?.disconnect();
    parent?.removeEventListener('close', invalidateParent);
    pendingConfirmation = false;
  }
}
