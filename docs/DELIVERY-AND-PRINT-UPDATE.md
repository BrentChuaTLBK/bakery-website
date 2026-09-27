# Delivery accounting and compact order slips

Delivery fees and courier costs now appear under one **Delivery** category. Fees are sales/income; costs are expenses. The Excel export creates one Delivery worksheet with separate income and expense tables. Manual delivery entries can use the same category with either type.

The migration retains the fee category’s stable ID and internal system key, and keeps the former cost category as a hidden alias. Existing manual Delivery categories are merged while preserving each entry’s type, amount, date, payment method and audit history. Order ledger posting, reversals, cost dates, missing-versus-zero costs, and cancellation/refund exclusions remain unchanged. The Delivery category itself remains protected from renaming and archival.

Order printing measures the complete saved order before selecting a layout:

1. Normal quarter slip.
2. Tighter quarter slip, with two product columns when useful.
3. Half-sheet landscape slip, with two or three product columns when useful.
4. Additional half-sheet slips only when the order still cannot fit at the defined readable type sizes.

Quarter slips retain the existing 127 × 101.6 mm size. Half slips span two adjacent slots at 254.5 × 101.6 mm. Both fit the existing A4 and Letter landscape print layouts. Batch printing packs a half slip across one row and can fill an available quarter slot with another order. Use landscape, Actual size / 100%, with browser headers and footers off.

All saved items, selections, instructions and prices are preserved. Exceptional orders continue at word boundaries, repeat their reference and buyer, and show the complete payment breakdown only on their final slip. Product photos retain their loading/failure safeguards. Printing does not modify orders.

The same release centers icon-only close/remove controls across admin editors, checkout/product dialogs, newsletter invitations, Academy album photos and public photo galleries. It removes inherited padding/oversized line heights; existing accessible labels and close actions are unchanged. Calendar and order-confirmation close controls were checked and already had the correct alignment.

Validation: 206 unit checks; 278 database checks across 47 migrations; 51 print checks; accounting at desktop/mobile with real Excel download; order, checkout and newsletter browser regressions; seven close-control variants at desktop/mobile widths. A six-item fixture fits one quarter slip, a 12-item fixture fits one half slip, and long instructions plus a 30-item fixture retain every item without clipping. A4 and Letter PDFs were checked, including a rendered A4 sheet.
