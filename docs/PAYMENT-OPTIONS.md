# Customer payment options

The payment panel shows the available methods as selectable choices. Customers can copy the account name, account/mobile number and exact amount independently, then upload their receipt through the existing payment-proof form. Changing the choice does not submit payment or clear the receipt/reference fields. If browser clipboard permission is denied, the selected text remains available for manual copying.

Under **Shop settings → Payment options**, owners can add up to 20 methods, edit their account details, reorder them, remove them, or turn off **Show this payment option**. Expand a method to edit it; the other rows stay compact. Each method has an optional note, and a shared note applies to all methods. **Save shop settings** publishes the changes. At least one method must be visible while new orders are open.

Accounts are stored as strings so leading zeros remain intact. Structured payment details are validated on the server and protected against stale edits from another window. Removing a method affects future orders. Existing orders retain the payment-account snapshot and instructions they received at checkout.

The migration conservatively converts existing instructions only when they match the established three-line method/account-name/number format. Unrecognized legacy instructions remain intact. Legacy order pages recognize that same format for the new copy controls, without substituting current bank details. New orders also store structured options. The server regenerates the plain-text payment instructions from enabled options and notes for the existing email renderer and older pages. No email-worker deployment or test email send is required.

Verification includes backend permission, validation, account snapshot, email outbox, leading-zero and concurrency tests; unit tests for legacy parsing and escaping; and real browser fixtures at 1440, 390 and 320 px for copying, clipboard denial, switching methods, proof upload, saved settings, adding a fourth method and staff restrictions. Tests use dummy payment details and send no live payments or emails.
