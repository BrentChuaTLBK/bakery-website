# Courier tracking

Staff and owners can paste an optional HTTPS courier tracking link in a delivery
order's customer/delivery details. Pickup orders do not expose or accept a link.
The field uses the existing revision-checked order edit and its audit history.
It never changes the saved items, totals, payment status or fulfillment status.

## Customer workflow

1. Save the link before dispatch. The private order page shows it immediately;
   this first save does not send an email.
2. Mark the order Out for delivery. That email includes the saved tracking link.
3. If the order is already out for delivery, saving its first link sends a tracking
   update. Replacing an existing link on an active delivery order also sends an
   update. Clearing an existing link explains that tracking is temporarily unavailable.

Saving the same normalized link does not create another notification. Cancelled,
expired, completed and refund-labelled orders do not send tracking updates.
The existing email sender runs every minute; provider delivery and queues may
take longer. An unattempted pending dispatch/update can absorb the latest link.
Previously attempted or sent payloads stay immutable for safe provider retries.

## Implementation

`delivery_tracking_url` is stored in the existing order data and is only writable
through staff order edits. The private, authorized order response includes the
latest saved value. Checkout cannot inject it, and the public catalog never
includes it. Validation rejects non-HTTPS URLs, credentials, whitespace/control
characters, invalid types and links over 2,048 characters. Rendering also checks
URLs and uses external-link protections.

Deploy the updated email-worker before applying
`20260926041959_delivery_tracking_links.sql`. The migration preserves the current
order, accounting and email functions through checked patch anchors. It sends no
mail by itself. Website source arrives through the existing main-branch release.

Validation covers staff/owner editing, customer access boundaries, pickup orders,
first links, replacements/removal, idempotency/revisions, queue coalescing, frozen
attempts, current customer links, and email HTML/plaintext. Existing email output
without a tracking link is checked against 44 pre-change hashes.
