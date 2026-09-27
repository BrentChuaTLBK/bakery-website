# Academy admin loading

The owner dashboard previously awaited signed image links for every photo in every draft class before rendering any controls. The media picker repeated that work across the entire asset library. This made navigation wait on a chain of metadata and Storage signing requests, even though most albums were closed.

The dashboard now renders immediately after its existing owner-only admin data request. A page-local image cache resolves photos near the viewport. Closed sections and unselected batch activity photos do not request image links. Opening a section activates its visible photos; returning to recently viewed photos reuses valid links. The cache expires after four minutes, ahead of Storage's five-minute expiry. Newly uploaded photos enter the same cache.

Only the selected batch's editor is rendered. Its album starts with 48 cards and offers **Show more photos** in groups of 48; the media picker uses the same limit. These are display limits only: all original photos stay in the draft, and saving always sends the complete class. Each batch remembers its displayed count while editing. Moving the last displayed photo later reveals its destination and preserves keyboard focus. Library pagination uses a stable asset snapshot so a partially successful upload cannot shift its pages.

Image retries update photos in place, preserving form fields, focus and scroll. Closing a picker, rerendering the editor, or leaving Academy releases its image observers and ignores late paints. Uploads and library selections still target the exact batch that opened the picker. Existing owner checks, draft/publish behavior, database records and Storage permissions are unchanged.

## Verification

Using the existing Playwright runtime variables, run:

```
node tests/academy-loading.test.mjs
node tests/academy-preload.test.mjs
node tests/ui/academy-admin-loading.mjs
node tests/ui/academy-albums.mjs
node tests/ui/academy-lazy-loading.mjs
node tests/ui/academy-photo-refresh.mjs
```

The admin test uses 2,600 photos across 13 batches, a 100 ms admin response and a 650 ms delay per photo-link request. On 27 September 2026, the previous implementation took 4,110–4,111 ms to mount and requested links for all 2,600 photos. The updated implementation took 123–125 ms, with zero photo-link requests blocking the editor. Measurements cover 1,440 px and 390 px browser viewports and are controlled development results, not live mobile-network guarantees. The underlying admin JSON response is still required; this change removes image-link waits from the critical path.

The tests also cover collapsed sections, selected-batch isolation, paging, boundary reordering, complete saves, upload assignment, offline retries, expired-link recovery, navigation teardown, mouse/touch/keyboard controls, 320 px layout and the existing 2,000-photo album limit. No live content is modified by these fixtures.
