# Unserved order backups

The owner's **Settings → Backups** page downloads Excel, JSON or a ZIP with proof images without a Google connection. The default includes paid website/direct-message orders awaiting fulfillment and orders whose payment is under review, including pending confirmation. Review status is preserved, never treated as a payment approval. The optional download scope includes all unserved website/direct-message orders, including unpaid orders. Overdue orders remain included. Completed, cancelled, expired and refunded orders are excluded.

## Automatic copy

A Supabase Cron job checks every five minutes. It invokes `order-backup` only when data changed, a previous attempt failed, or a daily refresh is due. Order, payment, delivery-payment, history and allocation changes increment a small revision counter. No dashboard, browser session or assistant is needed.

The Google spreadsheet and companion ZIP are user-owned and shared privately with the existing Google service account as Editor. Both live in the owner's selected backup folder. The worker uses `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON`, falling back to `GA_SERVICE_ACCOUNT_JSON`, with Sheets and Drive OAuth scopes. Enable **Google Sheets API** and **Google Drive API** in that service account's Cloud project. The browser never receives the private key. The worker can access only files shared with its service account; it updates the configured file IDs and does not search Drive or create files. User ownership avoids service-account My Drive storage-quota restrictions.

The managed tabs are `Orders`, `Items` and `Recovery`. Other tabs are untouched. Do not rename managed tabs. The spreadsheet is a copy; edits do not flow back into website orders. Its three tabs are updated in one atomic batch, including clearing rows for completed orders. Before writing, the worker downloads and validates all referenced proofs and creates a complete ZIP with matching order JSON. A missing/invalid proof prevents both updates. It then uploads the ZIP using a resumable replacement, checks Google's byte count and SHA-256 checksum, and writes the sheet. If the sheet fails after the ZIP succeeds, the ZIP is still a complete snapshot; the status remains failed and retries. There is no cross-file transaction. Leases prevent overlapping workers, and acknowledging one revision cannot acknowledge a later order edit.

Unchanged runs do not download images. Changed runs and the daily refresh copy attached images again. The current bounded implementation supports 5 MiB per image, 45 MiB of images and a 50 MiB ZIP, with a 60-second image-fetch budget. It fails explicitly instead of publishing a partial archive. Watch the Backups status as order volume grows.

The UI displays the last successful copy separately from the last error. A configured connection is not proof that copying succeeded: verify `last_success_at`, the order count and the destination contents. The five-minute interval is a target, not a guaranteed recovery point during provider outages.

## Coverage

- Order IDs, references, source, fulfillment/payment statuses, dates, customer/contact/address details, items/flavors, current totals, discounts, delivery fees and order data.
- Payment records, separate delivery-payment records, website inventory reservations and order history.
- Recovery data contains complete JSON chunks per order. Chunking respects Unicode boundaries and Excel cell-size limits. Customer text is stored literally, never executed as a spreadsheet formula.
- Current order proof plus proofs attached to product-payment and separate delivery-payment records, deduplicated by path. Actual original image bytes are in the ZIP, under `proofs/ORDER-REFERENCE/ORDER-ID-FILENAME`. `orders.json` maps each image to its order ID/reference and includes its source path, size and SHA-256 checksum. The sheet lists these filenames and the ZIP link. Excel and standalone JSON contain paths only.
- No customer access tokens, encrypted access credentials, refresh tokens or request idempotency keys.

This is an operational recovery copy, not a full database backup. Keep Supabase daily backups enabled for full database history and relationships. Google Calendar remains a useful fulfillment fallback but does not preserve the full recovery records above. Completed orders and their proof images leave the current spreadsheet and ZIP on the next successful sync. This does not guarantee erasure from Google's file/revision history.

## Recovery procedure

1. Preserve the last good spreadsheet/download before changing anything. During an outage use `Orders` and `Items` to continue fulfillment.
2. Prefer the JSON download for technical recovery. From Excel/Sheets, group `Recovery` rows by Order ID, sort by Part and join Order JSON chunks. `recoverBackupRows` validates missing/duplicate chunks and order identities.
3. Restore the full Supabase database backup into an isolated environment first. Reconcile active-order snapshots against existing IDs and references. Never blindly insert duplicates into production or replay order history/outbox events.
4. Reconcile paid totals, fulfillment states, discounts, delivery payments and inventory reservations. Reissue customer access links through an authorized workflow if needed. Restore payment-proof files from the ZIP using the original `source_path` in its manifest; verify SHA-256 checksums first.
5. Review the reconciliation before applying production recovery. The admin feature intentionally has no one-click restore that could overwrite live orders or send duplicate emails.

## Validation

Local coverage: `tests/backend/99-order-backups.test.mjs`, `tests/edge/order-backup.test.mjs`, and `tests/ui/backups.mjs`. Browser tests cover 1440px and 390px owner views, staff exclusion, all three download formats and error recovery. Export testing reloads an XLSX and reconstructs long Unicode recovery data exactly. ZIP tests use an independent JSZip reader with CRC checking, verify exact fixture image bytes, order labels, duplicate paths, invalid/missing images, empty snapshots, owner-only downloads and failed Drive uploads. Set `ZIP_PACKAGE_ROOT` to the directory containing the test-only `jszip` package. It is not a runtime dependency.

Deployment verification must additionally check private Drive sharing, a successful worker response, matching live order counts/recovery rows, and a scheduled retry or unchanged-data skip. A disabled Sheets API is a setup blocker, not a successful backup.
