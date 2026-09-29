# Optional owner date-override reason

Direct orders can be created and edited with the owner date override enabled and no reason. Omitted, null, empty, whitespace-only and one-character reasons are accepted. A supplied reason still has a 500-character maximum; owner authorization, inventory and fulfillment restrictions remain in place.

The field is labelled **Reason for override · optional**. This change applies to the date override, not other order actions that request a reason.

Validation: 380 backend checks passed after applying 68 migrations, including creation without a reason and edits to unpaid/paid orders. The POS browser suite passed for owners at 1440, 820, 390 and 320px and staff at 320px; it verifies blank-reason creation/editing and the optional label. Static build passed for 23 pages.

The `optional_date_override_reason` migration is deployed and verified in production. Existing pages already allow an empty input, so the backend change permits saving immediately. The label/cache-version update requires the frontend merge. No production orders or products were modified by this change.
