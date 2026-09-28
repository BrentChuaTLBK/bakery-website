# Point of sale

Open **Admin → Point of sale**. Verified staff can record sales; owners can also create/edit pop-up events and approve date overrides.

The POS has five separate areas:

- **Sell:** take a pop-up sale or direct order. Only events open today appear in the counter selector.
- **Cash drawer:** open a shared event drawer with the change you brought, record cash in/out, and count and close the session.
- **Orders:** open previous POS orders, record outstanding payments, and access customer details or receipts.
- **Event setup** (owner): prepare events, select products, edit prices/stock, and view event sales totals. Saving stays in setup; choose **Open counter** when ready to sell.
- **Payment methods** (owner): keep Cash, GCash, BDO and EastWest, or add/rename/disable other POS methods independently of website payment instructions.

On phones, **Products** and **Basket** are separate views. The bottom bar keeps the basket total and review action within reach. Tablet and desktop layouts show products and the basket together. Dashboard navigation is tucked away on phones/tablets; **Dashboard** returns to the full admin area. Switching POS areas preserves the current sale draft unless you explicitly discard it. Event edits and unconfirmed saves are protected against accidental navigation.

The separation between selling and product management takes inspiration from [Cococart's POS product-management workflow](https://support.cococart.co/en/articles/15549448-how-do-i-add-products-and-categories-to-the-pos-app). TLB retains its existing brand, event-specific stock and payment rules.

## Pop-up sales

Create an event with its dates, location, products, total stock and event prices. Total stock includes units already sold. It cannot be reduced below those units. Event stock and prices are separate from website daily quantities and catalog prices.

Event setup starts empty. Use **Choose from lineup** to search and add selected website products, or **+ Custom product** for an event-only name, details, stock and price. Only selected products appear on the event counter. Custom event products have their own limited event stock and never create website listings. Removing a product from the event stops new sales of it while keeping past receipts and stock history.

For a website product with flavors/options, event setup shows **Flavors & options**. Check which choices are offered and set each flavor's total stock, including units already sold. Use **+ Add event-only flavor** for a new name, stock and optional surcharge. Catalog flavor names, choice requirements and surcharges stay fixed; event-only flavors never appear in website or direct orders. For a product with one required flavor, total product stock calculates from flavor stock. Multi-choice packs retain an overall product stock limit as well as each choice's limit. For example, two Duo Packs with two BBQ choices each consume two packs and four BBQ units. Flavor stock belongs to that event product; it is not pooled with other products or events.

Older events keep their original stock behavior until the owner chooses **Set stock per flavor**. Previously sold/retained choices count when tracking starts. Once configured, the event keeps its own option snapshot, so later catalog edits do not silently alter the booth's lineup. Disable a flavor by unchecking it; its history remains. The counter shows remaining choices and prevents selecting more than are available after the current basket. The server rechecks aggregate product and flavor stock when recording payment, so another seller cannot oversell the last units. Voiding with **Return items to event stock** restores the exact flavors; keeping items deducted retains their flavor usage.

Choose the event, add products, adjust quantities or apply a fixed/percentage discount, then review the sale. Record the full payment using Cash, GCash, BDO or EastWest. Cash shows the change due. Only the order total is recorded as revenue; the cash tender does not inflate sales.

Pop-up sales are completed immediately. Owners can void an erroneous sale, record a reason and explicitly decide whether its items return to event stock. Voiding excludes the sale from accounting; any actual refund is handled separately.

## Cash sessions and payment methods

Before accepting pop-up cash, open **Cash drawer**, choose the event and enter **Opening change**. Each event has one shared open session, visible to all verified staff. You can close it and open a new session later, including on another day of the same event. Old checkout tabs retain their pre-session behavior only until that event's first session opens; current checkout always requires a drawer for cash.

**Expected cash = opening change + cash sale totals + cash in − cash out.** Cash sale totals already subtract the change given. GCash, bank and custom electronic payments appear in the session's payment summary but never increase its cash balance. Digital sales may continue without an open drawer. Direct-order payments are separate from event drawers.

Record added change as **Cash in**, and refunds, payouts or money removed as **Cash out**, with a reason. These movements describe physical cash only: they do not create income or expenses in Accounting. Record business expenses in Accounting when appropriate. A void does not imply cash was returned; record actual returned cash as Cash out. Closed sessions keep their original counts even if an order is later voided.

To close, count all money in the drawer, including opening change. The screen displays the overage or shortage; a difference needs a note. If another seller records a payment while you are counting, refresh and check the updated expected amount before closing. Opening, movement, closing and settings submissions use retry keys so a lost response cannot duplicate them. Closed sessions retain their payment totals and recent movement history; the view includes all open sessions and the latest 50 closed sessions.

**Payment methods** controls POS tender buttons for pop-up, direct-order and separately collected delivery payments. Cash remains available and keeps cash/change behavior; added methods are electronic tenders. Disable a method to stop accepting it. Past receipts, optional emails, session summaries and accounting exports keep the payment name saved at the time. Website bank account details and customer payment instructions remain in Shop settings.

## Direct orders

Choose catalog products, custom items, or both. Custom items have their own name, price, quantity and notes. They do not create catalog products or affect inventory. Catalog items reserve the existing product/date stock.

Website-product prices, including option surcharges, are fixed in direct orders and checked on the server. Custom-item prices remain editable. Adding the same product with the same options increases its quantity; different option selections stay separate. Flavor options use the shop's **− / +** controls with a shared selection limit. Fulfillment and event dates use the branded calendar.

Client name, phone, email, social-media platform/profile, recipient and delivery address are all optional. Add or correct them later under **Client details**. An email is required only when email updates are selected. If the delivery address is blank, the review screen reminds you to add it before arranging a courier.

Choose pickup or delivery, a fulfillment date and any delivery fee. The owner can explicitly override closed dates or production lead times with a reason. Overrides do not bypass stock limits or pickup-only restrictions.

Choose either **Awaiting payment** or **Full payment already received**. Awaiting-payment orders reserve stock until the team manually cancels the order; there is no automatic payment deadline. Customers can use the private link to copy payment details and upload proof. Staff review that proof and record the received full payment. The product payment must be made in full; deposits are not supported.

For a delivery quote that is not known yet, select **Delivery fee pending · collect separately later**. The customer pays the products in full first. Open the saved order after booking, enter the exact courier charge, and share the same private link for the separate delivery payment and proof upload. Record that delivery payment under **Record full delivery payment**. Product and delivery payments keep their own method, receipt and cash/change. A zero charge is allowed when no delivery fee is owed. A paid delivery fee cannot be overwritten; pending amounts can be corrected before proof review. Delivery income enters accounting only when its payment is recorded.

Saved POS item/price snapshots are retained. To change the items of an unpaid direct order, cancel it in Order history/status and create the corrected order. Client details and notes can be edited without cancelling or changing stock/payments.

## Confirmations and records

Email updates are optional and off by default. Enabling them sends transactional order confirmations through the existing outbox; newsletter delivery continues to use Resend Broadcasts. Print a preparation slip when needed, or copy the private customer order link. Keep that link private.

POS orders appear in Orders, Analytics and Accounting. Pop-up and Direct message sales have their own automatic accounting categories. Delivery income and costs remain in Delivery. Discounts retain the existing accounting treatment. No separate manual entry is needed for a POS sale.

The POS needs an internet connection. If saving times out, retry the same submission: the server checks its unique key and returns the original order rather than creating another sale.
