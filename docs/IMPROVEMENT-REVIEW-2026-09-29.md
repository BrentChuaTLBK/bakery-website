# TLB improvement review — recommendations only

This review follows the completed functional regression. **None of these optional recommendations has been implemented.** The checkout scroll/focus bug and test/runbook corrections are covered separately in `PRODUCTION-AUDIT-2026-09-29.md`.

The current order engine has useful safeguards already: server-authoritative prices, atomic stock/promo reservations, idempotency, revision checks, separate event inventory, explicit cancellation stock decisions, private proof storage, and state-aware email retries. Keep those mechanisms. The strongest next work is the loading experience and image delivery, not a replacement commerce platform.

## Measurement context

After the full regression stopped, four public pages were measured in Chrome at 390 × 844 with a cold browser cache, 4× CPU throttling, 4 Mbps download, 100 ms emulated latency, and a six-second observation period after DOM readiness. These are **single laboratory samples**, not field percentiles, Lighthouse scores, or an INP assessment. DevTools MCP was unavailable; native browser observers and CDP network measurements supplied the evidence. Signed URLs and private content are omitted here.

| Page | Observed LCP | Observed CLS | Initial transferred data |
| --- | ---: | ---: | ---: |
| Homepage | 4.08 s | 0.032 | 1.55 MB |
| Shop | 2.50 s | 0.235 | 1.59 MB |
| Party carts | 0.85 s | 0.358 | 0.79 MB |
| Academy | 6.20 s | 0.262 | 1.63 MB |

The shop's footer moved when the catalog replaced its loading state. Academy had the same loading-to-content movement. On party carts, the packages section moved when the gallery/content arrived. Homepage LCP was its banner image. Academy LCP was the class hero.

Google's good field targets are LCP ≤2.5 s, CLS ≤0.1 and INP ≤200 ms at the 75th percentile. The samples above identify candidates for investigation; they do not establish real-user pass/fail rates. [Google's Web Vitals guidance](https://web.dev/articles/vitals).

The original 37 live price quotes were fast from this machine: median 124 ms, p95 183 ms, maximum 285 ms. There is no evidence here that pricing needs a new cache/database architecture. Cumulative database statement statistics (including earlier traffic and tests, not just this audit) showed about 66 ms mean execution for the shop gateway and 220 ms for Academy. Their observed maxima were 1.23 s and 2.65 s. These are neither percentiles nor isolated end-user timings, but support profiling Academy before broad database changes.

## Quick Wins

### Q1. Serve the existing smaller homepage banner variants on mobile

- **Observed:** A 390 px viewport requested `HomePage1-1600w.webp`. Its `sizes` rule describes a 900 px slot on narrow screens. Existing 400/800/1600 variants are 25,714 / 72,632 / 169,696 bytes.
- **Why improve:** The browser can choose a larger image than the visible banner needs, contributing to the 4.08 s sample LCP.
- **Recommended change:** Adjust the `sizes` description to the actual rendered/cropped slot after checking desktop, mobile and high-density screens. Keep the brand image and its intended crop.
- **Expected benefit:** About 97–144 KB less for this image when the 800/400 variant is appropriate; faster first impression without creating new artwork.
- **Difficulty:** Easy. **Risk:** Low. **Priority:** High.

### Q2. Give content pages specific search descriptions

- **Observed:** About, contact, custom orders, pastries, party carts, FAQs, blogs and testimonials reuse the same generic description. Shop lacks a canonical link in the scanned markup.
- **Why improve:** Search previews do not clearly distinguish what each page offers.
- **Recommended change:** Write a short accurate description per public content page and review canonical URLs. Keep account/admin/auth pages out of content marketing work.
- **Expected benefit:** Clearer search previews and fewer ambiguous duplicate page signals; no ranking guarantee.
- **Difficulty:** Easy. **Risk:** Low. **Priority:** Medium.

## Performance

### P1. Reserve the final layout while public content loads

- **Observed:** Shop/Academy footers and party-package sections moved substantially during initial loading; measured CLS was approximately 0.235/0.262/0.358 respectively.
- **Why improve:** A page can have no horizontal overflow and still feel unstable as controls and text move under the customer.
- **Recommended change:** Give the catalog, Academy hero and party-gallery loading containers realistic minimum dimensions/aspect ratios or a small matching skeleton. Preserve current typography and final layout. Verify that empty/error states do not leave large blank areas.
- **Expected benefit:** More stable reading and fewer accidental taps during loading. Confirm with repeated before/after traces.
- **Difficulty:** Moderate. **Risk:** Low. **Priority:** High.

### P2. Reduce photo bytes before adding more JavaScript optimizations

- **Observed:** Several shop images fetched during the initial mobile load were 180–227 KB each; an Academy image was 317 KB. These are already WebP, so “convert everything to WebP” is not a useful recommendation.
- **Why improve:** Format conversion alone does not provide an appropriately sized image for every card or device.
- **Recommended change:** Generate a small set of responsive derivatives at upload time, use accurate `srcset`/`sizes`, and retain the original/display-quality version for enlargement. Check crop, orientation and sharpness using the established photo workflow.
- **Expected benefit:** Lower mobile transfer and Supabase egress while preserving full-size viewing. Measure actual savings per derivative instead of promising a fixed percentage.
- **Difficulty:** Moderate. **Risk:** Medium, because upload metadata and existing-image fallback must remain compatible. **Priority:** High.

### P3. Standardize caching for immutable public uploads

- **Observed:** Some UUID-named public product-image responses had `no-cache`; others had `public, max-age=3600`. Static website assets generally advertised ten minutes.
- **Why improve:** Inconsistent metadata may cause avoidable revalidation on repeat visits.
- **Recommended change:** Inspect upload cache metadata and serving headers, then use a consistent longer policy for immutable, versioned public image URLs. Replace the URL whenever a photo changes. Keep private proofs private and signed Academy URL expiry behavior intact.
- **Expected benefit:** Faster repeat browsing and fewer origin requests. First-visit savings are limited.
- **Difficulty:** Moderate. **Risk:** Medium if replacement invalidation is mishandled. **Priority:** Medium.

## Customer Experience

### C1. Explain the custom-cake inquiry route before customers expect a configurator

- **Observed:** Custom cakes are represented by galleries/inquiries and staff-entered custom direct-order items. There is no public cake configurator with automatic prices.
- **Why improve:** Customers may expect to select a design and check out directly when they arrive from the shop.
- **Recommended change:** Add a concise explanation of the inquiry process and the information to send: date, servings, design reference and budget. Keep a clear contact action next to the gallery. Do not promise automatic availability or pricing.
- **Expected benefit:** Fewer incomplete inquiries and less staff follow-up without building a complex configurator.
- **Difficulty:** Easy. **Risk:** Low. **Priority:** Medium.

## Ordering Experience

### O1. Summarize the limiting item when a mixed cart needs a later date

- **Observed:** Lead-time and availability checks are correct, but mixed carts can produce several item-specific messages. Actual Nori products currently have same-day ordering disabled by owner choice.
- **Why improve:** Customers need a clear next action, rather than needing to interpret multiple production rules.
- **Recommended change:** Show one plain-language basket summary naming the item that determines the earliest eligible date, with a calendar action to review available dates. Retain per-item detail and the server's final check. Only show same-day messaging when the product, cutoff, fulfillment method and stock all permit it.
- **Expected benefit:** Fewer invalid-date attempts and less confusion about mixed lead times.
- **Difficulty:** Moderate. **Risk:** Medium; customer wording must match existing rules and closed-date behavior. **Priority:** Medium.

### O2. Make the calendar horizon explicit

- **Observed:** The enforced window is the current month plus the next two calendar months, not a rolling 60-day period.
- **Why improve:** Calling it simply a “two-month window” can imply a different last date.
- **Recommended change:** State the actual final bookable date in calendar help, derived from the existing shared rule. Keep the same date limits.
- **Expected benefit:** Clear expectations without loosening lead-time or capacity checks.
- **Difficulty:** Easy. **Risk:** Low. **Priority:** Medium.

## Conversion

### V1. Measure where customers leave before changing checkout length

- **Observed:** The flow intentionally separates review, order reservation, manual payment and proof upload. The audit verified these steps but could not inspect GA4 property-level funnel data.
- **Why improve:** A long form may feel like the problem when abandonment actually occurs at date availability or payment proof.
- **Recommended change:** Add/verify a small privacy-safe funnel: product opened, cart started, valid date chosen, review reached, order created, proof submitted, payment approved. Keep client attempts distinct from server-confirmed outcomes and deduplicate order conversion events. Exclude names, addresses, social handles, proof URLs and private order links.
- **Expected benefit:** Evidence for useful changes instead of aggressive sales popups or guesswork.
- **Difficulty:** Moderate. **Risk:** Medium because tracking can double count or expose private URL parameters if implemented carelessly. **Priority:** Medium.

## Admin Experience

### A1. Add saved operational filters if the order list becomes repetitive to use

- **Observed:** Staff work across payment review, fulfillment calendar, direct orders and POS. Those workflows already exist; a replacement dashboard is unnecessary.
- **Why improve:** Repeated navigation/filter selection will cost more time as orders grow.
- **Recommended change:** Consider a few named views—payment review, today's pickups/deliveries, upcoming preparation, direct delivery fees still pending—using existing status rules. Display counts and preserve the selected view on return.
- **Expected benefit:** Faster daily triage with fewer missed manual actions.
- **Difficulty:** Moderate. **Risk:** Low. **Priority:** Medium.

### A2. Make event stock preparation reusable without copying sales history

- **Observed:** Event setup correctly separates selected catalog items, event prices, custom flavors and stock from selling. Recurring pop-ups can require similar setup.
- **Why improve:** Re-entering the same lineup and flavors invites mistakes.
- **Recommended change:** Offer “copy lineup to a new event,” with explicit fresh dates and stock counts. Never copy orders, sold/retained counts, drawer sessions or payment history.
- **Expected benefit:** Less event preparation work while preserving inventory separation.
- **Difficulty:** Moderate. **Risk:** Medium. **Priority:** Low until recurring-event frequency justifies it.

## Automation Opportunities

### U1. Alert only on actionable stuck email/calendar work

- **Observed:** Cron and provider acknowledgements worked during this run. The application already distinguishes skipped obsolete email jobs from delivery failures and exposes email alerts.
- **Why improve:** A quiet failure after an external outage could still require someone to notice the dashboard.
- **Recommended change:** Add a bounded operational alert for sustained failed/leased-too-long jobs, with deduplication and a recovery notification. Reuse existing idempotent retry logic; do not automatically approve payments, change stock or issue refunds.
- **Expected benefit:** Earlier detection without noisy routine messages or duplicated customer mail.
- **Difficulty:** Moderate. **Risk:** Low to Medium. **Priority:** Medium.

## Technical Improvements

### T1. Make the full regression reproducible from one documented entry point

- **Observed:** There are 53 passing suites, but Academy dialogs depend on a seeded local preview; browser/HEIC/XLSX dependencies require several environment variables. An initial fixture failure could be mistaken for a production defect.
- **Why improve:** A large suite loses value if setup and sequencing depend on one person's working directory.
- **Recommended change:** Add a portable runner that checks dependencies, starts/seeds the isolated preview, runs core/browser suites, stores artifacts, and guarantees cleanup. Keep live tests as a separately gated command with a request budget and exact fixture manifest.
- **Expected benefit:** Reliable repeat audits and faster diagnosis of genuine regressions.
- **Difficulty:** Moderate. **Risk:** Low. **Priority:** High.

### T2. Add release checks for the actual deployed asset version

- **Observed:** The source checkout can pass while the live site still serves the previous GitHub Pages deployment. This audit's UI fix explicitly needs a production merge.
- **Why improve:** “Merged” and “tested live” are different states.
- **Recommended change:** After deployment, verify a build/version marker and run a small read-only smoke test against the served files and public APIs. Keep the larger destructive/failure suite isolated.
- **Expected benefit:** Fewer stale-cache or incomplete-deployment surprises.
- **Difficulty:** Easy to Moderate. **Risk:** Low. **Priority:** High.

## Database / Supabase

### D1. Measure admin-query growth before adding pagination or indexes

- **Observed:** `admin_bootstrap` returns the order collection, while current live quote latency was low. The performance advisor reported 16 unused-index observations on this low-traffic database.
- **Why improve:** A full collection can become costly as history grows, but an unused index today may protect an important future lookup or relationship.
- **Recommended change:** Record bootstrap response size/latency and inspect query plans as order volume grows. Introduce server-side pagination and targeted filters when measurements warrant it. Review index usage across a representative business period before removing any index.
- **Expected benefit:** Controlled scaling and lower bandwidth without prematurely complicating the small current dataset.
- **Difficulty:** Moderate. **Risk:** Medium for query/API changes. **Priority:** Medium for monitoring; Low for immediate structural changes.
- **Reference:** [Supabase unused-index advisory](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

### D2. Provide an explicit test-data cleanup process

- **Observed:** Database fixtures were removed precisely, but deleting three private proof objects needed storage privileges unavailable through the current tools. Automatic review rejected the proposed privileged helper pending specific approval.
- **Why improve:** One-off service-role cleanup endpoints add operational friction and should not become a normal maintenance pattern.
- **Recommended change:** Define a supported admin-only cleanup command with a dry-run manifest, test-only ownership checks, dependency ordering, Storage API deletion, calendar tombstone acknowledgement and a cleanup receipt. It must refuse real customer data by default.
- **Expected benefit:** Safer, reviewable future live testing and fewer orphan test files.
- **Difficulty:** Moderate. **Risk:** High if scope checks are weak; require dedicated tests and explicit use. **Priority:** Medium before the next live audit.

## Security

### S1. Enable and verify leaked-password protection

- **Observed:** Supabase's security advisor reported leaked-password protection disabled. No compromised account was demonstrated.
- **Why improve:** Strong-looking reused passwords can already be present in breach lists.
- **Recommended change:** Review the Auth plan/settings, enable supported leaked-password checks, align signup/reset guidance with the configured password policy, and test rejected and accepted passwords using a disposable account.
- **Expected benefit:** Additional account hardening without changing the ordering model.
- **Difficulty:** Easy. **Risk:** Low; existing users may need clearer guidance when changing passwords. **Priority:** High.
- **Reference:** [Supabase password-security documentation](https://supabase.com/docs/guides/auth/password-security).

### S2. Document intended public gateways instead of blindly applying security-definer warnings

- **Observed:** Supabase flags public/authenticated security-definer entry points. The tested gateways reject unauthorized staff actions and private table access; private helpers are intentionally inaccessible.
- **Why improve:** Future maintainers need to distinguish intentional access from an accidentally exposed helper.
- **Recommended change:** Maintain a small gateway/role contract and run permission tests after each migration. Investigate new advisories individually; do not revoke the customer API to silence a warning.
- **Expected benefit:** Less chance of either a privilege leak or accidentally breaking checkout.
- **Difficulty:** Easy to Moderate. **Risk:** Low for documentation/tests. **Priority:** Medium.
- **Reference:** [Supabase security-definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Analytics

### N1. Add operational conversion and capacity measures alongside sales

- **Observed:** Paid-order edits and exclusions for cancelled/refunded orders reconciled correctly. Raw sales alone do not explain held stock that expires or unavailable dates.
- **Why improve:** The owner needs to distinguish demand, fulfillment limits and payment follow-through.
- **Recommended change:** Prioritize proof-submission rate, expiry rate, paid conversion, capacity utilization by product/date, pickup versus delivery mix, and promo redemption after cancellations. Retain source splits for website, direct message and pop-up. Define the denominators and refund treatment explicitly.
- **Expected benefit:** Better stock planning and useful diagnosis of abandoned manual-payment orders.
- **Difficulty:** Moderate. **Risk:** Medium if metrics are derived from inconsistent statuses or dates. **Priority:** Medium.

## TLB Academy

### B1. Shorten the first class/hero loading path

- **Observed:** The mobile sample's Academy LCP was 6.20 s. Three Academy RPCs took approximately 701/822/929 ms, followed by two signing requests of 164/371 ms. The hero was a signed image. Existing offscreen album lazy loading is useful and should stay.
- **Why improve:** The first impression waits for data and image authorization even though most albums are not yet being viewed.
- **Recommended change:** Trace which calls are dependent, combine only redundant first-view data, prioritize signing/fetching the selected class hero and visible covers, and defer album details until needed. Preserve publication/privacy checks and signed-URL refresh behavior.
- **Expected benefit:** Earlier visible class content and lower first-view work. Validate with repeated traces; timings cannot simply be added as guaranteed savings.
- **Difficulty:** Moderate. **Risk:** Medium. **Priority:** High.

Keep direct Instagram links rather than restoring heavy automatic embeds. Keep the owner's curated photo order; optimize delivery, not the choice of photos.

## SEO & Discoverability

### E1. Improve semantic headings and add only truthful structured data

- **Observed:** The scanned homepage contained 16 `h1` elements and testimonials 31; party carts/dessert bar contained two. No JSON-LD was found on the scanned pages. Several page descriptions are generic.
- **Why improve:** Headings currently reflect visual styling more than a clear document outline, and machines receive little explicit business/class information.
- **Recommended change:** Review the outline while retaining appearance, use lower heading levels for cards/testimonials, and add accurate Bakery/LocalBusiness data plus class/product data only where required facts are maintained. Do not invent ratings, availability, dates or prices. Handle unique Academy class URLs/canonicals deliberately.
- **Expected benefit:** Clearer navigation for assistive technology and better machine-readable content. Rich-result eligibility or ranking is not guaranteed.
- **Difficulty:** Moderate. **Risk:** Low to Medium due to content maintenance. **Priority:** Medium.

## Nice-to-Have

### H1. Installable POS shell after mobile workflow priorities are settled

- **Observed:** The POS already separates selling from setup and passed mobile interaction tests. The owner said internet is available; offline selling is not a current requirement.
- **Why improve:** An installable shortcut/full-screen shell could reduce navigation chrome for frequent counter use.
- **Recommended change:** Consider a small manifest/install experience and reliable online status messaging. Do not add offline order queues, stock reconciliation or background payments merely to call it a web app.
- **Expected benefit:** Convenience at recurring events without changing transaction semantics.
- **Difficulty:** Easy to Moderate for an online-only shell. **Risk:** Low without service-worker caching of authenticated/payment responses. **Priority:** Low.

## Prioritized roadmap

**Do first:** Q1 mobile banner sizing; P1 loading-layout stability; B1 Academy first-view path; S1 leaked-password protection; T1/T2 reproducible tests and deployment smoke checks. Approve each scope before implementation.

**Do next:** P2/P3 responsive upload derivatives and public-image caching; O1/O2 date-rule clarity; Q2/E1 content metadata/headings; V1/N1 a useful privacy-safe funnel and operational measures; U1 actionable job alerts.

**Later:** A1 saved staff views if daily use warrants them; A2 reusable event lineups; D1 pagination when measured growth demands it; H1 an online POS install shell. Put D2's cleanup process in place before another large live-data audit.

**Not worth changing right now:** Replacing Supabase/Postgres, moving to a framework rewrite, changing the proven cent-based pricing/stock transaction engine, changing actual Nori same-day settings against the owner's preference, or rebuilding package browsing that already exposes details without repeated clicks.

**Complexity to avoid:** Offline POS synchronization without a demonstrated need; aggressive caching of availability or private order data; automatic payment approval/refunds; broad “remove unused indexes” cleanup; autoplaying Instagram embeds; a full custom-cake configurator before inquiry volume and pricing rules justify it; elaborate recommendations/loyalty features before basic funnel evidence.
