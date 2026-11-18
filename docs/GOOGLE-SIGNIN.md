# Google sign-in for TLB

The sign-in and create-account forms show **Sign in with Google** as soon as the form opens. Selecting it starts a fresh check of Supabase’s public provider settings. If Supabase explicitly reports that Google is off, the form displays a message and lets the customer retry. If the check fails or exceeds five seconds, the site proceeds with the normal Google OAuth flow while online. The customer chooses a Google account and returns to the saved shop, account or staff destination in the same tab. Saved checkout data is preserved. Newsletter signup is a separate choice in account preferences.

## 1. Create Google credentials

Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) with the shop's Google account and select the TLB project (or create a project for TLB).

If Google shows **Get started**, configure the app name **The Little Baker Kitchen**, a support email, an **External** audience, and the developer contact email. Use the real shop contact details. For basic sign-in, the scopes are `openid`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/userinfo.profile`; no Gmail or Drive access is needed.

Under **Clients → Create client**, choose **Web application** and name it **TLB Website Sign-in**. Enter:

| Google field | Exact value |
| --- | --- |
| Authorized JavaScript origins | `https://thelittlebakerkitchen.com` |
| Authorized redirect URIs | `https://aulhqofjjckwwjmdvqgi.supabase.co/auth/v1/callback` |

Save the resulting Client ID and Client Secret. Enter the secret directly into Supabase; do not put it into browser code, GitHub, screenshots or chat. The Analytics service account credentials are separate and are not OAuth sign-in credentials.

## 2. Enable the provider in Supabase

Open the TLB project's **Authentication → Sign In / Providers → Google**. Enter the Google Client ID and Client Secret, enable Google, and save. Keep Google's normal nonce/email checks and the existing Email provider enabled.

In **Authentication → URL Configuration**, keep the production Site URL `https://thelittlebakerkitchen.com` and add this exact redirect URL to the existing list:

```text
https://thelittlebakerkitchen.com/oauth-callback.html
```

Retain the existing `auth-callback.html` and `reset-password.html` redirect entries. The Google Console redirect goes to Supabase; Supabase then returns the customer to the site's `oauth-callback.html`. These are different URLs with different purposes. The website fallback is the shop when session storage is unavailable; external or arbitrary return destinations are rejected.

## 3. Publish and validate

After enabling the provider, select **Sign in with Google** on the account page to validate the handoff to Google. A customer who reconnects can retry from the same page.

If Google keeps the app in Testing, add the controlled test accounts under **Audience → Test users** as required. Before general customer use, confirm the app's audience/publication status allows those customers and complete any branding/domain checks Google requests. Do not claim live Google acceptance based only on local mocks.

Use controlled accounts to verify a new Google signup, an existing verified email/password account with the same Google email, a pending/unverified signup, cancellation, sign-out, and return to a saved checkout. For the matching verified account, confirm Supabase retains the same user ID and that its existing order history and promo usage remain attached. Existing password login should still work. Never manually merge accounts by changing order ownership or trusting a browser-supplied email.

Supabase automatically links eligible identities with the same email and applies safeguards around unconfirmed identities. A different Google email normally creates a separate account. A Google-only user has no separate website password until one is set through the supported password flow.

## Validation and assets

Run `node tests/ui/google-signin.mjs` with Playwright available (`PLAYWRIGHT_PACKAGE_ROOT` and `BROWSER_EXECUTABLE_PATH` can select the installed runtime). Set `BROWSER_ENGINE=webkit` to run the same checks with the iPhone 15 Pro Max profile. Run `node tests/newsletter-ui.mjs` for account and newsletter flows. The Google checks cover disabled, unavailable and slow provider settings, retry after reconnection, OAuth launch, return destinations, cart preservation, account history and callback handling. Provider identity linking itself requires live acceptance after credentials are configured.

`assets/img/brands/google-signin.svg` is the unmodified official light pill button from Google's Android + Web SVG asset bundle, downloaded on September 19, 2026. Its text is drawn as paths, so it does not depend on a remote font.

References: [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Google branding and approved assets](https://developers.google.com/identity/branding-guidelines).
