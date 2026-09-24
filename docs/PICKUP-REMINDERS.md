# Manual pickup reminders

Open **Orders**, choose a paid order marked **Ready for pickup**, and click
**Send pickup reminder** in its details. Owners and staff can use the button.
It is hidden for delivery, unpaid, preparing, completed, cancelled and refunded
orders. It does not change payment, fulfillment progress or stock.

The email says: “Just a friendly reminder that your order is ready and waiting
for pickup.” It includes the saved order reference, pickup address, opening
hours, pickup instructions, items and private order link. It uses the existing
order-email sender and delivery queue, independently of newsletter preferences
and the automatic fulfillment-day reminder setting.

The page distinguishes a queued reminder from a sent one. **Refresh status**
checks progress. Sent means accepted by the email provider, not guaranteed inbox
delivery. Requests appear in private order history and the Overview email panel.

Repeated clicks and retries share one request, and a pending reminder is reused
across staff members. Another reminder can be requested 15 minutes after the
previous request or send, whichever is later. Worker retries retain the exact
recipient, body and event key. Before sending, the worker checks that the order
is still paid, ready, pickup-only and unrefunded, with the same date, revision
and email address; changed orders are skipped.

Validation: `node tests/backend/run.mjs`, `node tests/edge/run.mjs`, and
`node tests/ui/pickup-reminder.mjs`. Browser tests use local fixtures with all
external requests blocked; the standard Playwright and browser environment
overrides in `tests/ui/README.md` apply.
