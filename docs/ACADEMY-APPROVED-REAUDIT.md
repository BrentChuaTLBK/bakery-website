# Academy approved re-audit improvements — 2 October 2026

Implements the owner's approval of visual comparisons 01–21 from the complete re-audit. The four retained views keep their existing layouts. The baking view has no step-completion checkboxes. Student recipe editing follows the Recipe Maker's component and row-based structure while keeping the teaching-only data model.

## Approved behavior

| Approved views | Result |
| --- | --- |
| 01 | Shared TLB login and signup keep Academy-specific context when the validated return destination is Academy. |
| 02–04 | Overview shows up to four classes; zero-class accounts get useful discovery links; larger My classes lists have title search. |
| 05–06 | Longer classes have recipe search and module jumps. Ask and Share are available near the class title. |
| 07–08 | Component selection keeps the matching yield, ingredients, method, equipment and baking settings together. All components remains available. Quantities are unchanged; there is no step checklist or separate scrolling ingredient panel. |
| 09–10 | Student Gallery and its post viewer retain their layouts and navigation. |
| 11–12 | Confirmed submissions show the chosen audience and a next action. Gallery work awaiting approval is never described as published. |
| 13 | Private photos open in a large, keyboard-accessible viewer. Threads retain student/class/module/recipe context and local date/time. |
| 14–15 | Student Upcoming and Announcement cards retain their layouts. |
| 16 | Instructor and student conversation lists support subject/student-name search, last-message previews and bounded older-page loading. |
| 17 | Admin attention cards link to Needs reply and pending Gallery review using matching server predicates. |
| 18 | Moderation photos support the same authorized large-image viewer. The Gallery queue excludes private submissions before its existing result limit. |
| 19 | Student recipe editor has structured quantities, units and approved brands; component selection; section jumps; add/remove/reorder with local Undo; and a student preview including selected and saved photos. Method controls sit beside their headings; shorter instruction boxes and expandable temperature/timer/equipment details reduce scrolling. Existing detail values stay visible in the summary. |
| 20 | Announcement and Upcoming editors separate draft/publish actions. Both preview unsaved content; Upcoming reuses the unchanged student card. Photo-upload retries retain the first saved intent. |
| 21 | Failed photos retry locally with bounded backoff. Permission denial removes cached display data and offers no public URL fallback. |

## Data and access boundaries

- New private `tlb.academy_reaudit_read` uses SECURITY INVOKER, an empty search path and no direct grants to public, anon, authenticated or service_role. The existing authenticated public wrapper dispatches authorized requests.
- Search and pagination retain `academy_thread_access`, use stable `(last_activity, id)` keyset ordering and return at most 50 rows. Legacy `threads` remains an array capped at 100 for already-open clients.
- Last-message previews use submitted messages only. Needs reply means the latest submitted sender is the student and the conversation is unresolved; unread and open are not synonyms for unanswered.
- Recipe/module names and recipe links use current class and curriculum relationships. No Production fields are introduced.
- Photo viewing rechecks authorization on open, previous/next, window focus and a 15-second interval while open. Route/account cleanup revokes blob URLs and closes viewers. There is no server-push revocation notification; a change on another session is observed on the next check.
- Structural Undo preserves text typed into surviving rows after an add/remove/reorder. Quantities, mixed units and multiline instructions round-trip as strings. Saving still creates an independent student version.
- Preview performs no record save, photo reservation/upload, publication or announcement read-state write. Saved recipe photos require an authorized read; newly selected photos remain local until saving.

## Validation

- New browser suite: 17 end-to-end checks in Chrome 154, Edge 154, Firefox 153 and WebKit 26.5 — 68 successful executions, including final saved-photo previews and confirmation actions.
- Existing affected Chrome suites: 91 successful checks covering student UX, upload/retry and permission failures, owner/instructor workflows, original portal journeys, announcement previews and shared TLB authentication.
- Database suites: 19 original portal, 118 security/audit, 16 previous UX and seven new re-audit checks — 160 successful grouped checks against all 95 migrations.
- The new database cases page through 112 conversations with equal timestamps; verify scope, literal search, cursor bounds, read state, latest-sender counts, private moderation exclusion and revocation using an old cursor.
- Academy recovery passed, all six Academy Edge tests passed (including the two original-photo cases), all 63 selected checkout/shop/recipe rule tests passed, and the 24-page static build passed.
- All 21 primary screenshots have no horizontal page overflow or unlabeled form fields. The editor was additionally checked at 320/390/768/1024 px. Device sizes are emulated; WebKit is not a claim of physical Safari/iPad testing.
- Existing checks whose exact copy changed were updated to the approved wording/actions; their behavior and permission assertions remain.

Counts overlap in coverage and are not unique requirements. Browser flows use real UI and migrated PostgreSQL in an isolated fixture harness, with synthetic Auth/storage transport. These new frontend flows are not represented as live-production verification before merge.

## Student original-photo safeguard

Student work and conversation photos try the normal resized, metadata-stripped WebP path first. If that conversion fails, validated PNG, JPEG and HEIC originals are accepted unchanged up to 25 MB, 60 megapixels and 16,384 pixels per side. The existing eight-photo limit, private audience, approval, enrollment and retry rules remain. Other admin/catalog image workflows continue to require their normal optimized output.

The browser and upload service share structural byte inspection; changing a file extension does not admit SVG, PDF, GIF or other formats. Storage uses the actual MIME type and a canonical file extension. Reservations retain the original format; upload confirmation verifies its storage metadata. The server preserves immutable retries and rejects mismatched contents or denied access.

The form explains when it is using an original because camera metadata may remain. A browser that cannot render an accepted HEIC shows a saved-original message without an endless photo retry. Native HEIC display still works where supported.

Uploaded rows with `mime_type <> 'image/webp'` identify the later-conversion backlog, with a partial index and a `conversion_pending` flag on authorized media reads. No recurring conversion job was scheduled. A future conversion should preserve the media ID and audience, write the converted WebP to its canonical private path, and atomically update MIME type, dimensions, size and checksum after verification; originals should not be removed until the replacement has been checked.

Validation adds five browser scenarios in each of Chrome, Edge, Firefox and WebKit (20 executions), three database checks, and two Edge tests. Tests force unavailable WebP encoding and HEIC decoding; confirm byte-for-byte original preservation, private access, retry without duplicates, and rejection before drafting for an unsupported file. Real HEIC checks use the public libheif example and the existing public class-gallery fixture locally; external/generated image fixtures are excluded from the publication. The PNG/JPEG test generator uses tiny synthetic pixels.

Migration `20261001191118_academy_original_photo_fallback.sql` and Academy media Edge function version 2 are applied. Hosted checks confirm the private bucket, exact MIME allowlist/limits, private helper/confirmation grants and all four deployed source hashes. An unauthenticated upload probe returns HTTP 401. Authenticated complete upload journeys were tested in the isolated harness, rather than by creating new live accounts.

## Deployment and review

Migration `20261001182831_academy_approved_reaudit_conversations.sql` was applied to the connected TLB project. Server checks confirm the private/public function grants and denial of the three new reads without an authenticated user. Security advisor categories/counts are unchanged from the pre-migration baseline: 111 RLS-without-policy INFO findings, 10 anonymous and 20 authenticated SECURITY DEFINER warnings, and one existing leaked-password-protection warning. This change introduces no new advisory finding. [Supabase advisor reference](https://supabase.com/docs/guides/database/database-linter).

The source branch targets `BrentChuaTLBK/bakery-website:main`. Frontend behavior takes effect after the owner merges and the normal website deployment completes. The database read additions preserve the prior client contract. No customer rows, private recipes, branding assets or newsletter consent were changed by this implementation.

The companion local HTML report contains all 21 actual BEFORE/AFTER comparisons plus eight real completed-flow/editor/preview views. Primary captures use equivalent synthetic fixture data; supplemental submissions are performed afterward so they do not change inbox or moderation counts in the comparison. Screenshots and generated test artifacts remain outside the public source commit.

The overview and selected-component recipes are shorter. Search and context add some space to class/thread screens, and the explicit recipe editor is taller than the delimiter-based form. The editor's section jumps and component selection help navigate that tradeoff; the report shows the full pages rather than hiding the increased height.
