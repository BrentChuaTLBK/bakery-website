# Branded dialogs and calendars

In-page confirmations use `assets/ordering/site-dialog.js` and its shared stylesheet. Academy, accounting, galleries, event packages, slideshows and catalog rearranging use action-specific labels instead of browser OK/Cancel dialogs.

`await confirmDialog(message, { title, confirmLabel, cancelLabel, danger, parentDialog })` resolves to a boolean. Cancel, Escape and the close button keep the existing draft. Backdrop clicks do not dismiss the dialog. Keyboard focus and editor/page scroll are restored without rerendering the editor. A closed or removed parent cancels a pending action; overlapping requests cannot approve each other. Messages are rendered as text.

The existing branded date picker now covers Academy batch dates, analytics dates, order filters, order fulfillment edits and promo expiry, alongside accounting. Optional dates can be cleared. Required fields and date bounds are checked before submission. Promo expiry uses a branded day picker and hour/minute selectors while retaining the existing Manila local timestamp format. The existing customer fulfillment calendar and production/closure calendars remain in use.

Browser-controlled warnings when closing/reloading a tab with unsaved changes remain native: browsers do not permit websites to style those warnings. File selection and print dialogs are also controlled by the browser/operating system.

No schema, permissions, order calculations or email changes are required for this release.
