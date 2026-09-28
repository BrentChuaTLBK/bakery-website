# Live system stress test — 29 September 2026

Production target: thelittlebakerkitchen.com. Tests used a verified temporary owner account and isolated, clearly labeled stock, orders, promos and a POS event. All load generation has stopped. The owner subsequently requested a 500-request ceiling; the previously completed runs cannot be undone. Future live load tests must have an agreed total request budget before starting.

## Findings and changes

1. **Email backlog — fixed and deployed.** The original worker claimed only three messages per minute. A 16-message order/cancellation burst delayed one payment-instructions message by 308 seconds. The worker now drains up to five batches of three, paces sends 750 ms apart, preserves provider idempotency keys, stops claiming after a failure or its 25-second claiming budget, and defers broadcasts after a long run. Each claimed batch is completed. Deployed as email-worker version 27. Before testing stopped, eight new order/expiry messages were accepted in one scheduled run, 9–12 seconds after being queued. These are different-sized batches, not a like-for-like throughput benchmark. Resend subsequently showed all 26 test messages, including account verification, delivered. A rejoin welcome was correctly skipped after the account opted out again.
2. **Dashboard contention — measured; remains a scaling consideration.** At 100 simultaneous dashboard requests, p95 reached 5,291 ms and the maximum was 8,895 ms, with every response HTTP 200. Further escalation stopped at the latency threshold. The shop API's broad transaction lock is a likely contributor; this pass did not remove locks protecting inventory and payment correctness. A future change should separate read paths and measure it locally before another budgeted live check.
3. **Small-screen Pastries overflow — fixed in source.** A long category name forced the select wider than a 320 px screen. Controls now have a bounded width and zero intrinsic minimum width. Stylesheet versions were advanced. Local browser regression coverage includes the long category name at 320 px. Website publishing still requires merging the source change.
4. **One intermittent static asset failure.** The desktop Party Carts visit received HTTP 503 for party-cart-photos.js. Its later mobile visits succeeded. No persistent cause was established; this remains an observation, not a confirmed application fix.
5. **Auth advisor notice.** Supabase reports leaked-password protection disabled. No auth configuration was changed. Other reviewed advisor notices describe deliberately private tables with no direct row policies and public dispatcher functions; tested privileged shop actions rejected anonymous/customer callers. This is not an exhaustive penetration test.

## Load actually executed

These are total requests and maximum concurrency, not simultaneous customer counts or a guarantee of capacity.

| Endpoint mix | Concurrent | Requests | p95 | Maximum | Result |
|---|---:|---:|---:|---:|---|
| Public reads | 1 | 12 | 376 ms | 376 ms | All 200 |
| Public reads | 5 | 60 | 404 ms | 513 ms | All 200 |
| Public reads | 10 | 100 | 377 ms | 687 ms | All 200 |
| Public reads | 25 | 150 | 542 ms | 641 ms | All 200 |
| Public reads | 50 | 300 | 925 ms | 1,065 ms | All 200 |
| Public reads | 100 | 500 | 1,369 ms | 1,696 ms | All 200 |
| Dashboard reads | 25 | 100 | 926 ms | 996 ms | All 200 |
| Dashboard reads | 100 | 400 | 5,291 ms | 8,895 ms | All 200; stopped escalation |
| Mixed public/dashboard run | 20 | 2,000 | 405 ms | 1,049 ms | All 200; 52 seconds |

Total measured load-stage reads: **3,622**, plus functional requests, browser resources and cleanup. Peak tested concurrency: **100**, not 2,000. No 200-concurrent stage ran. No additional load was started after the owner requested stopping. Provider billing/usage was not estimated from these counts.

## Live functional results

| System | Evidence |
|---|---|
| Website inventory | 30 competing checkouts for seven units produced exactly seven orders. Cancellation restored reservations; unpaid orders expired. |
| Submission retries | 25 simultaneous identical website submissions produced one order. Changed content with the same submission key was rejected. |
| Promo limits and totals | 20 competing uses of a one-use promo produced one eligible order. Two flavored items: PHP 230 subtotal, PHP 30 capped discount, PHP 200 total. |
| Invalid checkout input | Negative/fractional/excessive quantities, incorrect flavors, closed/past dates, unsupported methods and localities were rejected. |
| Guest privacy and staff permissions | Wrong order tokens failed; guest responses omitted private fields. Twelve staff operations each rejected anonymous and ordinary verified customer access before the temporary role was granted. |
| POS flavor stock | 100 concurrent sales competing for seven flavor units produced seven sales and 93 expected stock rejections. |
| POS retry safety | 50 identical digital-payment submissions produced one sale. |
| Shared cash drawer | 20 simultaneous opening retries produced one session. PHP 500 opening float + PHP 980 cash sales + PHP 10 cash-in = PHP 1,490 expected/count, zero difference. GCash remained separate. |
| Concurrent drawer edits | 15 competing movements at one revision accepted one; stale edits and insufficient cash were rejected. |
| Direct orders | Catalog and custom prices combined correctly. Of 20 competing paid-order amendments, one saved. Spoofed catalog price was ignored; paid status stayed paid as requested. |
| Later delivery fee | PHP 405 amended products plus PHP 87 delivery = PHP 492. Twenty payment retries recorded the separate delivery payment once; PHP 100 tender produced PHP 13 change. |
| Accounting | The amended paid order contributed exactly PHP 492 net. Live workbook generated 10 worksheets; offline inspection found 460 bordered/vertically aligned cells, 43 formulas with cached results, no Excel error cells. |
| Newsletter subscription | Eight simultaneous signups converged on one subscriber. Invalid/unauthorized requests failed. Opt-out, rejoin and another opt-out completed through the actual provider integration. Test contact ended unsubscribed. No broadcast was sent to the real mailing list. |
| Email | Actual account-verification, order-instructions, cancellation, expiry and welcome messages delivered according to Resend. Sample HTML/plain text contained expected amounts and links, with no unresolved template placeholders. |
| Google Calendar | Edited test delivery synchronized privately with the updated PHP 492 total and correct date. Deletion synchronized successfully; no test calendar records or pending/errors remained. |
| Upload boundaries | Renamed text was rejected with 415, oversized image with 413, unauthorized proof URL with 401. Invalid/stale order upload rejected. No proof object was retained. |
| HEIC conversion | Actual production browser module converted a 1,379,983-byte HEIC to valid 1200×1600 WebP (201,434 bytes) and JPEG (347,816 bytes). Empty, forged JPEG and unsupported SVG inputs were rejected. |
| Browser UI | 17 public pages and 17 authenticated dashboard sections visited at 1440, 390 and 320 px: 102 visits. No JavaScript errors or broken images recorded; public-page exceptions are noted above. Dashboard sections had no document overflow. |

## Cleanup and final state

Removed all 24 temporary orders and their financial/stock records, both temporary products and their daily inventory, the test POS event and drawer, test promos, and test subscriber records. The provider contact was unsubscribed. Logged out the temporary account, removed its owner role, deleted it, and removed locally saved credentials. Test email provider records remain as delivery evidence.

Final database: **3 original orders, 37 products, 0 events, 9 promos, 1 original staff owner**. All three original order row hashes and the shop-settings data hash matched the baseline. Zero test inventory, staff membership or auth sessions remained. Calendar pending/errors and unfinished email outbox counts were zero. Database deadlocks remained zero.

## Limits and validation

This is a finite live concurrency and functional audit, not a 100% guarantee. No real bank transfer was made, inbox placement was not independently inspected, no large marketing broadcast went to customers, and a new successful payment-proof storage roundtrip was not included in this pass. File-conversion checks were representative, not a conversion of every stored asset. Browser layout timings are lab observations, not certified Core Web Vitals. The exported workbook was structurally inspected, not recalculated in desktop Excel.

Local verification of the changes: 100 Edge tests passed, including burst pacing and failure handling; gallery browser tests passed using local fixtures only. Source tests and private production harnesses remain separate; no credentials or private order links are included in the source changes.

Reference: [Supabase function runtime limits](https://supabase.com/docs/guides/functions/limits). The worker keeps claiming bounded rather than leasing the entire backlog. [Supabase password protection notice](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
