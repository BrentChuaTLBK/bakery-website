# Academy album loading

Switching a batch updates its gallery and video section synchronously, preserving the class header, hero and album selector. Image metadata and signed URLs are fetched only when an image approaches the viewport. Hidden thumbnail pages and other batches' activity photos are not resolved. Album cover images still load near the viewport so visitors can choose an album.

The cache lasts for this page instance only and renews links after four minutes, one minute before Storage's five-minute expiry. Concurrent requests share pending work. A detached gallery cannot be updated by a late response. Show more observes the newly revealed thumbnails, and the lightbox requests its current photo on demand, including photos beyond the thumbnail page.

Verification: `node tests/academy-loading.test.mjs`, `node tests/ui/academy-lazy-loading.mjs`, `node tests/ui/academy-public-albums.mjs` and `node tests/ui/academy-photo-refresh.mjs`. Browser checks use the existing Playwright runtime environment variables. The 2,600-photo fixture covers delayed responses, rapid switching, expired URLs, history/refresh, retry, hidden photos and preservation of the class DOM.

Measured on 27 September 2026 using Chrome at 390×844 against the live catalog, with the changed assets intercepted locally: a new batch switched its heading in 32 ms and displayed its first photo in 1.25 seconds, versus 14.02 and 14.33 seconds before. Revisiting the previous batch took 50 ms with no image-link API calls. New-batch signing dropped from 2,117 to 24 photos. These are one-run development measurements, not a mobile-network SLA.

No image files, album records, consent settings or Storage permissions are changed by this frontend fix. The earlier `academy_bulk_asset_access` database migration, already applied during the import, is included in source control to preserve that prerequisite.
