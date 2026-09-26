# TLB email design

Shared cream/chocolate design with peach and sage details, a public raster logo,
readable system fonts, a 720px desktop frame, and stacked mobile order columns.
All customer order events, staff review notices, pickup reminders and both
newsletter welcome variants use the same layout. Ordered products show the first
public product image captured when the notification is queued. Missing or blocked
images leave names, quantities, options and prices readable. Some older email
clients cannot display WebP; product information never depends on the photo.

The 13 Supabase account/security templates are generated from the same layout.
They preserve `{{ .ConfirmationURL }}` and the documented token/account variables.
Security notifications are not enabled by this change. Their templates are ready
if those notifications are already enabled or are enabled later.

## Preview

Run `node --experimental-transform-types scripts/preview-emails.mjs`, then open
`test-results/emails/index.html`. These are clearly labelled sample orders/prices;
the generator never sends an email or creates an order. Browser previews check
900, 390 and 320px layouts, blocked images, headings, alt text and link names.
They do not substitute for a native Outlook/Apple Mail inbox rendering test.

## Release

1. Deploy email-worker with the new shared layout, branded renderer, and existing
   server/newsletter helpers. Keep its existing worker-token authentication.
2. Apply `20260926031326_branded_email_design.sql`. New and never-attempted pending
   messages receive design version 2. Previously attempted messages retain version
   1 and the exact old renderer for provider idempotency. Product photos are saved
   in outbox payloads; the worker never looks up changing menu data during retries.
3. Supabase Authentication → Email templates: paste the generated HTML from
   `supabase/templates/<template>.html` in each matching template, then Save.
   Alternatively apply only the `mailer_templates_*_content` keys in the generated
   `test-results/emails/supabase-auth-templates.json` using the Management API.
   Do not change SMTP, redirects, security-notification toggles or expiry settings.
4. `supabase/templates/newsletter-campaign.html` is the reusable draft for future
   Resend campaigns. Replace the clearly marked copy and preview before sending;
   keep the Resend unsubscribe placeholder. No campaign is scheduled by this change.

Order senders remain `orders@thelittlebakerkitchen.com`; newsletter senders remain
`news@thelittlebakerkitchen.com` via the existing worker secrets. No credentials,
real customer data, private order tokens or payment proofs belong in preview files.

References: [Supabase templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
