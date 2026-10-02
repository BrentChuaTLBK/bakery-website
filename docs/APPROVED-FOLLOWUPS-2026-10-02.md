# Owner-approved follow-ups — 2 October 2026

This release implements the four approved comparisons from the ecosystem audit: cart editing and explicit same-day recovery (4), a Custom Cakes Contact Us inquiry form (7), an authorized recent-recipe shortcut above My Classes (9), and an enrolled-class sharing action in Student Gallery (12).

Comparisons 1–3, 5–6, 8, 10–11, 13–14, 16 and 18 remain declined. Comparison 15 (Costing layout) remains a private interactive sample. Comparison 17 (Admin Orders) was subsequently approved for implementation. The separate approved Academy release is preserved when combining the branches.

## Additional requested behavior

- Orders includes Needs review, Due today and All orders views, a selected-order next-action panel, and overview shortcuts. Payment review and fulfillment use the existing authorized API and fresh order revisions. POS orders retain their existing payment workflow. Date filters use the site's branded calendar picker, including keyboard navigation and clearing the selected date.
- Orders starts with no highlighted row and the quick-action panel hidden. Clicking a row's ordinary content or empty space opens its actions; the larger Quick actions button also works with Enter or Space. Printing checkboxes and order links retain their own actions. Closing the panel, switching views or filtering the chosen order out clears the highlight without selecting another order.
- Newsletter drafts can be deleted from the list after a branded confirmation naming the subject. Queued and sent campaigns have no delete action. The existing owner-only backend checks draft status and revision again before removal.
- The Accounting save confirmation has a separate 12 px gap below its button on desktop and mobile.
- The Analytics explanation has space above and below it so it no longer touches the outcome table or capacity heading.
- The homepage header moves Order Online into the right-hand action button and includes account and basket icons. These icons stay visible when the mobile menu is collapsed; the basket opens the existing saved basket.
- Custom Cakes uses the branded calendar, prevents past dates in Philippine time, and shows only `8-inch` in the size placeholder. PNG, JPEG and HEIC reference photos are prepared before sending as bounded JPEG attachments, with previews, upload progress and retry-safe request IDs. Prepared files are reused in both Chrome and WebKit.
- New Recipe backups contain the latest saved recipes, suppliers, ingredients, packaging, current prices and current costing, plus files belonging to those records. Version history, activity/test/production logs, unsaved edits and staff schedules/access are excluded. A pinned older component formula is retained only when required by a latest recipe. Existing verified Drive archives remain available and compatible with recovery.
- Printed order summaries retain items, quantities, options and client/recipient details, without prices, totals or payment details.
- Recipe catalog pages support 100-row pagination, global search/sort, and restored filters, page and scroll position. Packaging, Suppliers, Equipment and Categories have the same navigation; Library and Costing retain their list state.
- Automatic recipe costing selects the highest eligible supplier unit price, respecting an explicit supplier preference. Recipe cards, cost details and Costing Overview use current linked ingredient, packaging and pinned component prices automatically. Overview sorting and profit filters use those current costs too. Saved snapshots remain available only as historical comparisons; no recipe review or recost approval is needed after a price update.
- Ingredient and brand renames resolve through linked IDs in recipes. Unit controls offer g, kg, ml and pcs while retaining previously saved units.
- Each recipe size can define named scaling options, base quantities, units and a default. Production and costing use those values.
- Owners can duplicate a product into an editable unpublished copy, then publish explicitly. Copies receive new product and option identities; inventory and sales history are not copied.
- Photo and receipt preparation attempts WebP first and retains genuine PNG, JPEG or HEIC originals when conversion fails or times out. Storage uses the actual MIME type and extension. Product, recipe and Academy photos retain their existing ownership/privacy rules. Payment receipts remain private and limited to 5 MB after preparation; ordinary photos are limited to 25 MB and 60 megapixels. Inquiry attachments retain their smaller email limit.
- Product saving waits for uploads. Failed photos require a retry or an explicit choice to continue without them, preventing a success message from hiding a failed upload.

## Inquiry delivery

The popup is limited to Contact Us links on the Custom Cakes page. It collects the cake brief, optional budget, reference photos and client contact details. It sends to the configured kitchen address, copies the client and supports Reply All. Submission does not create a booking, quote or marketing subscription.

The Edge Function checks the project public API key and validates bounded multipart inputs. Service-only database receipts enforce quotas, leases and retry idempotency; inquiry text and attachments go directly to the email provider. Tests use a provider fixture; no live test email is sent as part of this release verification.

## Validation

Fresh database migrations and targeted authorization tests pass. Browser fixtures cover cart edits, inquiry retries, product duplication, catalog state, scaling, linked labels, supplier prices, Academy access changes and printable order summaries. Upload tests exercise real PNG/JPEG/HEIC bytes through the client, upload handler and database, including save/reopen/refresh and failures.

The combined branch passes 45 focused server tests, the Academy follow-up checks, the incoming Academy regression suites and seven original-image browser checks each in Chrome and WebKit. Browser conversion is deliberately disabled in fallback scenarios. WebKit engine coverage does not represent a physical iPhone test.

The additional backup change passes seven database/restore checks against both the full migration set and the currently deployed baseline. Five archive unit checks and four worker/Drive checks cover checksums, legacy recovery, partial uploads, retries and real HTTP 308 acknowledgments with a Location header. The uploader now reads those acknowledgments without following redirects. Cake tests cover 1440 px and 390 px viewports in Chrome and WebKit, large PNG and actual HEIC input, unavailable WebP encoding, date bounds, progress and reuse of prepared photos. The existing 11 customer flow checks also pass.

## Rollout

Apply missing migrations by name, in this order:

1. `custom_cake_inquiries`
2. `recipe_catalog_pagination_highest_cost`
3. `recipe_linked_ingredient_labels`
4. `recipe_custom_scaling`
5. `original_image_upload_fallback`

The last migration follows the already-published `academy_original_photo_fallback`. It extends original uploads to owner teaching materials while retaining the Academy MIME, immutable path, dimensions, size, private access and storage-metadata checks.

Deploy `cake-inquiry`, `proof-upload`, `academy-media`, `recipe-kitchen-media` and `order-backup`, including their relative dependencies. Each uses existing internal authentication or the inquiry's public-project-key validation with durable quotas. Then publish the static website with updated dependency cache versions. Verify live assets and invalid/unauthenticated requests without creating customer records or sending email.

For the later corrections, apply `recipe_current_cost_defaults` and `recipe_essential_backups`, then deploy `recipe-backup` with its relative dependencies. The backup migration also works independently of the current-cost defaults change. These steps are separate from the already deployed five migrations above. Merge the website branch manually after the requested review.
