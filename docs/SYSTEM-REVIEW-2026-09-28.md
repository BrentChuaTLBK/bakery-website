# Website system review — 28 September 2026

This review covers main commit `6925cd62d682ca36c9aff9f70d488d15bf6dfa99`, including the merged POS/custom-flavor work. It supplements the earlier `SYSTEM-AUDIT-2026-09-28.md`; its results and live tests are separate from that earlier audit. The owner authorized test orders, a test promo, real test emails to the approved owner address, and UI improvements.

## Findings and changes

| Finding | Change | Release status |
| --- | --- | --- |
| Accounting left the client-name column blank for website orders, even when the order contained a buyer name. | Use the saved buyer name for every order source. Totals, category mapping, eligibility and payment-method records are unchanged. Added regression coverage for amounts, cancellation and private function permissions. | Applied to production. Source migration: `20260928143339_accounting_order_client_names.sql`; production migration version: `20260928143755`. |
| The deployed email worker lagged behind merged payment-label changes. Custom POS payment methods could appear as internal identifiers. | Deployed the current worker/shared templates so receipts use the saved payment-method labels, including a separately paid delivery fee. | Live. Final worker version 26 is active; all eight deployed source files match the prepared payload after newline normalization. Existing authentication is unchanged. |
| The mobile POS section bar clipped the later sections into horizontal scrolling. | On phones, all five owner sections now fit in two rows with touch-sized buttons. The three staff sections remain in one row. | Source change ready for website merge/deployment. Checked at 320, 390, 820 and 1440 pixels, including staff access. |
| A newsletter with a promo code but no optional offer heading emitted an empty heading element. | Omit the heading when it is absent or whitespace, retaining the code and offer terms. Updated browser cache versions and added a regression test. | Live in email worker 26. Matching admin preview change is ready for website merge/deployment. |
| A newsletter browser fixture treated the homepage's new read-only content lookup as an unexpected call. | Mock only the homepage `browse` request. Unmocked writes remain blocked. | Test-only fix; the rerun passed. |

The accounting table borders, amount alignment, centered empty states, Excel borders, compact print slips, centered close buttons, synchronized homepage photos and recent POS flavor editor changes passed their existing checks. They did not require further application changes in this review.

## Validation results

- **218 unit tests passed.**
- **349 database checks passed across 59 source migrations**, including 996 scheduling comparisons between date rules, browser availability and checkout quotes.
- **97 Edge Function/provider/email tests passed.**
- **45 repository browser suites passed**, plus the existing local settings-layout check at five widths. The newsletter fixture failure was repaired and rerun successfully; POS and newsletter suites were rerun after the final changes.
- **30 email previews** passed at 900, 390 and 320 pixels, including images blocked. **All six newsletter layouts** passed separate responsive checks, including long promo codes, headings, pictures and unsubscribe links.
- **17 live public pages at desktop and mobile widths** produced 34 successful read-only visits with no observed JavaScript exceptions, failed page/resource responses, broken loaded images or horizontal overflow. Initial harness guesses for five nonexistent routes were replaced with the site's actual routes before evaluating those pages.
- The static build completed with **23 pages** and preserved source assets.
- A generated accounting workbook opened normally in desktop Microsoft Excel, read-only, with **seven worksheets and all ten tables intact**. ExcelJS round-trip checks also validated totals, formulas, currencies, borders, alignment and the single Delivery category. The Excel COM `RepairMode` property was unavailable; the evidence is the successful normal open and preserved tables.

| System | Coverage |
| --- | --- |
| Order dates and availability | Production weekdays, non-production dates, all-service and delivery-only closures, lead times, cutoff boundaries, same-day settings, Manila/UTC boundaries, leap dates, impossible schedules and booking horizon. |
| Checkout and inventory | Pickup/delivery, delivery zones, required options, quantities, server prices, stale quotes, duplicate submission, inventory reservation/release, proof review, expiry, cancellation and paid-order changes. Live tests checked the reserved units and restoration. |
| Promo codes | Fixed/percentage discounts, caps, minimums, eligibility, expiry, global/customer limits, reservation/redemption, cancellation and welcome-code ownership. A real test code also exercised the one-use reservation limit. |
| Newsletter and subscriptions | Consent, signup/confirmation and unsubscribe logic, preference preservation, welcome-code issuance, owner permissions, drafts/previews, image upload, six templates, test isolation, final-send confirmation, Broadcast retries and provider reconciliation. Subscription edge cases used isolated fixtures; existing customers' normal preferences were preserved. |
| POS | Event-only lineup and stock; site/custom products; custom/event-only flavors, surcharges and availability; counted options in a modal; matching-item quantity increments; website price restrictions for direct orders; optional client fields; no automatic expiry for unpaid DM orders; owner date overrides; cash/change, editable POS methods, drawer movements and closing. |
| Accounting | Paid-order eligibility, cancelled/refunded exclusion, discounts, Delivery income/expense grouping, later delivery payments, client/supplier details, date filters, export structure and numerical reconciliation. |
| UI and administration | Mobile POS selling/setup separation, settings layout/save, branded calendars and dialogs, product deletion safeguards, order slips, email alert acknowledgment, payment copying, homepage editing/synchronized rotation, responsive galleries and Academy navigation/upload/publish controls. |
| Access and operations | Owner/staff/customer/anonymous boundaries, private order/proof access, worker authentication, idempotency, queue retries, scheduled maintenance, migration repeatability and database advisors. |

## Authorized live order tests

No real money was transferred and no courier was booked. Recorded payment approvals and refunds were test actions.

| Flow | Verified result |
| --- | --- |
| Website delivery | Two packs at PHP315 = PHP630. A 10% promo capped at PHP50 plus PHP300 delivery produced **PHP880**. Repeating the submission returned the same order without a second reservation. Stock fell from four to two; the promo's global one-use limit blocked another use while reserved. The real proof-upload/review/payment/out-for-delivery flow worked. Three payment options and copying were available; the customer page had no print button. |
| Pop-up | Two custom Ube items at PHP150 plus one Chocolate item at PHP140 = PHP440. A 10% discount produced **PHP396**. Cash PHP500 gave **PHP104 change**. Event stock fell from five to two without changing website stock. The PHP1,000 opening drawer became PHP1,396. After voiding and restoring stock, recording the PHP396 cash refund returned it to PHP1,000; closing variance was **zero**. A void alone intentionally does not remove physical cash. |
| Direct order | One website item at PHP315 plus a custom PHP200 item minus PHP15 = **PHP500** paid for products. Only the website item reserved inventory. A later exact delivery fee of PHP87 produced a PHP587 total and PHP87 balance. Cash PHP100 for that fee gave **PHP13 change**. Product payment remained recorded separately through GCash; delivery income/payment was recorded separately through Cash. The unpaid order had no automatic expiry. |

All three test orders were cancelled/voided with stock restoration before cleanup. Their accounting entries disappeared as expected. The exact test orders, event, drawer, promo and temporary dated-stock setting were then removed with guarded, ID-specific cleanup. The existing real order was unchanged, verified against its original data hash; the existing event was retained. The final queue had no pending/failed work. A redacted local audit record retains the test amounts and verification results without private order links, payment account details or customer contact data.

## Email delivery and content

**Twelve transactional notifications and one newsletter Broadcast were delivered according to Resend.** Transactional coverage included submission, shop review alert, payment approval, POS receipt, delivery-fee request/payment, out-for-delivery and cancellations. Eleven transactional messages went to the approved owner address; the real proof-review workflow also sent its normal alert to the configured shop inbox.

The newsletter used the actual campaign save/queue and Resend Broadcast flow. A temporary default-opt-out topic restricted it to the approved owner contact; the other five contacts in that shop segment were confirmed opted out of the test topic before sending. Resend reports **one sent, one delivered, zero failed/bounced/suppressed**. Stored HTML/plain text, promo content, pictures, links and unsubscribe footer were inspected. The temporary topic's owner opt-in was then removed. The sent campaign and provider records remain as audit evidence. The temporary topic is empty and retained pending the provider tool's required explicit confirmation for irreversible deletion.

The production domain's initial historical metrics showed **81 sent, 80 delivered and one old bounce**, with no failures, suppressions, complaints or delays in that result. The bounce predates this review and its cause was not exposed by the connected provider response. Every new audit message was delivered. The domain is verified for sending and scheduled queue processing was succeeding.

“Delivered” is the recipient mail server's acceptance, not proof of Primary-tab placement or that somebody opened/read the message. There was no connected recipient inbox; the owner explicitly accepted verification of Resend content and delivery status.

## Image conversion audit

Actual image decoding was used, rather than trusting filename extensions:

- **1,362 local WebP files**, including thumbnails, decoded successfully.
- All **583 unique published gallery originals** used by 620 gallery records are WebP and decoded successfully. The previously converted originals and thumbnail optimization remain intact; no further conversion was needed.
- All **103 stored product photos** decoded as WebP: 80 active product photos plus 23 additional stored photos.
- **2,117 public Academy photos** decoded as WebP with dimensions matching their records.
- Three unpublished Academy images correctly refused anonymous signed access. Their objects exist in storage and their metadata says WebP, but their bytes were not decoded in the public audit. These are private-image access checks, not missing public photographs.

Original HEIC/JPEG archives, PNG/SVG brand assets and customer payment proofs were preserved. They are not gallery conversion failures. Browser upload checks also covered HEIC/PNG conversion, image ordering and thumbnail fallback.

## Remaining limits and release steps

1. Merge this branch for the mobile POS navigation and matching admin newsletter preview/cache changes. The accounting migration and worker version 26 are already live; do not assume the static changes are live before the website deployment finishes. The source migration is safe to repeat.
2. Supabase still reports **leaked-password protection disabled**. The available connected tools do not expose that Auth setting. Review Authentication → Settings → Password security and enable it if available on the project's plan. [Supabase password-security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
3. Real bank transfers, courier dispatch, Google OAuth provider consent, recipient inbox placement and every possible device/network combination are outside these results. Email rendering used Chromium, not every native mail application. Performance checks covered browser behavior and existing loading optimizations; this was not a field Core Web Vitals measurement or a production load test.

Database advisor results did not regress after the migration. Guarded API functions and private tables retain their intentional access model; low-usage indexes were not deleted solely because the current dataset is small.

This is a comprehensive test of the implemented paths with the evidence above, not a guarantee that no future defect or external delivery failure can occur.

## Local evidence and reproduction

Detailed logs are retained in the audit checkout under `work/system-review-*.log`, with browser results/screenshots in `work/system-review-browser`, `work/system-review-live-browser`, `work/system-review-live-browser-corrected`, `tests/artifacts` and `test-results`. These local artifacts and private scratch records are excluded from this source change. The redacted live-test record is in the workspace's `outputs/system-review-20260928/live-test-audit-redacted.json`.

Use the existing Node runtime and pinned test dependencies. `scripts/test-unit.mjs`, `tests/backend/run.mjs` and `tests/edge/run.mjs` run the core suites. Browser scripts are under `tests/ui`, plus `tests/newsletter-ui.mjs`; Academy integration uses the local `scripts/academy-preview.mjs` server. Set `PGLITE_PACKAGE_ROOT`, `PLAYWRIGHT_PACKAGE_ROOT`, `BROWSER_EXECUTABLE_PATH` and `EXCELJS_TEST_PATH` to installed dependencies. `scripts/preview-emails.mjs` generates email preview fixtures. `scripts/build-static.mjs` rebuilds only the checkout's `dist` output.
