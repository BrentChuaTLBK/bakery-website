# Academy photo uploads

Batch albums now use a compact, lazy-loaded photo grid. Drag the handles or use
the arrow buttons to reorder; use the corner remove button to remove a photo
from that album. Hero, cover and finished-creation photo editing is unchanged.

Albums accept up to 2,000 photos, subject to the existing 2 MB class document
limit. The picker checks capacity before uploading or adding library images.
Upload and library actions attach photos to the album that opened the picker;
Save class draft persists changes, and Publish remains a separate action.

Private preview URLs expire after five minutes. Failed editor previews now
refresh in batches of at most 100, without rerendering or losing the draft.
Access still goes through the existing owner checks and Storage policies.

HEIC conversion uses the vendored `heic-to@1.5.2` CSP build (libheif 1.22.2),
loaded only if native decoding fails. This handles the iPhone HDR/auxiliary-image
files rejected by the previous decoder. Conversion stays in the browser and
produces WebP, at most 1600 px and 5 MB. Source originals remain unchanged.
Bitmap memory is released after conversion. See the vendor README for integrity,
source and license information.

Validation:

- All 13 supplied IMG_8354–IMG_8366 HEIC photos converted to upright 1200×1600
  WebP with all external browser requests blocked; originals are not committed.
- JPEG, PNG, AVIF, GIF and WebP conversion, uppercase/empty-MIME HEIF,
  malformed-file recovery and product-image conversion.
- 552-photo editor at 1440, 390 and 320 px: drag, touch, arrows, removal
  confirmation, reuse, save/reload, and pre-upload capacity checks.
- Expired URL recovery in bounded batches, detached/offline safety and
  preservation of draft, focus and scroll.
- Database tests: 552/2,000-photo save, 2,001 rejection, malformed lists,
  total-size limits, owner permissions and draft/public isolation.

Deployment: apply `20260926062118_academy_album_capacity.sql` and publish the
changed frontend assets. The migration is idempotent. It was applied to the
live project on 2026-09-26 during the owner-authorized recovery of 552 existing
uploads into the **2nd Summer Baking Camp / Batch 1 draft**. The exact recovery
manifest/backups remain local; they are not part of the repository or public site.
