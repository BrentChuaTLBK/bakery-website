# Unserved order backups

The owner's **Settings → Backups** page downloads Excel or JSON without a Google connection. The default is paid, confirmed website/direct-message orders awaiting fulfillment. The optional download scope includes all unserved website/direct-message orders, including unpaid orders. Overdue orders remain included. Completed, cancelled, expired and refunded orders are excluded.

## Automatic copy

A Supabase Cron job checks every five minutes. It invokes `order-backup` only when data changed, a previous attempt failed, or a daily refresh is due. Order, payment, delivery-payment, history and allocation changes increment a small revision counter. No dashboard, browser session or assistant is needed.

The Google spreadsheet is user-owned and shared privately with the existing Google service account as Editor. The worker uses `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON`, falling back to `GA_SERVICE_ACCOUNT_JSON`, with the Sheets OAuth scope. Enable **Google Sheets API** in that service account's Cloud project. The application never receives the private key.

The managed tabs are `Orders`, `Items` and `Recovery`. Other tabs are untouched. Do not rename managed tabs. The spreadsheet is a copy; edits do not flow back into website orders. Its three tabs are updated in one atomic batch, including clearing rows for completed orders. Invalid writes leave the previous successful copy in place. Leases prevent overlapping workers, and acknowledging one revision cannot acknowledge a later order edit. Failed attempts remain pending and retry.

The UI displays the last successful copy separately from the last error. A configured connection is not proof that copying succeeded: verify `last_success_at`, the order count and the destination contents. The five-minute interval is a target, not a guaranteed recovery point during provider outages.

## Coverage

- Order IDs, references, source, fulfillment/payment statuses, dates, customer/contact/address details, items/flavors, current totals, discounts, delivery fees and order data.
- Payment records, separate delivery-payment records, website inventory reservations and order history.
- Recovery data contains complete JSON chunks per order. Chunking respects Unicode boundaries and Excel cell-size limits. Customer text is stored literally, never executed as a spreadsheet formula.
- Payment-proof **paths**, not the image files. Storage object backups need a separate process.
- No customer access tokens, encrypted access credentials, refresh tokens or request idempotency keys.

This is an operational recovery copy, not a full database backup. Keep Supabase daily backups enabled for full database history and relationships. Google Calendar remains a useful fulfillment fallback but does not preserve the full recovery records above. Removing a completed order from the active sheet does not guarantee erasure from Google revision history.

## Recovery procedure

1. Preserve the last good spreadsheet/download before changing anything. During an outage use `Orders` and `Items` to continue fulfillment.
2. Prefer the JSON download for technical recovery. From Excel/Sheets, group `Recovery` rows by Order ID, sort by Part and join Order JSON chunks. `recoverBackupRows` validates missing/duplicate chunks and order identities.
3. Restore the full Supabase database backup into an isolated environment first. Reconcile active-order snapshots against existing IDs and references. Never blindly insert duplicates into production or replay order history/outbox events.
4. Reconcile paid totals, fulfillment states, discounts, delivery payments and inventory reservations. Reissue customer access links through an authorized workflow if needed. Restore payment-proof files from their separate storage backup.
5. Review the reconciliation before applying production recovery. The admin feature intentionally has no one-click restore that could overwrite live orders or send duplicate emails.

## Validation

Local coverage: `tests/backend/99-order-backups.test.mjs`, `tests/edge/order-backup.test.mjs`, and `tests/ui/backups.mjs`. Browser tests cover 1440px and 390px owner views, staff exclusion, both download formats and error recovery. Export testing reloads an XLSX and reconstructs long Unicode recovery data exactly.

Deployment verification must additionally check private Drive sharing, a successful worker response, matching live order counts/recovery rows, and a scheduled retry or unchanged-data skip. A disabled Sheets API is a setup blocker, not a successful backup.
