# Kitchen analytics

Open **Kitchen dashboard → Analytics**. The page is available to the same signed-in owners and staff who can view orders.

Choose Today, Last 7 days, Last 30 days, This month, All time, or Custom dates. Custom dates need **Apply dates**. All dates use Manila time and refer to **when the order was placed**, not its pickup/delivery date or the date its payment was approved.

| Figure | What it counts |
| --- | --- |
| Number of orders | Every order placed in the selected period, including unpaid, cancelled and expired orders. |
| Sales | Latest order totals for paid orders, excluding cancelled and expired orders. Includes discounts and delivery fees. Completed orders remain included. |
| Average order value | Sales divided by the number of paid, non-cancelled/non-expired orders. An empty paid-order set shows a dash. |
| Units ordered | Latest product quantities in the orders counted in sales. One box/pouch is one sellable unit. |
| Top products | Top ten products by units, combining different flavors/options under their parent product. Ties use item value, then name. Item value is before order discounts and excludes delivery. |
| Order status | Current paid, awaiting-payment, review, expired and cancelled counts. Expired/cancelled percentages use all selected orders. |
| Pickup versus delivery | Current fulfillment method for every selected order, including unpaid, cancelled and expired orders. |
| Sales over time | Current sales attributed to placement dates. Long date ranges group into weeks or months. Use **View exact figures** to see the underlying values. |

## How edits affect analytics

Saving an order edit changes the quantities, sales, average and product ranking the next time Analytics renders with that saved order. Opening Analytics fetches fresh data, and **Refresh analytics** picks up changes saved by another team member. The update time is shown on the page. This is a current-state report: editing an older order changes the figures for its original placement period.

Cancelling a paid order removes its current value and quantities from sales/top products. Its original approved payment remains in **Sales and payment details** because cancellation alone does not prove a refund was sent.

**Original payment approvals** preserve the amount recorded when payment was approved. They do not change when an order is edited. The differences above/below those approvals help identify changed order values; the system does not record subsequent manual transfers or refund amounts. A Refund label is a flag, so it does not automatically subtract a monetary amount.

This page reports order values, not profit or a cash ledger. All calculations use the authenticated admin order data already available to the dashboard; this feature does not change orders, stock, payments, or email delivery.

## Quick check after publishing

1. Open Analytics and select **All time**. Compare the total order count with Orders using cleared filters.
2. Check that unpaid and expired orders do not increase sales.
3. Choose a paid order and check its latest total and quantities against the relevant placement-date report.
4. When making a legitimate order amendment, save it, return to Analytics, and confirm sales and units reflect the amended order. The original approved payment should stay the same.
5. Use a custom date range that contains no orders. Sales should be ₱0.00 and average order value should show a dash.

Use local fixtures for destructive test scenarios. Do not cancel real customer orders solely to test reporting.

Website visits are separate from order analytics. This change does not add or configure a traffic tracker.
