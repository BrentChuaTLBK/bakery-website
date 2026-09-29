# TLB production audit — 29 September 2026

## Result and scope

The fresh regression after the fixes passed **53 of 53 suites**. It found no additional reproducible functional failures in those scenarios. This is bounded evidence, not a claim that every possible combination, device, external provider, or future failure has been tested.

The audit used the live website and production APIs for customer orders, pricing, stock races, proofs, payment approval/rejection, direct orders, POS, cash reconciliation, accounting, calendar synchronization, and email delivery. Destructive/fault-injection cases also ran against isolated databases or intercepted browser APIs. Customer orders, actual Nori configuration, production calendars/settings, and real payment balances were preserved. No money was transferred.

The source fix is tested in this checkout. It must be merged into the production repository before customers receive it. No business-rule migration or production email-worker change was needed in this pass.

## Confirmed issues and changes

### MEDIUM — Mobile checkout retained the previous step's scroll position

- **Reproduction:** At 390 × 844, fill customer details, scroll to Review order, and open the review. The live screenshot showed a clipped heading/close button. The isolated regression reproduced `scrollTop = 87` instead of zero.
- **Root cause:** The details and review steps replace the contents of the same open dialog without resetting its scroll or moving keyboard focus to the new step.
- **Fix:** Both transitions focus the new heading with `preventScroll`, then reset dialog scroll to zero. This also announces the new step to keyboard/screen-reader users without adding the heading to normal tab order.
- **Files:** `assets/ordering/shop.js` (`openCheckout`, `renderReview`, new `focusCheckoutStep`); `shop.html` script cache version; `tests/ui/checkout-feedback.mjs`.
- **Verification:** The new assertion failed before the fix and passed afterward. It checks review, return to details, and review again. Chrome, Edge, Firefox, and WebKit passed. The final 53-suite regression passed.
- **Release limit:** The corrected source was tested locally; the deployed website requires the production merge.

### LOW — Operational documentation described the pre-launch site as current

- **Reproduction:** `docs/LIVE-TESTING.md` said ordering was paused, no products/orders existed, shop/account returned 404, and maintenance ran every five minutes. Those statements no longer describe production. The Edge README described only eight tests.
- **Root cause:** Initial setup notes had not been labeled historical as the system expanded.
- **Fix:** Marked the setup snapshot as historical, linked this audit, and made the Edge README refer to the runner's current count.
- **Files:** `docs/LIVE-TESTING.md`, `tests/edge/README.md`.
- **Verification:** Compared with live routes, catalog, cron, and current test output; checked the patch for whitespace errors.

### LOW — Photo regression could decode before its displayed image was ready

- **Reproduction:** The initial full run failed the party-cart photo test with `EncodingError`; its isolated rerun passed.
- **Root cause:** The test awaited font loading but did not first establish that the gallery's asynchronously assigned image source had loaded.
- **Fix:** Wait for a nonempty current source, completed load, and nonzero natural width before decoding. The decode assertion remains in place.
- **File:** `tests/ui/party-cart-photos.mjs`.
- **Verification:** Its final full-suite run passed, including slow-image replacement, decode failure recovery, uploads, and mouse/touch/keyboard reordering.

No confirmed critical or high-severity defect was reproduced in this pass. This does not replace an independent penetration test.

### Initial failures that were not established as application defects

- The Academy dialog suite needs a seeded local camp with a hero and creation. The first run used an empty preview. Running the Academy integration suite first supplied that prerequisite; both desktop/mobile dialog checks then passed. Production Academy data was not changed.
- One initial delivery-tracking test timed out while clearing a link. Diagnostic reruns and the final full regression passed without changing delivery logic. Its root cause was not established; it remains a test-stability observation, not a claimed fixed product bug.
- Live harness corrections included using the application's actual auth storage key, matching the browser's quote-signature fields, and supplying the required explicit stock-restoration choice when cancelling a paid order. Those rejected requests demonstrated existing guards; they were not website fixes.

## Executed regression

| Run | Result | Evidence / scope |
| --- | --- | --- |
| Unit runner | 221 passed | Pricing, dates, rendering, exports, shared rules |
| Backend runner | 380 passed | Actual SQL migrations in isolated Postgres-compatible test DB; orders, permissions, inventory, POS, accounting, newsletter, calendar |
| Voucher-focused backend runner | 35 passed | Includes shared order contracts; do not add this count as wholly unique coverage |
| Edge runner | 109 passed | Real worker/template source with mocked provider/storage failure paths |
| Browser suites | 49 passed | All tracked `tests/ui/*.mjs` plus newsletter browser suite |
| Combined fresh run | **53/53 suites passed** | Four core runner invocations plus 49 browser suites |
| Additional engines | 12/12 suite runs passed | General checkout/admin, checkout validation, POS, vouchers in Edge, Firefox, WebKit |
| Post-fix engine checks | 3/3 passed | Updated checkout regression in Edge, Firefox, WebKit; Chrome included in final full run |

The initial combined run was 50/53. The complete run was repeated after the checkout fix and test/setup corrections, rather than ending after the first batch.

Local evidence is under `test-results/production-audit/`: `baseline/`, `final/`, `browsers/`, `crawl/`, `live/`, and `performance/`. Private tokens, credentials, signed links, and temporary test scripts are not publication artifacts.

Reproduction requires Node 24, the existing PGlite/Playwright dependencies, Chrome, and an isolated Academy preview. Run `scripts/test-unit.mjs`, `tests/backend/run.mjs`, `tests/backend/run.mjs --vouchers`, and `tests/edge/run.mjs`; seed the Academy preview with `tests/ui/academy.mjs` before `tests/ui/academy-dialogs.mjs`; then run every tracked browser suite. Extra engines used the same assertions with only the browser launch target changed.

## Live scenarios executed

### Catalog, price and validation

- Quoted all **37 live products** with valid options. Each matched independently calculated base price, quantities and surcharges.
- Extended coverage to all **97 enabled choices across 20 option groups**, including representative mixed-choice splits. Caller-supplied item prices and totals did not override server prices.
- The original 37 quote requests had a **124 ms median, 183 ms p95, 285 ms maximum** from this test machine. These are observed request timings, not a production SLA.
- Rejected invalid dates, dates outside the booking window, blocked dates, same-day noneligible products, empty carts, zero/negative/fractional quantities, incorrect choice counts, unknown options, malformed customer details, unsupported delivery areas and invalid fulfillment methods.
- Preserved all six actual Nori products' same-day-disabled configuration and 1–3 production-day lead times.
- Exercised same-day eligibility with a test-only product and the production quote function at a controlled **09:59:59 Manila** timestamp. It accepted the same-day date and calculated PHP 130.00. Exact cutoff/midnight, mixed carts, nonproduction days and horizon boundaries also passed isolated database tests.

### Stock, order creation and payment hold

- Five simultaneous checkouts competed for **one** test stock unit: one succeeded, four were rejected; no oversell.
- Five simultaneous requests sharing an idempotency key returned one order. Changing that request under the same key was rejected.
- New website orders received exactly 900 seconds to upload proof.
- One order was left to expire naturally without changing its deadline. It became expired, restored all 20 units of that test product, and refused late proof.
- Existing order tokens could read only their own order. Wrong tokens and attempts to use one token against another order failed.

### Pickup, delivery, proofs and edits

- Completed a live **390 px guest checkout**, checked the reviewed total, submitted once, and reopened the private order after refresh.
- Created pickup and covered-zone delivery orders; delivery subtotal plus PHP 300.00 zone fee matched the PHP 423.45 total in the order and delivered email.
- Uploaded test image proofs through the actual Edge/Storage service and approved/rejected them through the application APIs. Rejected orders could not subsequently be approved.
- A disguised executable upload was blocked before reaching the application. Invalid-token upload was rejected. Other image/content/size/race cases passed the isolated Edge suite.
- Owner proof viewing returned a signed URL valid for five minutes; anonymous access and the public-bucket URL failed.
- Edited a live test order through the real admin UI. API tests also confirmed stale revisions were rejected and paid edits stayed paid.
- Applied/removed a refund label; accounting and calendar eligibility changed accordingly. Progressed pickup through preparation, ready, and completed. Cancelled a paid delivery with an explicit stock-restoration choice.

### POS, direct orders, accounting and promos

- Created one event with selected catalog stock and an event-only custom product/flavor. Event price and flavor surcharge were authoritative, with separate stock; the custom product never entered the website catalog.
- Opened a shared drawer with PHP 500 change. A PHP 100 cash sale receiving PHP 200 returned PHP 100 change. A PHP 150 GCash sale stayed separate from cash. Expected drawer cash was PHP 600.
- Added PHP 10 cash-in, rejected an unexplained discrepancy, and closed at PHP 610 with zero difference. Voiding the cash sale restored its event stock; accounting excluded the void.
- Created a paid direct delivery order with optional customer details omitted, a catalog item and a custom cake. Edited product totals from PHP 373.45 to PHP 546.90 while preserving paid status; added and separately collected PHP 235.00 delivery through East West.
- Accounting contained the original PHP 373.45, PHP 173.45 adjustment and PHP 235.00 delivery entry: PHP 781.90 total, with the correct BDO/East West labels.
- A capped 10% test promo produced PHP 10.00 discount. Three concurrent orders competed for its one remaining use: one succeeded. Cancelling that unpaid order released its reservation.
- Isolated tests additionally covered POS method customization, cash-out/refunds, reconciliation revisions, website prices locked in direct orders, custom flavors, event reordering/removal, paid edits, deferred delivery proofs, XLSX structure/styles/formulas, and printable slips.

### Calendar and email

- Only eligible paid/confirmed orders appeared in the dashboard schedule. Private access tokens and proof paths were absent from calendar summaries.
- Production Google sync acknowledged test order creation/edits and later removal; final test tombstones were fully synchronized with no error.
- **15/15 transactional audit messages reported delivered in Resend**, covering order submission, approval, rejection, cancellation, pickup readiness and expiry. HTML and plain text were present and had no unresolved template placeholders, `undefined` or `NaN`.
- The actual approval email was rendered at 600 and 390 px and visually inspected. Its PHP 123.45 subtotal + PHP 300.00 delivery = PHP 423.45 total matched the live order.
- The actual audit-account verification email also reported delivered, and verification/password sign-in succeeded.
- Six queued staff-review messages were correctly skipped after their orders no longer needed review; this was an intentional state check, not a delivery failure.
- Newsletter subscription/preferences, consent, unsubscribe, welcome vouchers, thank-you eligibility, provider suppression, retries and Broadcasts routing passed database, browser and Edge regressions. POS/direct thank-you exclusion passed those contracts. No customer newsletter broadcast was sent in this pass. The separately documented earlier voucher audit includes a delivered production thank-you message.

## Public pages, responsiveness and conversions

The live crawl visited all 23 root HTML routes, including legacy aliases. It found no page JavaScript errors, broken loaded images, or horizontal page overflow at **320, 390, 430, 768, 1280 and 1440 px**. It exercised mobile navigation, available accordions and shop product dialogs. This is not a claim that every link target behind login or every offscreen gallery image was downloaded.

Browser suites covered homepage synchronized photos, party/dessert package categories and duplication, gallery/lightbox behavior, Academy publication and albums, settings/calendar controls, accounting tables/XLSX, slips/labels, newsletter editors, product deletion/photos, modal guards and responsive POS.

Actual HEIC fixtures were decoded and converted in the product/gallery tests; PNG/JPEG/WebP upload conversion, sizing, image signatures and rejected inputs were also exercised. This verifies the conversion paths and fixtures, not every existing photo in the library or every possible HEIC codec variant. No production photo curation was performed.

## Mandatory A–L acceptance matrix

| Scenario | Outcome and actual evidence |
| --- | --- |
| A. Advance pickup | PASS — live creation, proof, approval and fulfillment |
| B. Delivery | PASS — live zone calculation, proof, approval, cancellation |
| C. Mixed lead times | PASS — live quote; isolated date/readiness tests |
| D. Same-day Nori | PASS for capability — test-only product, production function with controlled morning timestamp; actual Nori settings preserved |
| E. Invalid same-day mixed cart | PASS — isolated DB/UI cutoff and mixed-basket rejection contracts; live noneligible/date rejection |
| F. Promo | PASS — live capped discount, concurrency, cancellation release |
| G. Final capacity | PASS — live five-way race for one unit |
| H. Expiry | PASS — actual 15-minute elapsed hold and late-proof rejection |
| I. Custom cake | PASS for supported DM custom item/price; online cake configurator is NOT TESTABLE because that feature does not exist |
| J. Admin edit | PASS — live UI edit, API paid-total edit and stale-revision rejection |
| K. Cancel/refund | PASS — live cancellation/refund-label/accounting/calendar; actual bank refund transfer not performed |
| L. Mobile checkout | PASS AFTER FIX — live 390 px order succeeded; clipped step header fixed and regressed in four engines |

## Complete system checklist

Statuses refer to the explicitly described scope, not unlimited combinations. “PASS AFTER FIX” refers to the tested patch, pending production merge.

| System | Status | Scope / limitation |
| --- | --- | --- |
| Homepage / navigation | PASS | Live route/layout scan; local interaction suites |
| Shop / products / cart | PASS | 37 live product quotes, every enabled option choice, browser rules |
| Custom cakes | PASS / NOT TESTABLE | DM custom name/price supported and tested; no online configurator exists |
| Nori | PASS | Existing settings preserved; prices/options tested |
| Same-day Nori | PASS | Capability tested using test product and controlled time; not enabled on actual products |
| Checkout | PASS AFTER FIX | Scroll/focus transition correction; live mobile order |
| Pricing / lead times | PASS | Server totals, mixed baskets and cutoff/date contracts |
| “Two-month” window | PASS | Implemented rule is current month plus next two calendar months, not rolling 60 days |
| Date availability / capacity | PASS | Closed dates, lead time, isolated boundaries, live final-stock race |
| Pickup / delivery | PASS | Live flows and covered-zone totals |
| Customer details / phones | PASS | Validation and optional DM fields; formatted numbers intentionally accepted with valid digit counts |
| Payment proof / hold | PASS | Actual private upload/signing and natural expiry; provider faults isolated |
| Promo codes / vouchers | PASS | Live promo race plus full voucher contracts; no POS/DM thank-you entitlement |
| Order creation / duplicate protection | PASS | Live simultaneous submissions/retries |
| Admin / admin edits | PASS | Actual owner UI plus revision and price/stock contracts |
| POS / cash drawer | PASS | Live cash/change, digital methods, event/custom stock and close |
| Direct orders | PASS | Optional details, custom items, paid edits, later delivery collection |
| Accounting / exports | PASS | Live ledger reconciliation; XLSX, table and print tests |
| Calendar | PASS | Dashboard eligibility and acknowledged Google synchronization/removal |
| Cancellation / refund | PASS | Status, stock choice, accounting and calendar; money transfers excluded |
| Supabase / RLS / Storage | PASS | Unauthorized gateways/table access blocked; private proof storage/signing; test-file removal pending approval |
| Authentication | PASS | Actual verification/sign-in; token and permission contracts; interactive Google consent excluded |
| Emails | PASS | 15 delivered transactional messages plus auth mail; template/worker contracts; inbox placement not observed |
| Newsletter / subscription | PASS | Fresh isolated DB/Edge/UI regression; no fresh live broadcast to subscribers |
| Analytics | PASS | Calculation/export and backend ingestion contracts |
| GA4 report ingestion | NOT TESTABLE | Browser instrumentation/payloads checked; no access to the GA4 property/DebugView; crawl events intercepted to avoid pollution |
| Academy / content management | PASS | Live public pages, isolated real DB publication/upload/album interactions |
| Mobile / tablet / desktop | PASS | Six widths plus dedicated interaction suites; no physical-device certification |
| Browser compatibility | PASS | Chrome, Edge, Firefox and Playwright WebKit; actual iOS Safari not tested |
| Security | PASS within scope | Authorization/token/storage/escaping checks; leaked-password protection remains an optional hardening recommendation |
| Concurrency | PASS | Bounded real stock/promo/idempotency races; no claim of 500-user endurance capacity |
| Failure handling | PASS | Mocked provider/storage/network errors, retries, stale state; not a production outage drill |

## Cleanup and release state

- Removed the **10 audit orders, three products, one promo and one POS event**, plus their stock, payment, cash, accounting and history records. Production business counts returned to their baseline.
- Removed the temporary owner grant. Real customer orders and actual catalog settings were not changed.
- Google acknowledged removal of all three test schedule entries. The email queue had no pending/sending/failed backlog.
- Three tiny private proof images remain pending the separately requested approval for a narrowly scoped cleanup method. Automatic approval review rejected deploying the privileged cleanup helper, including the restricted JWT/expiry version. Neither helper was deployed.
- The audit login currently has ordinary customer access only while that cleanup decision is pending; it must be deleted after cleanup or after a decision to leave the images. This is explicitly unfinished cleanup, not a hidden residual owner account.
- The checkout fix and test/documentation changes are ready for the GitHub production merge. No optional improvement from the companion review has been implemented.

## Untested items and remaining risks

1. Actual cash/bank/GCash settlement and refund transfer were deliberately not performed. Test payment approvals were bookkeeping fixtures only.
2. Resend “delivered” verifies acceptance by the receiving mail server. Gmail inbox/spam placement and rendering in every mail client were not observable.
3. No fresh production newsletter Broadcast was sent in this pass. Provider-level newsletter failures were simulated, and prior delivered voucher evidence is in `VOUCHER-AUDIT-2026-09-29.md`.
4. Google OAuth account consent, GA4 property reports and the legacy contact form's destination inbox were not accessible for end-to-end verification. Contact-form delivery is therefore not certified.
5. Actual iPhone/iPad Safari, screen-reader use by a human, offline POS, real printer hardware and desktop Excel were not operated. WebKit, browser printing and workbook-structure tests are narrower evidence.
6. The audit did not download every Academy/gallery asset, test every combinatorial selection basket, exhaust every malformed payload, or simulate a prolonged cloud outage. Supported image formats and representative real HEIC files were exercised.
7. A previous large load exercise is not substituted for this run. This audit used small simultaneous races and bounded functional calls to respect the owner's Supabase budget; it does not establish a sustained 500-user service level.
8. One initial tracking timeout and one transient post-submit style assertion passed subsequent runs. Future CI should retain logs/screenshots for recurring timing failures rather than relabel them as proven product defects.
9. Current Supabase advisories include disabled leaked-password protection and security-definer notices. Checked public gateways enforce authorization; private helpers/tables were denied. The audit did not blindly revoke intentional APIs or remove indexes on a low-traffic database.
10. The production UI still needs the tested source merge. Cleanup approval and ordinary test-account removal remain explicit follow-up items until resolved.


## Cleanup follow-up — 30 September 2026

The owner approved removing the remaining audit data only. The three exact private test proof objects were removed through the Storage API, using the reviewed temporary JWT-protected, verified-audit-user-only helper with a five-minute expiry. It was immediately retired to a pure HTTP 410 response and verified. The exact ordinary audit account, refresh tokens and sessions were deleted afterward. Final queries found zero remaining audit proof objects, accounts or sessions; the three business orders, 37 products and one legitimate staff membership remained. The helper has no remaining cleanup capability. This supersedes the pending-cleanup notes above. No reusable cleanup tool was built. Audit PR #107 has also been merged.
