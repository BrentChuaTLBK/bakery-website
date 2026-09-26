# Academy draft implementation

User-approved scope: Academy Album Browser and owner CMS. Publication was requested
on 26 September 2026, with Academy replacing Blogs in marketing-page headers.
Owner-only editing; shared class creation lineup with optional batch photo tags.
102 students confirmed for the entire 2nd Summer Baking Camp, not any one batch.
Use placeholders now; do not invent or misassign photographs, dates, names or recipes.

Architecture: existing static HTML + ES modules, existing Supabase auth and private tlb
schema. Classes are atomic JSON documents with independent draft/published snapshots.
Landing settings and order also have draft/published snapshots. Stable query-string
class URLs work with current hosting. Separate private Academy media bucket with
publication-aware reads and owner-only writes. No ordering data changes.

Preview: local persistent PGlite runs the real migrations/API, with an isolated local
owner session and local image storage. QA fixture images are never part of a release.

Implemented: Album Browser with sticky desktop class list and an expandable mobile
picker; shareable class/batch URLs and browser history; class-wide creations; batch
albums, lightbox, swipe, captions and focal points; opt-in Instagram embeds with
permanent fallback links; owner-only upload/reuse/reorder/editor and separate draft
and published snapshots. PNG/JPEG/HEIC uploads reuse the existing WebP converter.

Run the local preview with Node and the existing PGlite dependency directory:
`node scripts/academy-preview.mjs`. Open http://127.0.0.1:4175/__preview/owner,
then use Preview saved draft. Changes persist locally in work/academy-preview-data.
The owner shortcut exists only in this loopback development server, never production.
Use a different ACADEMY_PREVIEW_DIR and PORT=4176 for tests/ui/academy.mjs; the QA
server intentionally uses synthetic photos and must not be mistaken for class content.

Validation: owner/staff/customer permissions; private media before publication;
draft/save/publish/edit/republish/unpublish/delete; optimistic revisions; invalid
embeds/focal positions; actual PNG-to-WebP upload and media reuse; class URLs,
refresh/back/forward; batch selection; lightbox; Instagram failure fallback; layouts
at 1440, 768, 390 and 320px. Existing backend tests also run unchanged.

Missing assets: all three classes still need verified thumbnails, hero photographs,
creation descriptions/photos, recipes/modules, and batch/activity albums. No dates,
instructors, student names or batch counts are invented. Only the camp-wide total
of 102 is supplied. New classes require a thumbnail and hero unless the owner
explicitly enables “Allow photo placeholders.” The three approved starter classes
enable this option. Public placeholders say “Photo to be added.” Empty optional
sections stay hidden publicly and are flagged in the owner preview. Publishing
always copies a validated draft to a separate public snapshot.

Release: apply 20260926023820_academy_content.sql to the existing Supabase project,
publish the three starter classes and landing settings through the owner API, and
merge the additive pages/assets/admin integration. The migration itself only seeds
drafts. The release retains the accounting and branded-email changes from PRs 68–69.
All Academy and management dependencies use the same versioned Supabase client.
The loopback preview server is a development script and is never started by hosting.

Owner workflow: open manage.html → Academy. Edit a class, upload or reuse verified
photos (converted to WebP), adjust captions/crops/order, save, and preview. Publish
the class to update its public snapshot. Unpublish hides it without deleting its
draft or media. Save/publish landing settings separately for class order and the
featured/default selection. Existing published class URLs remain stable.
