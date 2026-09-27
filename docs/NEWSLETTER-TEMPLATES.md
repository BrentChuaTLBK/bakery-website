# Newsletter templates

The owner’s **Newsletters & offers** section has six editable starting points:

| Template | Use |
| --- | --- |
| Your Sweet Perk | Special offer with a prominent promo code, terms and shopping button |
| The TLB Edit | Featured products and menu highlights |
| A Little Treat | A short offer announcement |
| Fresh From the Oven | A new product, collection or seasonal menu, led by its photograph |
| An Invitation to Bake | Academy class invitation and enquiry link |
| From Our Kitchen | A personal kitchen letter or update |

## Sending a special offer

1. Create and activate the discount in **Promo codes** first.
2. Open **Newsletters & offers → Your Sweet Perk**.
3. Choose the saved code in **Your special offer & promo code**. The editor fills the discount, minimum spend, cap, expiry in Manila time and per-account limit. Personal welcome codes, deleted codes, inactive codes and expired codes are excluded from this picker.
4. Edit the subject, message, photographs, offer copy and button. Changing newsletter copy does not change the actual promo rules. Review the terms again if the promo has changed since selection.
5. Save the draft, inspect desktop/mobile previews and send a test to your signed-in owner address if wanted.
6. **Send to subscribers** asks for confirmation and queues one Resend Broadcast. The database rechecks the code’s existence, active status, expiry and regular-code source. Personal welcome codes cannot be broadcast.

An incomplete special-offer draft can be saved. Sending or testing requires a code, discount heading and terms. No fake promo code is inserted into a new special-offer draft. The three existing templates and previously saved campaigns continue to render.

The Academy starter has no stock class photograph or invented dates. Add the class’s verified photograph and details before sending.

## Delivery and verification

Browser previews and the email worker share `assets/ordering/newsletter-templates.js`. Marketing campaigns continue to use Resend Broadcasts with the provider unsubscribe placeholder. Owner test emails remain transactional; merely saving or previewing never sends.

Deploy the matching email worker renderer and apply `20260927203047_newsletter_offer_templates.sql` before releasing the new editor. This is additive to the existing three template IDs and preserves owner authorization, revision checks, queued-content locking, audience exclusions and Broadcast idempotency.

Validation: 205 unit tests, 275 database checks across 46 migrations, and 87 Edge checks. Browser coverage includes the composer and uploads at 1440/390px and all six emails at 900/390/320px, image loading, image-blocked readability, long codes and unsubscribe links. Tests use mock delivery and an isolated database; they do not send subscriber emails.

`tests/ui/newsletter-template-design.mjs` writes a local comparison page and rendered previews under `test-results/newsletter-templates/`.
