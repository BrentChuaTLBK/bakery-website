# Point of sale

Open **Admin → Point of sale**. Verified staff can record sales; owners can also create/edit pop-up events and approve date overrides.

## Pop-up sales

Create an event with its dates, location, products, total stock and event prices. Total stock includes units already sold. It cannot be reduced below those units. Event stock and prices are separate from website daily quantities and catalog prices.

Choose the event, add products, adjust quantities or apply a fixed/percentage discount, then review the sale. Record the full payment using Cash, GCash, BDO or EastWest. Cash shows the change due. Only the order total is recorded as revenue; the cash tender does not inflate sales.

Pop-up sales are completed immediately. Owners can void an erroneous sale, record a reason and explicitly decide whether its items return to event stock. Voiding excludes the sale from accounting; any actual refund is handled separately.

## Direct orders

Choose catalog products, custom items, or both. Custom items have their own name, price, quantity and notes. They do not create catalog products or affect inventory. Catalog items reserve the existing product/date stock.

Client name, phone, email, social-media platform/profile, recipient and delivery address are all optional. Add or correct them later under **Client details**. An email is required only when email updates are selected. If the delivery address is blank, the review screen reminds you to add it before arranging a courier.

Choose pickup or delivery, a fulfillment date and any delivery fee. The owner can explicitly override closed dates or production lead times with a reason. Overrides do not bypass stock limits or pickup-only restrictions.

Choose either **Awaiting payment** or **Full payment already received**. Awaiting-payment orders reserve stock until the team manually cancels the order; there is no automatic payment deadline. Customers can use the private link to copy payment details and upload proof. Staff review that proof and record the received full payment. The product payment must be made in full; deposits are not supported.

For a delivery quote that is not known yet, select **Delivery fee pending · collect separately later**. The customer pays the products in full first. Open the saved order after booking, enter the exact courier charge, and share the same private link for the separate delivery payment and proof upload. Record that delivery payment under **Record full delivery payment**. Product and delivery payments keep their own method, receipt and cash/change. A zero charge is allowed when no delivery fee is owed. A paid delivery fee cannot be overwritten; pending amounts can be corrected before proof review. Delivery income enters accounting only when its payment is recorded.

Saved POS item/price snapshots are retained. To change the items of an unpaid direct order, cancel it in Order history/status and create the corrected order. Client details and notes can be edited without cancelling or changing stock/payments.

## Confirmations and records

Email updates are optional and off by default. Enabling them sends transactional order confirmations through the existing outbox; newsletter delivery continues to use Resend Broadcasts. Print a preparation slip when needed, or copy the private customer order link. Keep that link private.

POS orders appear in Orders, Analytics and Accounting. Pop-up and Direct message sales have their own automatic accounting categories. Delivery income and costs remain in Delivery. Discounts retain the existing accounting treatment. No separate manual entry is needed for a POS sale.

The POS needs an internet connection. If saving times out, retry the same submission: the server checks its unique key and returns the original order rather than creating another sale.
