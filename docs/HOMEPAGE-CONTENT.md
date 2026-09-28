# Home page editor

Owners can open **Home page**, immediately before **Academy** in the kitchen dashboard.

Choose **Main banner**, **Custom Orders**, **Pastries**, **Party Carts & Events**, or **Baking Classes**. Each has its own ordered photo list. All current photos are retained as the initial version. A slideshow accepts 1–50 photos; a single photo stays still, and multiple photos rotate every four seconds.

- **Add photos** accepts multiple local files. Uploads convert to WebP and resize to a maximum dimension of 1600 px using the existing image conversion and authenticated upload service.
- Select a thumbnail to edit its description or replace it. Use the arrows to change the order. Remove takes a photo out of this slideshow after saving; it does not delete a shared original from Storage.
- The main banner supports a heading, short introduction and up to two buttons per slide. Clear a button's text to remove it. Button destinations must be local website pages, such as `academy.html` or `shop.html`.
- The four category cards also have editable button labels and destinations. Their photo lists remain separate from the actual category galleries and Academy albums.
- **Save home page** publishes all five slideshows together. **Discard changes** restores the last saved version. **View home page** opens the published page.
- Navigating away warns about unsaved changes. If another owner window saved first, saving is rejected without losing the local edits; copy any needed text before reloading the saved version.

## Implementation and verification

`public.homepage_api` exposes `browse` publicly and restricts `admin_get` / `save` to verified owners. Content stays in the private, RLS-enabled `tlb.homepage_content` table. Writes validate WebP photo URLs, page links, limits, IDs and revisions; retries reuse the same operation ID. Uploads reuse the existing `product-images` bucket and `proof-upload` authorization.

The homepage makes one small configuration request without loading the Auth SDK. The original HTML is retained while the default revision is untouched or the request fails. Managed carousels reuse Bootstrap, retain responsive image variants, preload the next slide and provide previous/next, swipe and pause controls. Reduced-motion visitors start with autoplay paused.

Run `tests/backend/run.mjs` and `tests/ui/homepage.mjs`. The browser suite uses local fixtures and verifies the real editor, navigation permissions, WebP conversion, saves, unsafe-link errors, concurrency error retention, responsive rendering, rotation and an unavailable-backend fallback without publishing test content.
