# Connect and test the ordering draft

Complete these steps on the development copy and its preview. Keep the live website and `main` unchanged until the owner accepts the draft. All service account creation, plan choices, DNS changes, billing, and actual email tests below are actions for the owner. No secret belongs in public code, a Git commit, or a chat message.

The assigned draft address is [the ordering preview](https://tlb-website-ordering-preview.brentchua1223.chatgpt.site). Use the exact URLs below once the preview has been deployed and opens successfully. This is an owner review environment; if its access settings are private, email links require your signed-in, authorized preview browser. Keep guest tests within your own authorized sessions. Customer account access and the preview host's access controls are separate. Opening the preview to additional testers requires an intentional hosting access change.

Read [SERVICES.md](SERVICES.md) for current free limits and paid alternatives. The default catalog is empty and ordering is paused. There are no fabricated products, bank accounts, delivery zones, pickup hours, or live orders.

## 1. Create a separate Supabase test project

1. Open [Supabase](https://supabase.com/dashboard), create or sign into your account, and create an organization on **Free**. Review the plan selection yourself; selecting Pro or paid add-ons introduces charges.
2. Create a new project for the ordering **test environment**, choose a region appropriate for your customers, and save its database password privately. Do not reuse a production project.
3. In project settings / API keys, record the project URL and **publishable** key (or legacy `anon` key). These two values are public client configuration. Do not copy a secret key or `service_role` key into the website.
4. Open the SQL Editor and run `supabase/migrations/202609130001_ordering.sql` from this repository in this fresh project. Run it once. It creates the schema, protected RPCs, empty catalog, default paused settings, and storage buckets. If you are using the CLI workflow below, use that instead of separately pasting the same migration.
5. Confirm Storage contains `payment-proofs` as **private** and `product-images` as **public**. Do not make proofs public or add broad browser write/read policies. Product photos intentionally become public when uploaded.

Optional CLI workflow, run from the repository after installing the official [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started):

```sh
supabase login
supabase link --project-ref YOUR_TEST_PROJECT_REF
supabase db push
```

Review the linked project before `db push`. Never run it against a different existing database. The migration owns its `tlb` schema and should not be used as an unreviewed repair script.

## 2. Verify your email sending domain

1. Create or sign into [Resend](https://resend.com), choose the **Free transactional** plan, and inspect its daily/monthly limits. A paid upgrade or pay-as-you-go is your decision and is not required for controlled testing within the free quota.
2. Add an owned sending subdomain in Resend → Domains, for example `mail.YOUR-OWNED-DOMAIN`. This example is a placeholder, not an existing TLB address.
3. At your DNS provider, copy the exact DKIM and SPF records shown by Resend (TXT, MX, or CNAME as generated). Do not replace existing mailbox MX records unless you understand the DNS change. Wait until Resend shows **Verified**; changes often propagate quickly but can take up to 72 hours. Add the recommended DMARC record following the provider guide.
4. Choose a sender such as `TLB Kitchen <orders@mail.YOUR-OWNED-DOMAIN>`. The domain must be verified. Resend does not require a separate mailbox for each From address; use the shop's real contact details for customer replies and concerns.
5. Create a sending API key in Resend. If restricting it to a domain, choose that verified domain. Store the value privately; it is used as the Supabase SMTP password and an Edge Function secret. Keep click tracking disabled for these secure links.

You cannot send normal customer email from `onboarding@resend.dev`; that test sender is restricted to your Resend account address. [Resend domain setup](https://resend.com/docs/add-a-domain), [domain restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## 3. Configure account verification and recovery mail

In Supabase Authentication → Email under Notifications → SMTP Settings, enable custom SMTP and enter:

| Setting | Value |
|---|---|
| Sender name | `TLB Kitchen` |
| Sender email | Your verified-domain sender address without the display name |
| SMTP host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | Your private Resend API key |

In Authentication → Providers → Email, keep email/password signup and **Confirm email enabled**. Set minimum password length to **10** and email OTP/link expiry to **3600 seconds** (one hour). The exact field grouping can vary with dashboard updates. The repository's local configuration uses the same defaults. Supabase manages secure token generation, expiry, password hashing, and verification. Review Auth Rate Limits: custom SMTP initially allows 30 email messages/hour, separate from Resend's 100/day Free quota. [SMTP instructions](https://resend.com/docs/send-with-supabase-smtp), [Supabase email limits](https://supabase.com/docs/guides/auth/auth-smtp).

Use the default confirmation and recovery templates with `{{ .ConfirmationURL }}`. They preserve Supabase's signed verification endpoint and configured redirect. If you intentionally customize templates, preserve their secure token handling; the client also supports token-hash callback templates, but custom templates are not required for this setup.

In Authentication → URL Configuration:

| Field | Test value |
|---|---|
| Site URL | `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/` |
| Redirect URLs | `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/auth-callback.html` |
| Redirect URLs | `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/reset-password.html` |

Add both concrete callback URLs above. Do not authorize all websites on a shared hosting domain. If the assigned preview address changes, update both callbacks and the site root. When the approved production site is published, add its two exact callbacks and set Site URL to production. Retain only previews you still use. [Redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## 4. Deploy protected functions and configure secrets

Create a random worker token locally, keep it private, and use the same value for the Edge secret and scheduler Vault secret. One way to generate it on your own computer is:

```sh
openssl rand -hex 32
```

In Supabase → Edge Functions → Secrets, enter:

| Secret/configuration | Value |
|---|---|
| `RESEND_API_KEY` | Your private Resend sending API key |
| `EMAIL_FROM` | Your display name and verified sender, e.g. `TLB Kitchen <orders@mail.YOUR-OWNED-DOMAIN>` |
| `EMAIL_WORKER_TOKEN` | The random token above, at least 32 characters |
| `ALLOWED_ORIGINS` | `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site` — no path or trailing slash; separate additional explicitly authorized origins with commas |

Supabase supplies its own project URL and service credentials to hosted functions. The code supports legacy service-role keys and current secret-key dictionaries. Do not create custom secrets starting with reserved `SUPABASE_`. [Secret management](https://supabase.com/docs/guides/functions/secrets).

Deploy the three functions from the linked development repository:

```sh
supabase functions deploy proof-upload
supabase functions deploy proof-url
supabase functions deploy email-worker
```

The tracked `supabase/config.toml` disables the gateway JWT check only for these functions. This is intentional: `proof-upload` authorizes a secure order token or real account, `proof-url` validates staff identity, and `email-worker` requires the private worker token. Do not remove those checks. If deploying through the dashboard instead, retain the `_shared` modules and set equivalent JWT-check settings.

Edit only `assets/ordering/config.js` with your **public** project URL and publishable/anon key. Redeploy/restart the test preview so it loads that file. Never put `RESEND_API_KEY`, `EMAIL_WORKER_TOKEN`, a database password, or a Supabase secret/service-role key there. If one is accidentally exposed, remove it and rotate it through the provider before continuing.

## 5. Create the first owner safely

1. Open `account.html` on the configured preview. Register your own email, receive its verification email, and open the verification link. Confirm it returns to the preview and successfully verifies the account. Sign in.
2. In the **test project's** SQL Editor, replace the placeholder below with that exact registered and verified address, then run:

```sql
insert into tlb.staff (user_id, role)
select id, 'owner'
from auth.users
where lower(email) = lower('YOUR-VERIFIED-OWNER-EMAIL')
  and email_confirmed_at is not null
on conflict (user_id) do update set role = 'owner';

select u.email, s.role
from tlb.staff s join auth.users u on u.id = s.user_id;
```

The result must show your correct email as `owner`. If no row is inserted, verify the account first and check the address; do not disable confirmation to work around it. There is no public first-owner setup endpoint. Additional staff must create and verify accounts before an owner grants roles in admin.

3. Open `manage.html`. Confirm the catalog is empty and ordering paused. Configure real business contact details, pickup address/hours/instructions, manual-payment information, delivery zones/fees/window, production schedule, non-production dates, fulfillment closures, lead times, and reminder settings.
4. Set **Site URL** in Business settings to `https://tlb-website-ordering-preview.brentchua1223.chatgpt.site/`. This URL supplies secure guest-order links in transactional emails and is separate from Supabase's Auth Site URL. Set it again for the approved production deployment later.
5. Create your explicitly named acceptance-test product, options, and dated capacities. Unpause ordering only after test settings are complete. No product import is needed.

## 6. Enable the database scheduler

This worker expires orders that received no proof before their 60-minute deadline and queues eligible fulfillment-day reminders in Asia/Manila. Orders with proof under review do not expire merely because staff have not reviewed them. Reminder eligibility is rechecked before delivery; completed/cancelled/expired orders and old fulfillment dates are excluded. New-order transactions also perform expiry cleanup.

In Supabase Database → Extensions, enable `pg_cron`, `pg_net`, and Vault (`supabase_vault`) if not already enabled. In the private SQL Editor, create Vault secrets with these three names, replacing each placeholder yourself:

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'tlb_project_url');
select vault.create_secret('YOUR_PUBLIC_PUBLISHABLE_KEY', 'tlb_publishable_key');
select vault.create_secret('YOUR_PRIVATE_RANDOM_WORKER_TOKEN', 'tlb_email_worker_token');
```

Keep the private token out of source files and screenshots. If these names already exist, update the existing Vault entries rather than creating duplicates. Install the job once:

```sql
select cron.schedule(
  'tlb-order-maintenance-and-email',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'tlb_project_url') || '/functions/v1/email-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets
                 where name = 'tlb_publishable_key'),
      'x-worker-token', (select decrypted_secret from vault.decrypted_secrets
                         where name = 'tlb_email_worker_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
```

The job scans every five minutes. An email can therefore arrive several minutes after a configured reminder time, plus provider delivery latency. Each run sends at most three queued emails so it stays within a short worker lifetime; a larger backlog takes additional runs. Increase frequency to once per minute for acceptance tests if desired, then monitor free quotas. Do not use a browser tab timer for production maintenance. [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions), [Cron](https://supabase.com/docs/guides/cron).

Inspect runs:

```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'tlb-order-maintenance-and-email';

select status, start_time, end_time, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job
               where jobname = 'tlb-order-maintenance-and-email')
order by start_time desc limit 10;

select id, status_code, timed_out, error_msg, created
from net._http_response order by created desc limit 10;
```

Cron SQL success means the HTTP request was queued, not that email reached an inbox. Check the HTTP response and Edge Function logs as well. Do not expose request headers or Vault contents when sharing logs. To stop the test job:

```sql
select cron.unschedule('tlb-order-maintenance-and-email');
```

## 7. Verify real account and order mail

These are owner acceptance steps, not claims of completed tests. Use a real inbox you control; keep the total within provider limits. Open the full preview in a browser window when testing email links.

| Test | Action | Expected result |
|---|---|---|
| Verification | Register a new test address and receive its email | Secure link returns to `auth-callback.html`; the account becomes verified. Repeat using Resend verification from the account screen. |
| Recovery | Sign out, request Forgot password for an existing account, receive mail, open the link, save a new password | Link returns to `reset-password.html`; new password works and old password fails. Reusing an already consumed or expired link cannot reset the account. A recovery-page refresh after tokens are consumed may require a fresh link. |
| No account disclosure | Request recovery for an unregistered address | Neutral on-screen wording; no claim that this address has an account or received mail. |
| Cart continuity | Enter a cart/date/checkout details, then sign in or verify | Return to the shop with cart and entered details preserved. |
| Submission | Place one guest test order using your inbox | Persisted reference and 60-minute deadline on screen. Email has item/options summary, PHP totals, instructions, deadline, and private `shop.html#order=…&token=…` link. Open it in a signed-out window. |
| Proof / approval | Upload a PNG/JPEG/WebP ≤5 MB with reference, then approve in admin | Proof changes payment only to Under review; admin approval sets Paid/Confirmed and sends its confirmation. Only staff can open private proof through a five-minute URL. |
| Rejection | Submit another test proof and reject it with a reason | One rejection/cancellation message with reason/contact details; no proof resubmission or automatic instruction to pay again. |
| Expiry / cancellation | Leave a test order without proof for 60 minutes; cancel a separate test order | Expiry releases unpaid reservations after maintenance; cancellation mail includes reason and does not claim a refund. |
| Readiness | As admin set an appropriate paid order Ready for pickup or Out for delivery | The matching notification is sent only when the admin changes status. |
| Reminder | Set a paid active test order due today and reminder time to a few minutes ahead in Manila | One reminder after the scheduled time/worker run. Move another order to a different date before its reminder; no old-date reminder. Cancel/complete others; no reminder. |

Compare the recipient inbox with Resend → Emails, provider email ID, and admin email-queue status. `sent` means accepted by Resend; a `delivered` provider event means the receiving server accepted it, and inbox/spam inspection confirms receipt. If mail is absent, check Verified domain, sender match, SMTP credentials, daily/hourly quotas, suppression/bounce logs, correct callback URLs, Business Site URL, worker secrets, and cron HTTP results. No email is sent from an unconfigured local preview.

Check the admin queue for errors. Transient failures retry with backoff and the same idempotency key. Messages with too many failures or uncertain delivery approaching the 24-hour idempotency window stop and need investigation; do not blindly reset their status. Compare Resend logs for that event/provider ID before deciding whether a retry is safe. [Provider idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

For controlled bounce/suppression tests, Resend provides `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`, and `suppressed@resend.dev`. Those simulate delivery events and cannot establish real inbox receipt. Never send to random addresses or `example.com` for acceptance testing. [Test addresses](https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing).

Complete the broader scenarios in `docs/ACCEPTANCE.md` when available and record each outcome yourself. Repeat the callback, access-control, upload, transactional-mail, and cron checks after any approved move from the test project to production. A live project requires separately reviewed settings, credentials, backups, capacity planning, and deployment approval.
