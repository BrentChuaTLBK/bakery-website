# Personal vouchers and My Account

Reference: [Elio's voucher campaigns](https://github.com/PlayerBC/elio-website/blob/c2b2d0b/docs/VOUCHER-CAMPAIGNS.md) and its account UI. TLB keeps its own authentication, POS channels, newsletter consent, checkout, inventory and accounting contracts.

## Owner workflow

Open **Marketing → Automatic offers**. Create and save a draft, review the customer offer and the desktop/mobile/plain-text email preview, then edit the draft to activate it. Deployment creates no campaigns or vouchers and sends no emails. Existing completed website orders establish eligibility history only.

Campaigns support the first completed website order or each completed website order, fixed PHP or capped percentage discounts, minimum product spend, maximum issues per customer, and either days after issuance or one fixed Manila expiry. Campaign names, subjects and plain-text email copy are editable. `{{discount}}` inserts the amount in email copy. Issued vouchers and queued email text retain their saved terms when the campaign changes. Pausing stops future issuance.

**Only paid, completed website orders qualify. Pop-up POS and Direct Message orders never earn thank-you codes**, even when paid/completed or when a client email is recorded. A customer's first website order can still qualify after a POS/DM purchase. Refunds and cancelled source orders make an unused reward unavailable. Completion history and unique campaign/order identities prevent repeat rewards from status toggles.

## Customer experience

My Account uses TLB's locally hosted Chelsea Market and Lobster fonts, with order cards, a voucher wallet, account shortcuts and newsletter preferences. One voucher has a full card; multiple vouchers use compact rows with four per page and a details dialog. Available, reserved, used and expired/unavailable offers remain distinguishable.

Existing newsletter codes appear in the wallet without reissuing them or changing their expiry. A verified account is required. Signed-in rewards belong to the account that earned them; guest rewards require the verified email used on the original checkout. Signing up after a guest purchase does not reset first-order eligibility.

“Use at checkout” carries the code into the saved basket, removes it from the URL and leaves checkout to validate eligibility and calculate the actual discount. One personal code per order; delivery is excluded. Ordinary promo lifetime-use limits are unchanged. Personal welcome/thank-you codes release a cancelled or refunded redemption until their original expiry. An owner cannot undo a refund after the personal code has been reused on another retained order.

## Email and reporting

Voucher notifications are separate marketing emails. They queue only for locally subscribed recipients; local consent, consent version, account email, voucher expiry/source eligibility and Resend topic/global suppression are checked before delivery. A skipped email never deletes the voucher. Consent-bound unsubscribe tokens cannot revoke a later subscription. Sending uses TLB's existing paced worker, durable lease, retry limit and provider idempotency keys.

The owner preview and email worker share the same renderer. Previews use a sample code, inert links and a sandboxed iframe. Previewing issues no code and queues no email. Customer copy is escaped as plain text; required terms, expiry, account instructions and unsubscribe remain visible. Reports distinguish provider acceptance from confirmed delivery and report retained paid product sales net of discounts, excluding delivery, cancellations and refunds.

## Validation

- `node tests/backend/run.mjs`: existing order/POS/accounting/newsletter regression contracts.
- `node tests/backend/run.mjs --vouchers`: fresh-schema order and voucher contracts, including both excluded sales channels, idempotency, guest ownership, original newsletter codes, refunds/reuse, campaign revisions, consent-bound unsubscribe and permissions.
- `node --test tests/voucher-email.test.mjs`: email terms, links, escaping and invalid-input handling.
- `node tests/ui/vouchers.mjs`: local-only account/campaign fixtures at 1440, 768, 390 and 320 px, modal dismissal, pagination, previews and branded calendar.
- `node tests/edge/run.mjs`, `node scripts/test-unit.mjs` and `node scripts/build-static.mjs` cover delivery regressions, totals/exports and production assets.

The legacy backend tests intentionally replay old migrations; their schema reconstruction preserves new wallet dependencies or runs inside a rollback. Voucher contracts run separately against the complete installed schema.
