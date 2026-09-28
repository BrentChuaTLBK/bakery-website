# Pickup and delivery calendar

Open **Calendar** in the dashboard sidebar, or **Order calendar** from Overview. The calendar follows Elio's layout: green pickups, blue deliveries grouped by saved delivery area, and gray completed orders. Staff can browse months, jump to a date with the shop's calendar control, switch to a month agenda, search/filter, copy client or fulfillment details, and open the saved order.

Only paid orders with Confirmed, Preparing, Ready for pickup, Out for delivery or Completed fulfillment status appear. Website and direct-message orders are included; in-person counter sales, unpaid orders, cancelled/expired orders and refund-labelled orders are excluded. Completed orders stay on their original dates. Custom direct-order descriptions and saved flavor selections appear with item quantities and totals.

The dashboard is the schedule authority. Editing an order updates its date, details and amount in the calendar. Google Calendar changes never change orders, stock, payments or accounting. The dashboard refreshes every 15 seconds while visible and stops when leaving the view.

## Google Calendar

The owner configures a separate private **TLB Orders** calendar using **Google Calendar connection**. Share that calendar with the displayed service-account email using **Make changes to events**, enable Google Calendar API in that account's Cloud project, and paste the calendar ID or embed link. Credentials remain in Supabase secrets; `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` takes precedence over `GA_SERVICE_ACCOUNT_JSON`. No credentials are returned to the browser.

Events are private all-day entries on the fulfillment date, with pickup/delivery colors and gray completed events. Customer name, phone, social media, order reference, items/options and total appear in summaries; delivery summaries also include the address and any different recipient contact or delivery instructions. Customer order-access links, payment proofs, bank details and private staff notes are excluded. No attendees or Google email notifications are added. The owner explicitly approved these fields for the separate TLB calendar.

Order changes enter a durable queue. A Vault-authenticated worker wakes after changes and every minute, including while the dashboard is closed. Failed updates retry with capped backoff. Pending counts, connection errors and the last successful run are visible; **Sync now** requests another attempt. Stable event IDs, revision acknowledgements and expiring worker leases prevent duplicate events and preserve changes made while a sync is running. Cancellation, refunds and deletions leave tombstones until their managed Google events are removed. Unrelated Google events are never modified. Reconnecting to a different calendar requires a deliberate migration so events cannot be accidentally copied elsewhere.

The scheduler migration uses existing hosted pg_cron/pg_net installations when present. Its hosted setup is skipped in the isolated test database, which does not provide Vault. The production worker validates its Vault credential; owner connection actions independently validate Supabase Auth and current verified owner membership.

## Validation

- Calendar unit/Edge tests cover summaries, colors, custom items and flavors, private event fields, OAuth scope, cursor reset, duplicate recovery, ownership checks, removal, retries, connection-check cleanup and rejected anonymous/non-owner requests.
- Backend tests cover verified staff access, owner configuration, private service privileges, stock/payment-preserving schedule snapshots, lease concurrency, direct-order edits, completed orders, refunds, cancellation, deletion and excluded counter sales.
- Browser checks cover desktop and mobile calendar/filter/copy flows, branded date selection, completed counts, polling cleanup and no horizontal overflow.

Google API access and delivery are verified separately against the configured calendar; mocked tests alone do not prove live synchronization.
