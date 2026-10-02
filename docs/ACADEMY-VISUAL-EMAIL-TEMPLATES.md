# Academy picture templates

Academy Newsletter and Class Email now have the visual controls used in the
main admin newsletter area: four layout choices, inbox preview text, a small
heading, headline, introduction, main picture, up to four picture highlights,
and a custom HTTPS button. The live preview and recipient review share the
same renderer used by the email worker, with desktop and mobile widths.

Pictures use the existing owner-authorized newsletter upload path. JPG, PNG,
WebP and HEIC originals up to 25 MiB are converted to email-compatible JPEGs.
Picture descriptions are required. Owners can also paste HTTPS image links.
These are public email images; private Academy attachments stay in their
existing private storage. Uploading does not create a catalogue product.

Saved templates retain pictures, card order and every design field. Selecting
another template asks before replacing the current draft. Uploads disable
save/review controls; failed uploads retain the draft and can be retried.
Navigation discards late upload results. Removing a picture from a draft does
not delete its public file, which may still be used by saved or sent emails.

The migration adds a private JSON column to existing owner-only templates,
validates bounded text/card fields and HTTPS URLs, and snapshots the design
into queued messages. Recipient consent, existing idempotency checks,
unsubscribe headers and pre-delivery eligibility checks remain enforced.
Editing or deleting a template never changes already queued mail. Existing
plain emails remain compatible. Saving and previewing do not send mail.

## Deployment status and order

Production deployment is **pending explicit approval**. Automatic approval
review rejected the email-worker deployment. No production schema or worker
changes have been made for this feature.

1. Deploy the prepared email-worker bundle, preserving its existing 12 other
   source files and custom token authentication (`verify_jwt=false` already
   existed). Only `academy-email-render.js` and the new
   `academy-email-layouts.js` change its rendering. Verify the deployed files.
2. Apply `20261002060808_academy_visual_email_templates.sql`, then verify the
   column, private grants, dispatch hooks and security advisory comparison.
3. Merge the website PR. The editor refuses to save or queue picture templates
   until the backend advertises the new capability, preventing silent loss of
   design fields during an incomplete rollout.

## Validation

- Nine new browser journeys passed in Chrome, Edge, Firefox and WebKit,
  including JPEG upload bytes, saved designs, retries, navigation, actual image
  decoding, mobile widths, the final queued message snapshot and safe behavior
  with an older backend (36 runs).
- Eight visual email database checks passed: private access, field/link limits,
  template retries, immutable queued snapshots, consent withdrawal and legacy
  compatibility. Existing resource checks (11), portal checks (19), security
  audit checks (118), isolated backup recovery and media/email tests passed.
- Four renderer tests cover legacy and visual preview/worker parity, escaping,
  all layouts, accessible structure, images, custom links and unsubscribe scope.
- Fifteen existing live-message/material/template browser checks and the
  24-page static build passed.

All accounts, queues and uploaded photo fixtures used in tests are isolated
test data. No customer email was sent. Photo previews are tested using a
loopback-only TLS fixture with a disposable certificate; production photos
continue to use their public image URLs. Real mail-client rendering has not
been verified by sending to Gmail, Outlook or Apple Mail.
