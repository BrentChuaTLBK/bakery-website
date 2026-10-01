# Academy complete re-audit and announcement preview — 1 October 2026

This change fixes three reproduced defects and adds the requested announcement preview. Frontend changes take effect after merge and deployment.

## Behavior

- Failed Gallery filters restore the last loaded filters, chips and pagination, so a retry cannot mix results from different filters.
- Inline photo-upload errors use the same safe, readable error mapping as the enclosing form.
- An untouched optional submission category defaults to Other rather than Cookies.
- Announcement editors have a Preview button. Admin can inspect the student card and full announcement using unsaved fields and the selected photo, then return to editing. Preview performs no save, upload reservation, publication or read-state write. Existing photos use the authorized media path; local photo URLs are released when the preview closes or the route changes.
- Student announcements and Admin preview share rendering. Empty CTA URLs do not produce an unintended link. Unsafe links and text are handled by the existing URL policy and HTML escaping.

The announcement preview was explicitly requested during the audit. Upcoming-class preview, separate Save draft / Publish actions, and the other optional UI proposals remain unimplemented pending approval. Current status and scheduling rules remain in use.

## Validation

- Before preview: 61 browser checks passed in each of installed Chrome 154 and Edge 154, Playwright Firefox 153 and WebKit 26.5 (244 executions).
- After preview: 20 student UX, 13 Admin/security, seven complete Admin journeys and 11 preview checks passed in each of those four engines (204 executions). Preview checks cover zero writes, unsaved text, selected/existing photos, normal save afterward, escaping, unsafe CTA, invalid-file recovery, Escape/focus, cleanup and 320/390/768/1024/1440 px layouts.
- Hosted Chrome: 35 grouped journeys used real shared Auth, RPCs, Edge upload and private Storage, across six temporary accounts, three classes and two student recipes. Another 26 deployed SQL authorization checks passed inside a rolled-back transaction.
- Twenty-five complete touch-emulated journey groups passed on three phone sizes and portrait/landscape tablet. Real hardware and Safari were unavailable.
- The final 93-migration Academy database run passed 118 checks. Earlier regression also passed 283 unit checks, 118 Edge Function checks, 16 UX database checks, original Academy/recovery/auth/browser/newsletter checks, 83 Production recipe DB checks, six catalog checks, recipe security/R&D browser checks, checkout, 25 current ordering/operations checks and the 24-page static build. Counts overlap and are not a count of unique requirements.

The branch was rebased onto upstream `4ba6de6da41b272968da2409df7cf707d1539520`, preserving the merged Kitchen Staff security and compact-header work. All 15 follow-up suites passed: Academy database, UX, shared auth, original browser journeys, all 72 Chrome audit/preview checks, 21 Kitchen Staff database checks, 18 staff-security browser checks, five R&D browser checks and static build.

The aggregate historical ordering suite fails in `tests/backend/13-promo-usage.test.mjs` while replaying an older migration against a later rewritten query (`Unexpected admin_bootstrap promo query`). The same failure was reproduced on unchanged upstream `17880e1c4266378374a0447858a3def5756dc0a0`. Current isolated ordering/operations and checkout checks pass. This branch does not fix that unrelated test fixture.

Windows checkout CRLF required an audit-local SQL normalization preload for historical string-replacement migrations. Browser suites use actual migrated database functions with synthetic Auth/storage transport; hosted journeys are reported separately.

## Hosted cleanup

All six temporary Auth accounts and their temporary owner/instructor grants, three Academy classes, teaching copies, enrollments, submissions, threads, test communication/preference rows, five stored photos and the test Resend contact were removed. One synthetic Production import source is in Recipe trash; its immutable version is retained. No real customer, order, recipe or consent data was changed.

The two cleanup migration files preserve version history for an already-applied, expiring DELETE policy and its immediate removal. The first is intentionally a no-op history marker: fixture account and object identifiers are excluded from the public repository, and fresh installs do not recreate the expired permission. The second removes the temporary policy if present. No permanent policy is added. Rehearsing all 93 migrations passed.

## Verification limits

Hosted email-link verification and password-reset completion, physical devices/Safari, screen readers, field p75/INP, production-sized concurrent load and live disaster recovery remain unverified. Six test notifications were marked sent and one instructor-reply email was confirmed delivered; no broadcast to real audiences was sent.

The full local report contains the 59-area checklist, 21 before/proposed visual comparisons, 12 numbered recommendations, actual before/after announcement preview, detailed coverage and explicit untested risks. Remaining optional proposals require user approval.
