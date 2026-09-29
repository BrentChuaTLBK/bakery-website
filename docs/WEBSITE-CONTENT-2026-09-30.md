# Website content editor

The former Home page editor is now **Website content**, organized into Home page and Shop page sections. The Shop section edits the macaron feature photo beside the shop introduction, its accessibility description, and the optional caption. Leaving the caption blank hides its badge.

The editor previews the photo and caption, converts replacements through the existing WebP upload flow, and preserves drafts when switching pages. Save publishes edits to both pages together. On mobile, the page link moves below the heading and the compact Shop form keeps its save buttons below the fields.

Existing homepage slideshows, photo ordering, navigation warnings, conflict detection and owner-only access remain in place. Older editors that omit the new field preserve the saved Shop feature. Retrying an operation from before the upgrade remains idempotent. The public Shop receives the feature with its existing catalog request.

## Verification

- `tests/backend/run.mjs`: 383 checks passed with 69 migrations in the isolated PGlite database, including Shop feature validation, owner-only saving, catalog output, legacy payload preservation and pre-upgrade save retries.
- `tests/ui/homepage.mjs`: owner flows passed at 1440 px and 390 px, plus staff access at 390 px. Covered editing, actual image conversion through the browser fixture, preview escaping, page switching, save/retry, reload, public Shop rendering and homepage outage fallback. Repeated after the mobile layout adjustment.
- `tests/ui/homepage-sync.mjs`: three scenarios passed: desktop, mixed slideshow lengths on mobile, and API-outage fallback. Covered synchronized automatic transitions, keyboard/touch controls and reduced motion.
- `tests/ui/approved-loading.mjs`: desktop and mobile loading, retry, empty catalog and overflow checks passed.
- `scripts/build-static.mjs`: 23 pages built.
- Live anonymous HTTP requests to `homepage_api` browse and `shop_api` catalog returned HTTP 200 and the existing macaron photo/caption.

Browser editing and upload checks used controlled local fixtures; no replacement photo was saved to production during these tests.

## Deployment

Applied `20260929180927_website_shop_feature.sql` to TLB's live Supabase project. It extends the existing content schema and gateways without rewriting saved content. Before/after verification found revision 3 and content fingerprint `d2998d17842d8f4f7c206f56e7c222e3` unchanged. The new private helper cannot be executed directly by anonymous or authenticated clients.

The frontend becomes available after merging the source change and the normal website deployment. Until then, the existing frontend remains compatible with the updated backend.
