# TLB Academy student portal

Routes: `/academy/dashboard`, `/academy/admin`, `/academy/unsubscribe`.

This is an additive portal inside the existing static website. It uses the existing Supabase Auth customer account, `tlb.staff` Admin identity, My Account page, recipe library and Resend email worker. Public Academy marketing albums remain in `tlb.academy_classes`; protected teaching curricula use `tlb.academy_curricula`. There are no new student profiles, credentials, child accounts or public navigation links.

## Access and content

Every authenticated TLB account can view announcements, upcoming classes and approved Academy-wide gallery posts, regardless of enrollment in the originating class. Active enrollment unlocks only the assigned class, its modules/recipes, submission form and instructor conversations. Revocation blocks subsequent API and Storage access immediately. An already rendered page rechecks access on focus. Logging out and rejected access clear private dialogs and object URLs.

Only an existing owner can manage accounts, instructors, curricula, recipes, broadcasts and backups. A designated active instructor can read assigned class materials, moderate those classes' gallery posts, read submitted private work and answer conversations. Instructor access does not grant production recipe/costing or unrelated class access. Owner account search reuses Auth metadata and the phone on linked existing orders.

Student recipes are copied from a selected production version by an explicit server-side whitelist. Only description, scalar ingredient teaching fields, named groups, yield, methods with temperature/timer/equipment, baking settings, equipment and explicitly student-facing notes/tips are retained. Linked saved component formulas become independent teaching components; the parent lists the amount required and the copied component is labeled as its full formula. Source version references remain owner-only provenance. The owner can copy source product photos into independent Academy Storage using the recipe editor's **Copy product photos from source** action, or upload a teaching photo. Production file URLs are never returned to students. Each saved student edit creates another immutable-by-API version.

The tablet-oriented viewer has no export, download, copy or print controls. Browser print output hides protected material. Like any web viewer, this cannot prevent screenshots or a permitted reader from manually transcribing content.

Gallery submissions and private instructor submissions share one record with explicit visibility and moderation. Private submissions cannot be approved into the global gallery. The gallery projection excludes email, phone and account IDs, and abbreviates a voluntarily displayed name. Unsubmitted message drafts remain private to their creator and owner. Approval exposes only the approved gallery media to all authenticated users. Attachments never become public storage objects.

## Database and storage

Install `supabase/migrations/20260930193637_academy_student_portal.sql` as one atomic migration. It creates 18 Academy content/history tables and four backup infrastructure tables. Existing Auth and staff records are referenced by foreign keys. Active enrollment has a partial unique index; module/class references are composite foreign keys; independent recipe history uses `(recipe_id, version)`; private messages and per-reader state remain in PostgreSQL.

All new tables enable RLS and remove direct anonymous/authenticated grants. Security-definer public RPCs enforce current identity, owner or instructor scope and enrollment, while internal helpers are not executable by clients. Existing public Academy tables and helper grants are preserved. Customer requests cannot self-enroll, change roles, enumerate account records, read production documents or directly select private tables.

`academy-student-media` is a private bucket. Reads require authenticated Storage requests and the current `academy_portal_media_readable` decision; no public/signed links are issued. Uploads pass through `academy-media`, which remotely verifies the existing Auth user, checks reservation ownership/current access, validates WebP structure, dimensions and 5 MB size, rejects camera metadata and animation, computes SHA-256 and uses immutable paths. Failed acknowledgments can retry the same reservation; different bytes cannot overwrite it. Browser conversion strips camera metadata and limits image size. Existing small ICC color profiles from Chrome canvas are allowed.

Important RPCs: `academy_portal_api`, `academy_portal_upload_check`, service-only `academy_portal_confirm_upload`, `academy_portal_media_readable`, `academy_unsubscribe`, owner `academy_backup_api`, service-only `academy_backup_service`. The hosted migration also installs a scoped Vault worker token and a five-minute cron dispatch check when the Vault host is present.

## Email and preferences

Academy consent is independent of the existing Kitchen newsletter. Enrollment does not opt anyone in. Marketing audiences always intersect Academy consent. Owner recipient preview and queue actions support enrolled accounts, a class, an instructor's students, selected emails and Academy subscribers. Operational class communication uses a separate mode. The existing outbox, leases, retries, provider and email worker are reused; a narrow hook rechecks consent/current access before sending Academy events.

`_shared/academy-email.ts` renders escaped branded messages. Question photos are accessible only from the protected inbox. Marketing includes a postal address, an Academy-only preference link and one-click unsubscribe headers. Production email delivery has not been exercised by local fixtures. The existing email-worker must be redeployed to pick up the new renderer.

## Drive backup and recovery

Destination: `https://drive.google.com/drive/folders/1U_aOWdeTZU7P4M5IKsQR1UoKLjLoLCHG`.

Backups contain Academy data and **media metadata only**. Uploaded images/attachment bytes are NOT included and require a separate private Storage backup. Auth passwords, sessions, API secrets, unsubscribe tokens, production recipes and unrelated orders are excluded. An actor map includes existing account IDs/emails/roles for recovery reconciliation.

The archive is a ZIP with JSON table exports, a README and a SHA-256 manifest. Records are staged in a single database snapshot and paged from that immutable snapshot. Retention is 30 daily, 12 monthly and two manual slots. Daily backup becomes due at 02:00 Asia/Manila; the scheduler checks every five minutes. Monthly archives copy a verified daily archive. Success requires Drive's matching checksum/length. Interrupted jobs are marked failed and their destination invalidated. One lease prevents overlapping jobs.

The backup is disconnected by default. To provision it after deployment:

1. Reuse the existing Google service account from `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` (or `GA_SERVICE_ACCOUNT_JSON`) on the Edge runtime. Never store credentials in frontend code or exported archives.
2. Create 44 private ZIP slot files in the specified folder using the owner's Drive connection: daily 1–30, monthly 1–12, manual 1–2. Share them with the service account as writer. Preserve any existing valid archives. Do not use public or unrelated recipe backup files.
3. As the verified TLB owner, call `academy-backup` with `{action:'connect',folder_id:'1U_aOWdeTZU7P4M5IKsQR1UoKLjLoLCHG',slots:[{kind:'daily',slot:1,drive_file_id:'...'}, ...]}`. The handler verifies every file is private/editable and inside the dedicated folder before enabling the connection. This starts the first manual snapshot.
4. Verify the job reports success, inspect the archive manifest/checksums, and rehearse recovery into an isolated environment. Monitor backup status in Academy Admin. Reconnect with the same slots to resume after pausing.

Recovery must reconcile actor IDs against the target's existing Auth/Staff accounts; never overwrite credentials or create duplicate student profiles. Restore content in foreign-key order, restoring threads/messages before their media metadata. The local rehearsal clears optional production source/public-album references because those external systems are not in the Academy archive; preserve or remap them if those systems exist in the real destination. Regenerate newsletter unsubscribe tokens and reset the audit identity sequence. Rehydrate actual Storage files from a separate verified backup before making recovered image records available. Test access before switching traffic. Do not rehearse a restore over production.

## Release sequence and verification scope

The branch does not apply any production migration, deploy functions, send emails, assign real students or modify Drive files. Release requires the atomic migration, deployment of `academy-media`, `academy-backup`, `academy-unsubscribe` and the updated `email-worker`, followed by the normal static-site build/release. Keep the existing allowed origins/Auth redirects; confirm that verification and password reset callbacks preserve `next=/academy/dashboard` in production.

Run `npm run test:academy` with the repository's JSZip/Playwright dependencies and the existing PGlite test dependency. `PGLITE_PACKAGE_ROOT`, `PLAYWRIGHT_PACKAGE_ROOT` and `PLAYWRIGHT_CHANNEL` can point to installed dependencies. Windows browser tests default to installed Chrome; other platforms use bundled Chromium. `node scripts/build-static.mjs` builds the routes. Test artifacts are local under `tests/artifacts/academy-portal` and are excluded from commits/static output.

Local tests use real migrated PostgreSQL logic via PGlite, real Chrome/browser forms, real WebP conversion/validation and isolated Auth/provider transport fixtures. They cover access denial, enrollment history, moderation, mixed-class gallery access for no-class accounts, direct media checks, recipe separation/linked components, photo retries, multiple attachments, private replies/unread state, newsletter consent at send time, responsive layouts, Auth return navigation and a full metadata archive restore under foreign keys.

Live hosted Auth/Storage/Resend/Drive/cron behavior remains unverified until deployment. PGlite emulates the Supabase Auth/Storage host surface and does not reproduce the hosted services. The unchanged baseline and this branch both fail the historical promo-usage migration replay test (`Unexpected admin_bootstrap promo query`). It is unrelated to the new portal. Targeted recipe/access/backup, voucher, operations and maintenance suites pass; the existing unit suite passes 274 tests, and the Edge suite passes after supplying its existing JSZip dependency.

## Release record — 1 October 2026 (Asia/Manila)

After PR #121 was merged, the static dashboard was live while its database migration and Edge Functions were absent. With explicit production approval, the Academy migration was applied and `academy-media`, `academy-backup`, `academy-unsubscribe` and the updated `email-worker` were deployed. The authenticated dashboard SQL smoke check passed; the public REST endpoint now resolves and denies anonymous access. The media bucket is private, the backup schedule exists, and the Drive backup connection remains disabled pending its separate setup. No real test messages or enrollments were created. Hosted signed-in browser uploads, actual email delivery and Drive backup completion still need their corresponding live acceptance checks.

The follow-up branding change uses the supplied transparent Academy logo, the shorter “by TLB Kitchen” attribution, and matching newsletter preference controls. Page text, metadata, email templates and exports use the shorter public name. Apply `20260930212441_short_public_brand_name.sql` with this branding release so future queued messages capture the new shop name, redeploy `email-worker`, and publish the updated Supabase Auth templates through the normal Auth configuration workflow. Previously queued order/welcome payloads retain their saved name and original fallback rendering for provider retry consistency; their existing byte-level snapshots continue to pass. Website and module URLs include a fresh asset version for the release.
