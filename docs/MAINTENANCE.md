# Website maintenance

Owners manage maintenance from **Dashboard → Settings → Maintenance**. This adapts the maintenance system in Elio (`29e33aa`) to TLB's ordering functions and branding. The initial setting is **Off**.

## Controls

- **Off:** the website is open, subject to the independent “Pause new orders” setting in Shop settings.
- **On now:** starts immediately and stays on until an owner turns it off. Planned end times are informational in this mode.
- **Scheduled:** starts and ends automatically at the selected Manila times. No cron job or open dashboard is required. Completed schedules remain visible for reference.
- **Announcement:** shows the message and planned dates without requiring closure. Dates are required; the banner disappears after the planned end.
- **Pause payment-proof uploads:** blocks both upload authorization and receipt submission during closure. Turn it off for visual maintenance that can safely allow uploads.

The admin status refreshes every 30 seconds and at schedule boundaries. Updates do not replace unsaved fields or silently advance their revision. Concurrent changes require a refresh. Leaving the section stops its polling.

## Customers and staff

The branded maintenance screen covers public browsing and new checkout. Scheduled closures show a countdown based on server time. Reopening is verified with the server; a connection failure keeps the existing closure screen visible and retries. Manual closures do not invent a reopening time.

Account, contact, privacy, newsletter preferences, FAQs and private order links remain accessible. The team dashboard, recipe tools and staff POS/direct-order creation remain available. New website quotes and orders are blocked by the database, even if a customer bypasses the screen. Retrying an already-created order with its idempotency key still returns that order.

Existing payment and delivery-proof screens display a pause notice and return to the upload form when maintenance ends. An order under review stays under review. This feature does not alter order totals, payment records, inventory rules or notification settings.

## Protected payment time

Historical pause windows are retained. Only elapsed periods with uploads paused extend the original payment deadline. Overlapping periods count once; time before an order was created does not count. Already-expired deadlines stay expired. Direct orders without deadlines continue to have no deadline.

For example, if an order has eight minutes left when a two-hour upload pause begins, it still has eight minutes when uploads resume. Changing the announcement does not restart the pause. Turning uploads back on closes the elapsed pause window.

`payment_deadline` in order responses includes any extension. `payment_seconds_remaining` is supplied during an upload pause; outside a pause the deadline is the source of truth. The public status endpoint supplies the server clock for the maintenance countdown.

## Database and operational limits

Migration `20260930091747_website_maintenance.sql` adds two private RLS tables (`website_maintenance`, `maintenance_windows`) and three private helpers, then patches existing order, expiry and proof handlers using checked anchors. Only owners can read or update maintenance settings through the RPC. Public status contains no staff identifiers. Status polls bypass the order write lock and order-expiry work.

This is application-level maintenance on a static website. It is not an HTTP 503 response, a firewall, or protection for already-public static files. A total database outage prevents status lookup; customers who have not yet received a maintenance response may still see the static website. Checkout still requires the backend. Infrastructure outages need hosting/provider controls.

Production smoke tests must run in a rolled-back transaction; do not activate a customer-facing maintenance window merely to test deployment.

## Regression commands

`node tests/backend/run.mjs --maintenance` covers permissions, stale revisions, validation, manual and scheduled windows, idempotency, both proof stages, direct-order delivery receipts, independent shop pause, expiry and overlapping pauses.

Browser suites use local fixtures and block external requests:

- `node tests/ui/maintenance-countdown.mjs`: countdown, connection loss, reopening, banner, private links and 320/390/768/1440px layouts.
- `node tests/ui/maintenance-admin-status.mjs`: current/completed status, polling, retained edits, conflicts and cleanup.
- `node tests/ui/maintenance-integration.mjs`: actual dashboard navigation/save and website/direct-order proof screens.

The recipe loading update is checked by `tests/ui/recipe-startup.mjs` and `tests/ui/recipes.mjs`, including failure/retry, reduced motion, mobile layouts and permission boundaries.

## Verified release — 30 September 2026

The isolated regression passed 252 unit tests, 388 existing backend checks, 37 voucher checks, 25 operations checks and 7 maintenance checks across 78 migrations. Browser validation passed the three maintenance suites, checkout feedback, 9 recipe-startup scenarios and 24 recipe workflows. The static build produced 24 pages; all changed relative imports resolved.

The migration was applied to TLB production with maintenance **Off**. A rolled-back smoke test verified owner save, public status, new-order quote blocking, upload authorization, receipt submission and anonymous settings denial. After rollback, maintenance was still off and no test windows remained. No customer-facing closure was activated.

Two adaptation fixes have dedicated regression assertions: saving manual mode returns its active state immediately, and an ended schedule resumes normal 30-second polling instead of remaining on five-second reopening retries.
