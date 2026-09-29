# Voucher and account release audit — 29 September 2026

Release checked: `fea574d` / PR #105, live at thelittlebakerkitchen.com. The live database has migration `20260929114159`; voucher campaigns remain inactive.

## Finding and fix

**Email preference retry dropped the wallet refresh callback.** After a temporary preference-loading error, clicking Try again and successfully subscribing could leave the newly earned welcome voucher invisible until a manual refresh. The retry now retains `onChange`. Account script versions are updated so returning visitors receive the fix after deployment. A browser regression reproduces the failure and verifies recovery at four viewport widths.

No additional calculation, inventory, voucher eligibility, or delivery failures were found in the checks below. No database or email-worker changes were needed for this audit.

## Automated checks

| Suite | Result | Coverage |
| --- | --- | --- |
| Full backend | 380 checks passed; 65 migrations | Website orders, stock reservations/releases, POS, direct orders, cash sessions, promos, accounting, newsletter and calendar contracts |
| Fresh voucher/order database | 35 checks passed | Qualifying website completions, first/every-order limits, idempotency, guest/account ownership, existing welcome codes, refunds/reuse, revisions, expiry, percent caps, reports and private access |
| Unit tests | 221 passed | Calculations, exports, rendering and existing business rules |
| Edge functions | 109 passed | Email handling, provider suppression, retries, idempotency, calendar and analytics regressions; includes nine new voucher-worker scenarios |
| Account/campaign browser | Passed at 1440, 768, 390 and 320 px | Brand fonts, wallet tabs, four-card pagination, details dialog/Escape, preference error recovery, draft/activate workflow, email preview, calendar and 51-recipient report pagination |
| Real checkout browser with isolated API fixtures | Passed | Pickup/delivery fields, voucher link → existing basket → reload → Apply → review → discounted order; private order links and invalid voucher fragments |
| Newsletter browser | Passed | Signup, preferences, unsubscribe, private-token removal, optional signup and invitation suppression |
| Production build | Passed | 23 static pages |

The 35-check voucher run includes 20 order contracts also exercised by the full backend suite. Counts are suite results, not unique scenarios.

**POS and Direct Message orders never earn thank-you vouchers.** Tests create and complete both channels through their APIs, verify no reward/completion record, then verify the same customer's first website order can qualify.

New delivery checks cover a valid queued message plus opt-out, unsubscribe in progress, replacement consent, changed account email, source refund/cancellation and expiry before sending. The worker checks global/topic suppression, missing contacts, provider outages, rate limits, acknowledgement failures and identical retry bodies/keys. A personal thank-you code is also rejected when an owner tries to queue a newsletter broadcast containing it.

## Live checks

- Deployed account/sign-up, shop and newsletter pages rendered without script errors or horizontal overflow at 1440 and 390 px. The account uses Chelsea Market and Lobster.
- Anonymous requests to the personal wallet, campaign administration and campaign reports were denied. Anonymous email-worker invocation returned 401.
- One clearly labeled test-only completed website order exercised the actual production issuance trigger, outbox, consent check and scheduled email worker. Its campaign was paused in the same transaction that created the fixture, before becoming visible to other sessions. The test did not consume product inventory or create a Google Calendar event.
- Resend reported the message **delivered**, on the first attempt, to the owner's approved test address at approximately 20:39 Manila time. The returned HTML and plain text had the correct discount, minimum spend, exact Manila expiry, account instructions and unsubscribe link, with no unresolved template placeholders. The delivered HTML was also rendered at 600 and 390 px and visually inspected.
- The temporary order, campaign, voucher, promo, completion record, unsubscribe token and outbox row were removed after verification. Final live counts returned to **3 orders, 9 promos, 0 campaigns, 0 vouchers**, with no test calendar event and no pending/sending/failed email backlog. Existing newsletter consent was preserved. No staff access or test login was created.

## Verification limits

Authenticated browser paths use local API fixtures; database permissions and voucher lifecycle rules are exercised separately, with live anonymous-access checks and a real production voucher notification. The live email test uses a controlled zero-value order fixture rather than collecting a customer payment. Resend delivery confirms acceptance by the receiving mail server; this audit does not inspect Gmail inbox/spam placement or every email client. No new load test was performed. Future provider outages and untested combinations cannot be ruled out by a finite test suite.

Local evidence is in `test-results/vouchers/`, `test-results/voucher-full-audit/` and `work/full-audit-*.log` (not published as website assets).
