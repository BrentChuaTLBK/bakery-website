# Publish to the existing domain for testing

Brent has chosen to test the ordering system at https://thelittlebakerkitchen.com.
This replaces the private-preview route in SETUP.md. Publication is not yet complete.

## Check the existing connection first

1. Sign into GitHub as BrentChuaTLBK and open the original repository's Settings > Pages:
   https://github.com/BrentChuaTLBK/bakery-website/settings/pages
2. Record the publishing source, branch, folder and custom domain shown there.
3. Open Cloudflare > thelittlebakerkitchen.com > DNS > Records.
   Check the website records for the root domain (shown as @ or the domain itself) and www.
4. Share those two screens for verification. Leave their values unchanged during this check.

Public DNS confirms Cloudflare nameservers and Cloudflare proxy addresses. The original
repository's CNAME file contains thelittlebakerkitchen.com. The proxy hides the underlying
origin from public DNS, so those two facts alone do not verify the exact current origin
record or GitHub Pages publishing source.

## Restore point

The pre-publication original main commit is:
571de6e9fcb51a70bafc1483a0b6fe11752f5198

A matching restore branch is saved at:
https://github.com/PlayerBC/TLBK-Website/tree/backup/live-before-ordering-20260914

The draft preserves the existing CNAME, photographs and styling. Existing brochure
pages receive Order Online navigation links. Reverting a publication merge restores
the previous website files; Supabase settings and saved orders are separate.

## Prepare the live website settings

In Supabase > TLB Kitchen System > Authentication > URL Configuration:

| Field | Value |
| --- | --- |
| Site URL | https://thelittlebakerkitchen.com/ |
| Redirect URL | https://thelittlebakerkitchen.com/auth-callback.html |
| Redirect URL | https://thelittlebakerkitchen.com/reset-password.html |

Add the redirects as separate exact entries. Keep Confirm email enabled and the
default confirmation/recovery templates intact.

In Edge Functions > Secrets, edit ALLOWED_ORIGINS. It is a comma-separated list of
origins with no trailing slash. Preserve the existing preview origin and add
https://thelittlebakerkitchen.com. If www serves the website separately rather than
redirecting to the root domain, add its origin and matching Auth redirects too.

The backend order-email site_url has already been changed to
https://thelittlebakerkitchen.com. Ordering is still paused. No owner account,
products or orders existed at the pre-publication check.

## Publish through the original repository

The connected account can write to PlayerBC/TLBK-Website, but has read-only access
to BrentChuaTLBK/bakery-website. GitHub also rejected creating the cross-repository
pull request through this connection. The original repository owner must create
and merge that publication request, or grant the connected account the needed access.

After the connection and Supabase settings above are checked, create a pull request
with these selections:

| Field | Select |
| --- | --- |
| Base repository | BrentChuaTLBK/bakery-website |
| Base branch | The branch confirmed as the current Pages source; expected main |
| Head repository | PlayerBC/TLBK-Website |
| Compare branch | development/ordering-system |

The draft PR #1 in PlayerBC/TLBK-Website targets only the fork's main branch.
Merging it alone is not the publication step for the original repository.

Review and merge the original-repository PR, then wait for GitHub Pages to finish
publishing. Confirm /shop.html and /account.html load the connected version.
Preserve the existing domain configuration. If the current Pages publishing
source differs from main and repository root, review that route before merging.

## First test after publication

1. Open https://thelittlebakerkitchen.com/account.html.
2. Register an inbox you control with a password of at least 10 characters.
3. Check your inbox and spam folder; confirm the email and sign in.
4. Have the exact verified account assigned owner access.
5. Add the test product, delivery and payment settings with ordering paused.
6. Configure automatic processing before order-email and expiry tests.
7. Open ordering only when ready for a supervised test order.

Account confirmation, real uploads, order emails and the full customer workflow
still need testing. Publishing the pages does not mean those tests have passed.

References:
- GitHub Pages source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- GitHub custom domains: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- Supabase redirects: https://supabase.com/docs/guides/auth/redirect-urls
