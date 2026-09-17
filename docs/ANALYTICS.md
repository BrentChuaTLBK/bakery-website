# Kitchen analytics

Open **Kitchen dashboard → Analytics**. The page is available to the same signed-in owners and staff who can view orders.

Choose Today, Last 7 days, Last 30 days, This month, All time, or Custom dates. Custom dates need **Apply dates**. All dates use Manila time and refer to **when the order was placed**, not its pickup/delivery date or the date its payment was approved.

| Figure | What it counts |
| --- | --- |
| Number of orders | Every order placed in the selected period, including unpaid, cancelled and expired orders. |
| Sales | Latest order totals for paid orders, excluding cancelled, expired and Refund-labelled orders. Includes discounts and delivery fees. Completed orders remain included. |
| Average order value | Sales divided by the number of paid orders excluding cancellations, expiry and full refunds. An empty paid-order set shows a dash. |
| Units ordered | Latest product quantities in the orders counted in sales. One box/pouch is one sellable unit. |
| Top products | Top ten products by units, combining different flavors/options under their parent product. Ties use item value, then name. Item value is before order discounts and excludes delivery. |
| Order status | Current paid, full-refund, awaiting-payment, review, expired and cancelled counts. Full-refund counts may overlap with cancelled orders. Expired/cancelled percentages use all selected orders. |
| Pickup versus delivery | Current fulfillment method for paid orders only, excluding cancelled, expired and Refund-labelled orders. Percentages use this same eligible paid-order count, not all orders. |
| Sales over time | Current sales and the number of qualifying paid orders attributed to placement dates. The chart tooltip and **View exact figures → Paid orders** exclude unpaid, cancelled, expired and Refund-labelled orders, matching sales. Completed paid orders remain included. Long date ranges group into weeks or months. |

## How edits affect analytics

Saving an order edit changes the quantities, sales, average and product ranking the next time Analytics renders with that saved order. Opening Analytics fetches fresh data, and **Refresh analytics** picks up changes saved by another team member. The update time is shown on the page. This is a current-state report: editing an older order changes the figures for its original placement period.

Cancelling a paid order removes its current value and quantities from sales/top products and the pickup/delivery breakdown. Its original approved payment remains in **Sales and payment details** because cancellation alone does not prove a refund was sent.

**Original payment approvals** preserve the amount recorded when payment was approved. They do not change when an order is edited. A **Refund label means a full refund for analytics**. It excludes the entire latest order total, including delivery after discounts, from sales, average order value, units, product rankings, trends and the pickup/delivery breakdown. Removing the label restores those figures if the order remains paid and is not cancelled or expired. A cancelled order is already excluded, so the label cannot deduct it twice.

**Full-refund order value** reports the latest totals of paid orders carrying this label, including orders already cancelled. It is shown for reference and is not an extra subtraction from the already-adjusted sales total. Unpaid orders with a label contribute no refund value. Applying a label updates the original order-placement period, not a separate refund-date period.

Original payment approvals remain unchanged. Differences above/below approvals exclude Refund-labelled orders. The label does not transfer money or prove a transfer completed; you still send the full refund manually. Fulfillment, stock and promo usage are unaffected by the label itself.

This page reports order values, not profit or a cash ledger. All calculations use the authenticated admin order data already available to the dashboard; this feature does not change orders, stock, payments, or email delivery.

## Quick check after publishing

1. Open Analytics and select **All time**. Compare the total order count with Orders using cleared filters.
2. Check that unpaid and expired orders do not increase sales.
3. Choose a paid order and check its latest total and quantities against the relevant placement-date report.
4. When making a legitimate order amendment, save it, return to Analytics, and confirm sales and units reflect the amended order. The original approved payment should stay the same.
5. Use a custom date range that contains no orders. Sales should be ₱0.00 and average order value should show a dash.

Use local fixtures for destructive test scenarios. Do not cancel real customer orders solely to test reporting.

Website visitors are separate from order analytics. **Website visitors** shows **Visitors today** and **Active visitors · last 30 minutes** across the website’s tracked pages, using Google’s aggregate user counts. These figures refresh every minute while Analytics is visible and do not follow the order date filter. Today uses the Google Analytics property timezone shown on the card; standard report processing may lag behind Realtime. The cards need a private server reporting connection; until configured, they show a setup message and —, not invented zeros. Follow [TRAFFIC.md](TRAFFIC.md) to connect and verify them.
