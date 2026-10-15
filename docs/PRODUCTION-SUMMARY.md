# Production summary

Open **Production summary** in the dashboard's daily-work navigation, or `manage.html#production`. Owners and active, verified staff can read the report.

Choose one fulfillment date or an inclusive range of up to 366 days using the shared TLBK calendar. Today, Tomorrow and Next 7 days use Manila dates. View summary applies the chosen period; Refresh reloads its orders.

The report groups paid website and direct/POS orders by product and saved configuration, or by fulfillment day. Remaining, Completed and Total are separate. Pickup/delivery, source, status and product/flavor search narrow the report. Earlier overdue paid work has its own notice and is included only when selected; its original fulfillment date is retained. Cancelled, expired, refunded and pop-up counter orders do not count as production.

Saved item quantities are authoritative, including one-unit POS sales. Saved option quantities are multiplied by the ordered quantity: two boxes with three chocolate selections per box contribute six chocolate selections and two sellable units. Physical units and recipe yields are not inferred from product names. Custom items remain separate by order, and incomplete legacy options are flagged for review instead of estimated.

Each product/day opens read-only order details. CSV exports include the selected days, configurations, remaining/completed/total quantities and order references. Print includes the applied date period and filters. Loading or failed requests clear old totals and disable report export/printing, and stale responses cannot overwrite a newer selection.

## Data access and rollout

`shop_api('admin_production', {from, to})` delegates to private `tlb.admin_production(jsonb)`. It returns safe saved snapshots for the entire selected range plus earlier overdue paid orders, independently of the dashboard's order list. It returns only the customer's name and preparation details; access tokens, payment proofs and unrelated customer contact data are not included. The read dispatch happens before the gateway's expiry/maintenance writes.

Apply `supabase/migrations/20261015090255_admin_production_summary.sql` before releasing the frontend. This PR does not deploy that migration. Without it, the report shows an unavailable message and offers Refresh.

The shared date-picker positioning uses the document viewport width so right-hand date fields stay on screen on phones. The separately included product-management styles improve phone cards and controls while retaining existing edit, duplicate, delete-confirmation and staff-permission behavior.

## Checks

- `node --test tests/production-summary.test.mjs tests/date-calendar.test.mjs`
- `node tests/backend/run.mjs` with the existing PGlite test dependency
- `node tests/ui/production-summary.mjs`
- `node tests/ui/product-management-mobile.mjs`
- `node scripts/build-static.mjs --preview`

Browser checks use synthetic API responses and local assets, with external requests blocked. They create no live orders.
