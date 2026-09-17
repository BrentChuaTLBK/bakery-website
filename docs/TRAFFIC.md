# Website traffic in Google Analytics

The homepage already uses Google Analytics stream **G-108BDB1XQ0**. The admin Analytics page links to Google Analytics; traffic totals are not imported into the order dashboard.

Shop page-view tracking is **enabled in this version**, following the owner’s confirmation that Enhanced measurement was turned off. It becomes active when this version is published. Actual collection still needs to be verified in Google Analytics; local checks do not send real events. Refund and sales reporting work independently of traffic tracking.

## Keep the Google stream setting configured

1. Sign in to [Google Analytics](https://analytics.google.com/).
2. Select the property for **thelittlebakerkitchen.com**.
3. Open **Admin → Data collection and modification → Data streams**.
4. Open your website's web stream and check that its Measurement ID is **G-108BDB1XQ0**.
5. Turn **Enhanced measurement OFF** and save if a Save button appears.
6. Keep Enhanced measurement off while using this integration. The owner has already confirmed this step for activation. To disable shop collection later, change `data-ga-pageviews-enabled="true"` to `"false"` on the traffic script in `shop.html` and publish.

This setting controls automatic form, link, download and browser-history events. The shop also displays private order receipts, so these automatic events should stay off. The integration explicitly sends the public shop pageview; it does not need Enhanced Measurement. This stream-wide change also disables those extra automatic events on the homepage, while its basic pageview tag remains.

Google's [Enhanced Measurement instructions](https://support.google.com/analytics/answer/9216061) explain the stream setting. Its [pageview guide](https://developers.google.com/analytics/devguides/collection/ga4/views) explains why `send_page_view: false` alone does not disable automatic history events.

## Verify after activation and publishing

1. Open [the public shop](https://thelittlebakerkitchen.com/shop.html) in a separate browser tab.
2. In Google Analytics, open **Reports → Realtime**, or **Realtime pages** where available.
3. Look for **Order online · The Little Baker Kitchen** or `/shop.html`.
4. For ongoing page traffic, use **Reports → Engagement → Pages and screens**. Report navigation can vary with the property's report collection.

Realtime reports show recent activity; normal reports take longer to process. An ad blocker or Analytics opt-out can prevent your visit from appearing. See Google's [Realtime pages guide](https://support.google.com/analytics/answer/15315925?hl=en) and [pageview reports guide](https://developers.google.com/analytics/devguides/collection/ga4/views).

## What the shop integration measures

- Public shop visits on the production HTTPS domain and its `www` equivalent. Preview, local, demo and private order URLs are skipped.
- The page URL excludes query strings and fragments. Referrers omit query strings/fragments; external referrers retain only the origin, and known private internal paths are omitted.
- No customer contact fields, payment references, order IDs, order tokens, purchase totals or refund totals are added to Analytics.
- Google advertising signals and ad personalization are disabled for this integration. Existing opt-out is respected.
- Collection stops for the rest of that page load when a customer enters a form, submits an order, or switches to a private order view. Account, auth callback and admin pages do not load this script.

This is traffic measurement, not a checkout funnel or sales ledger. It does not backfill historical shop visits or prove how many visitors became paying customers. Revenue and refunds remain in the admin order Analytics page. Google Analytics can count repeated visits and can miss visits blocked by browsers; its visitor counts are estimates rather than a customer list.

Developer validation: `node --test tests/traffic.test.mjs` uses an isolated VM with fake script elements. It never loads Google or sends a real event. Real collection must be checked in the owner's account after activation.
