# TLB newsletter setup and acceptance

The newsletter is for new products, seasonal menus, and promotions. Account verification and order/payment/pickup emails continue independently. This feature captures consent and manages preferences; it does not create or send a marketing campaign.

## Customer behavior

- The homepage and `newsletter.html` offer a newsletter signup form. No account or purchase is required.
- Account signup has an optional, initially unchecked newsletter checkbox. Account verification and newsletter confirmation are separate emails and separate decisions.
- Signed-in customers can subscribe or unsubscribe in **My account**. Newsletter delivery begins only after a separate email confirmation.
- The shop can show a dismissible signup popup after five seconds, once the page is ready and no product or checkout dialog is open. Closing it counts as having seen it.
- For a signed-in, verified account, a database record makes the popup a once-ever prompt across browsers/devices. For a guest, local browser storage records that it was shown without an expiry. Clearing storage, private browsing, or using another browser/device can show it again. When guest browser storage is unavailable, the popup is suppressed and the normal signup forms remain available. There is no anonymous cross-device identity tracking.
- Demo pages and order-status links do not show the popup. Customers can still subscribe through the normal form after dismissing it.

Submitting a form requests a confirmation email. Its link opens a page with a confirmation button; merely opening the link does not subscribe, so an email scanner cannot confirm consent by fetching the page. Confirmation expires after 24 hours. Requesting a replacement makes the previous pending link invalid. The database stores token hashes and consent events, not the raw confirmation links.

## Resend configuration

Use these existing resources; do not recreate them or import all customers as subscribers.

| Setting | Value |
| --- | --- |
| Topic | `TLB Newsletter` |
| Topic ID | `6863284f-d41d-4ccf-b9a8-f6f196c4a4b6` |
| Topic default subscription | `opt_out` |
| Topic visibility | `private` (subscribed contacts can see it on their unsubscribe page) |
| Newsletter segment ID | `9c281ec2-ae4a-474a-8067-cf5afabc79a3` |
| Website origin | `https://thelittlebakerkitchen.com` |

After confirmation, the backend adds the contact to this segment and opts them into this topic. An account unsubscribe opts them out of this topic; segment membership can remain. Other topic subscriptions and global unsubscribe settings are preserved. A contact who previously opted out of all TLB marketing is not silently resubscribed: confirmation explains that they must use an existing Resend preference link or contact TLB to rejoin. Resolve that request only with the contact's consent.

Resend's global unsubscribe setting overrides individual topic preferences. An `opt_out` topic default requires explicit opt-in. [Resend topics](https://resend.com/docs/dashboard/topics/introduction), [unsubscribe preferences](https://resend.com/docs/dashboard/audiences/managing-unsubscribe-list).

The account page checks Resend when its stored state is subscribed, and records a provider opt-out locally. Broadcast recipient filtering remains Resend's responsibility even before the customer next visits their account.

## Deploy the backend before publishing the forms

Use the existing **TLB Kitchen System** Supabase project (`aulhqofjjckwwjmdvqgi`). Do not reset or reinstall the ordering database.

1. Apply the new migration, `supabase/migrations/20260918134354_newsletter_subscriptions.sql`, once after its prerequisites. It creates private newsletter configuration, subscriber, consent-event, and popup records plus the service-only RPC. The `tlb` schema stays unexposed; browser roles receive no table or RPC access.
2. Set the resource IDs and production origin in SQL Editor:

   ```sql
   update tlb.newsletter_config
   set topic_id = '6863284f-d41d-4ccf-b9a8-f6f196c4a4b6',
       segment_id = '9c281ec2-ae4a-474a-8067-cf5afabc79a3',
       site_url = 'https://thelittlebakerkitchen.com'
   where singleton = true;
   ```

3. Configure the Edge Function secrets below. Enter secret values through Supabase's secret settings or your existing secure deployment process; do not put them in GitHub files, screenshots, frontend JavaScript, or chat.
4. Deploy `supabase/functions/newsletter/index.ts` as the **newsletter** Edge Function, including its shared module dependency. `supabase/config.toml` sets `[functions.newsletter] verify_jwt = false` so guests can request and confirm subscriptions. Account actions still validate the bearer token with Supabase Auth inside the handler, and derive the email from the verified account.
5. Check the configuration with a controlled test inbox, then publish the frontend files together, including `newsletter.html`, the newsletter scripts/styles, and the homepage, shop, and account changes. A GitHub Pages publication alone does not install the SQL migration or Edge Function.

| Server setting | Purpose |
| --- | --- |
| `NEWSLETTER_RESEND_API_KEY` | Optional dedicated Resend **Full Access** API key for sending confirmations and managing contacts, topics, and segment membership. Preferred when set. |
| `RESEND_API_KEY` | Fallback when the newsletter-specific key is absent. An existing sending-only key is insufficient for contact/preferences operations. |
| `NEWSLETTER_FROM` | Optional verified sender address for newsletter confirmations, for example `TLB Kitchen <hello@YOUR_VERIFIED_DOMAIN>`. Preferred when set. |
| `EMAIL_FROM` | Existing verified sender used when `NEWSLETTER_FROM` is absent. |
| `ALLOWED_ORIGINS` | Comma-separated permitted website origins, including `https://thelittlebakerkitchen.com`. Preserve existing origins needed by the ordering functions. |
| Supabase server credentials | Existing project-provided URL and service-role/secret credentials; never a frontend setting. |

For a preview, use that preview's exact origin in the newsletter configuration and allowed origins so confirmation links return to the intended website. Restore the production origin before production acceptance. Do not change production email redirects merely to test an unrelated preview.

The current GitHub connector can write to `PlayerBC/TLBK-Website` but cannot push to `BrentChuaTLBK/bakery-website`. Deliver the change through a fork branch and a pull request against the original repository. The original repository owner must merge/publish it. A commit or pull request only in the fork does not update the live original website.

## Send a newsletter later

Campaigns remain a deliberate action in Resend; this installation does not schedule one.

For every future Broadcast, choose **both** the newsletter segment above and the **TLB Newsletter** topic. A segment alone is not proof of current topic consent, because unsubscribed contacts can retain segment membership. Do not select all contacts or the unrelated General segment as a substitute.

Include Resend's built-in **Unsubscribe Footer**. For a custom Broadcast template, the link target is `{{{RESEND_UNSUBSCRIBE_URL}}}`. Resend supplies the recipient-specific preference link. Do not substitute the website's signup page for an unsubscribe link. Preview the footer and recipient settings before sending. [Resend Broadcasts](https://resend.com/docs/dashboard/broadcasts/introduction), [segment and unsubscribe-link guidance](https://resend.com/docs/dashboard/segments/introduction).

## Local verification

Run the repository's backend contract tests and Edge tests using the Node version required by their runners. Backend tests use the pinned `@electric-sql/pglite` dependency from `tests/backend/package.json`. A dependency install outside the repository is supported through `PGLITE_PACKAGE_ROOT`:

```powershell
$env:PGLITE_PACKAGE_ROOT = 'C:/path/to/scratch-with-pglite-package-json'
node tests/backend/run.mjs
node tests/edge/run.mjs
```

The backend runner applies all migrations to an ephemeral local database. The Edge tests mock external services. Neither is a substitute for the controlled-inbox acceptance below. Never use real customer addresses for test fixtures.

## Manual acceptance before considering it ready

Use inboxes you control and a test account. Do not send a campaign to the newsletter segment during acceptance.

| Check | Required result |
| --- | --- |
| Homepage form on desktop and mobile | Clear purpose and confirmation message; no layout overflow; confirmation reaches the controlled inbox. |
| Before confirmation | No newsletter opt-in is created in Resend. Existing marketing preferences are unchanged. |
| Open confirmation link only | The page requests an explicit click. Provider preferences remain unchanged until that click. |
| Confirm | The page succeeds; the contact is in the newsletter segment with **TLB Newsletter** opted in; account preference shows subscribed. |
| Confirm a used link again | It is safe and cannot undo an intervening unsubscribe. |
| Invalid, replaced, or expired link | Clear failure and a route to request a fresh link; no subscription change. Test expiry locally rather than editing live customer records. |
| Account signup, checkbox unchecked | Account creation/verification succeeds and no newsletter confirmation is requested. |
| Account signup, checkbox checked | Separate account and newsletter confirmations arrive. Newsletter failure does not make account creation appear to fail or require creating it again. |
| Shop popup | Shows once after the delay, can be dismissed with its close button or Escape, and does not cover product/checkout dialogs. |
| Guest revisit | Popup stays dismissed in the same browser. A clean browser profile may show it once. |
| Signed-in revisit | Popup stays dismissed across a second browser/device for the same verified account. A different account has its own record. |
| Account unsubscribe | Only the newsletter topic becomes opted out. Other topic settings and transactional account/order email behavior are preserved. |
| Resend preferences unsubscribe | Account page reconciles the opt-out on its next visit. A fresh, separately confirmed request is needed to rejoin this topic. |
| Existing global opt-out | Confirmation does not clear it or reactivate other topics. The customer gets a useful explanation. |
| Repeated requests | The response does not reveal whether an address is subscribed. Requests are limited to one per minute and three per hour per address, 20 per hour per hashed source address, and 100 per hour overall. |
| Provider outage or partial failure | Safe error, no secrets exposed, and no false success. A busy update can require waiting up to 90 seconds before retrying; verify eventual provider and account state agree. |
| Authorization | A guest or another account cannot retrieve preferences or change the test account's settings. |
| Broadcast preparation only | A draft/test preview selects the exact newsletter segment and topic and contains the built-in unsubscribe footer. No live campaign is sent. |

Record the browser/device, action, result, and timestamp. Keep keys, confirmation links, and customer details out of screenshots and public reports. Unsubscribe the controlled test contact after acceptance if it should not receive future newsletters; retain consent/audit records.

If signup reports unavailable, check the migration/config row, function deployment, allowed origin, verified sender, and Full Access key permissions. If a retry says the preference is being updated, wait for the 90-second operation lease before retrying. Do not repeatedly rotate links, clear unsubscribe flags, or bulk opt customers in to diagnose a failure.

