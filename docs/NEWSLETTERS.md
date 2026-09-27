# Owner newsletters and welcome offers

Promo codes contains Newsletter welcome offer settings: percentage or fixed PHP amount, product minimum, optional percentage cap, validity in days, and optional final expiry in Manila time. Each new welcome code stores its own terms. Changing settings does not alter issued codes or already queued email payloads. Signup copy, homepage invitation and shop popup fetch the current public offer. Newsletter signup remains optional; successful email or Google signup suppresses the popup.

The owner-only Newsletters page provides The TLB Edit, A Little Treat and From Our Kitchen layouts. Edit subject, inbox preview, copy, photo URLs, featured products, offer details and the main button. Save drafts, preview mobile/desktop, and send a test to the signed-in owner email. A separate branded confirmation queues a campaign to eligible subscribers. Any advertised code must be an active regular promo; a personal welcome code cannot be broadcast.

Main and featured-product photos can also be uploaded directly. JPG, PNG, WebP and HEIC originals up to 25 MB are resized to a maximum 1600px dimension and converted to JPEG. The existing owner-only public image upload endpoint validates the converted file and stores a unique, permanent URL. Uploads update the preview and retain other unsaved fields; save the draft to persist the URL. Replacing a photo does not overwrite images already used in sent newsletters. No database or email-worker deployment is required for this upload feature.

Campaigns freeze their content when queued. Repeat or concurrent send requests cannot queue the same campaign twice. The existing email worker checks current local consent and provider suppression before delivery. Campaign unsubscribe links work without signing in and do not invalidate other current unsubscribe links. Order emails have priority over campaign messages. The dashboard counts provider acceptance, skipped recipients and failures; acceptance does not guarantee inbox delivery.

## Deployment

Deploy the email worker with the updated shared email renderers and assets/ordering/newsletter-templates.js, then apply 20260927090000_newsletter_management.sql and publish the frontend. Existing NEWSLETTER_RESEND_API_KEY / NEWSLETTER_FROM and EMAIL_WORKER_TOKEN configuration is reused. Do not change the provider audience or consent settings. No campaign is queued by migration or deployment. No customer data is included in the source release.

## Validation

Database suite: owner permissions, immutable issued-code terms, fixed/percentage settings, final expiry, optimistic revisions, test recipient restriction, queue idempotency, opt-outs, unsubscribe links and migration replay. Browser suites: twelve-batch navigation with retained edits, album Back to top, signup consent and popup suppression, Google callback, and responsive newsletter editing/confirmation. Edge/unit tests: escaped templates, dynamic welcome terms and provider suppression.
