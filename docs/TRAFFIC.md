# Website visitors in the admin dashboard

The **Analytics → Website visitors** section covers the website's tracked pages together. Moving between Home, Pastries, Blogs and the shop does not add a new visitor for each page.

| Card | What it means |
| --- | --- |
| Visitors today | Google's distinct `totalUsers` for today, using the Google Analytics property's timezone. |
| Active visitors · last 30 minutes | Google's distinct `activeUsers` during the latest 30-minute window. It is recent activity, not an exact count of people currently looking at a page. |

These cards refresh every minute while Analytics is visible. Changing the order date filter does not change their periods. Today's report can take longer to process than Realtime, so the two figures may temporarily differ in ways you do not expect. Browsers, blockers and different devices affect Google's visitor estimates.

Each card loads independently. An available Realtime count stays visible even when today's total is unavailable, and vice versa. A missing count shows **—** with an explanation and retries automatically. Only a valid report with no reported visitors shows **0**; missing metric headers are never interpreted as zero. Order counts, paid-order sales and refunds continue to work separately.

## Connect the visitor cards

**Goal:** give your server read-only access to your existing Google Analytics reports. The public Measurement ID records visits; it cannot read private reports.

There are two setup values. Only the first is safe to share:

| Setting | Where it belongs | What to enter |
| --- | --- | --- |
| `GA_PROPERTY_ID` | Supabase Edge Function secrets | Your numeric Google Analytics Property ID. This is **not** `G-108BDB1XQ0`. |
| `GA_SERVICE_ACCOUNT_JSON` | Supabase Edge Function secrets | The entire downloaded Google service-account JSON key. Keep it private; do not put it in GitHub, chat, a screenshot or website settings. |

### 1. Find your property

1. Open [Google Analytics](https://analytics.google.com/) and select the property for **thelittlebakerkitchen.com**.
2. Open **Admin → Property details**. Under some menu layouts, Property details is inside **Property settings**.
3. Copy the **Property ID**, which contains digits only.
4. Check the reporting timezone. Use your intended business timezone, normally **Philippines / Manila**. The dashboard displays the actual timezone returned by Google.
5. Under **Data streams**, confirm that this property contains your website stream, **G-108BDB1XQ0**. Use a property dedicated to this website: these cards include all traffic in the selected property, including any other streams you have added to it.

**Checkpoint:** you have the numeric Property ID. It is safe to send that number if you want help checking it. [Google's Property ID instructions](https://developers.google.com/analytics/devguides/reporting/data/v1/property-id).

### 2. Create the reporting account

A service account is a login for the server. Customers will not see or use it.

1. Open [Google Cloud Console](https://console.cloud.google.com/) with the Google account that manages your Analytics setup.
2. Select an existing Cloud project or create one named **TLB Kitchen Analytics**.
3. Open **APIs & Services → Library**, search for **Google Analytics Data API**, then select it and click **Enable**.
4. Open **IAM & Admin → Service Accounts → Create service account**.
5. Name it **TLB Kitchen Reporting**. Continue through creation. It needs no Google Cloud project role for reading these Analytics reports; skip the optional permission fields and finish.
6. Copy the new service account's email address. It ends in **iam.gserviceaccount.com**.
7. Return to Google Analytics → **Admin → Property access management → + → Add users**. Add that service-account email with the **Viewer** role. Email notification is not needed for this machine account. You need permission to manage property access for this step.

**Checkpoint:** the service account appears as a Viewer on the correct Analytics property. [Google's API setup guide](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart), [Analytics access roles](https://support.google.com/analytics/answer/9305587).

### 3. Save its key privately in Supabase

1. Back in Google Cloud → **Service Accounts**, open the account you created.
2. Select **Keys → Add key → Create new key → JSON → Create**. A file downloads to your computer.
3. Open [your Supabase project](https://supabase.com/dashboard/project/aulhqofjjckwwjmdvqgi/functions/secrets) → **Edge Functions → Secrets**.
4. Add `GA_PROPERTY_ID` with the numeric ID from Step 1.
5. Open the downloaded JSON file in Notepad. Copy its entire contents, including the opening and closing braces.
6. Add `GA_SERVICE_ACCOUNT_JSON` with those contents as its value. Preserve the JSON as downloaded, including the `\n` escapes inside the private key. Save both secrets.
7. Keep the downloaded key in a private location. Do not upload it to the website or repository.

If Google blocks key creation because of an organization policy, stop at that screen and ask for help; do not weaken the policy yourself. [Google's key creation steps](https://docs.cloud.google.com/iam/docs/keys-create-delete), [Supabase secret settings](https://supabase.com/docs/guides/functions/secrets).

**Checkpoint:** both secret names appear in Supabase. You do not need to share their values or generate a new key for every visit.

### 4. Check the cards

The matching database update and `website-analytics` Edge Function must be deployed, and the frontend update must be merged into the live website. See the developer deployment notes below if this is a new installation.

1. Sign in to your kitchen dashboard and open **Analytics**.
2. Click **Refresh analytics**. The setup message should be replaced by counts and a last-received time.
3. In a separate browser, visit the homepage, then Pastries or another public page. In Google Analytics, open **Reports → Realtime** and compare the same last-30-minute window.
4. Give Google time to process today's report. Compare that card with **Total users** for **Today** in the same property and timezone, without page filters. The default **Active users** metric in other reports is not identical to Total users.

One person visiting several pages is not several unique visitors. Different browsers or devices may still be counted separately.

If you see **Connect Google Analytics reporting**, one or both Supabase secrets are missing. If one count is unavailable, read the explanation under that card; the other count can still work. A missing daily total alone does not mean the saved key is wrong. Google processes daily and Realtime data separately, and the dashboard retries automatically. Only an access error calls for checking the property ID, Viewer access and enabled Data API. An ad blocker can prevent a test visit from being recorded. Access/key changes can take a little time to take effect.

## Keep tracking configured

In Google Analytics → **Admin → Data streams**, open **G-108BDB1XQ0** and keep **Enhanced measurement OFF**, as previously configured. Our tracker sends only sanitized page views. Google's automatic form, link and browser-history collection is not needed here. [Enhanced measurement guide](https://support.google.com/analytics/answer/9216061).

Coverage includes the homepage, About us, Blogs and blog posts, Contact us, Custom orders, Dessert bar, FAQ, Party carts, Pastries, Testimonials, the public shop and generic account/password-reset landing pages. The shared collector replaces the old brochure-page tags, avoiding duplicate page views. The direct 404 route and existing alternate homepage use it too.

Private order links, authentication callbacks, admin pages, links containing credentials, preview hosts and demos are excluded. Queries, URL fragments and form contents are not sent. Tracking stops before private interactions within a page. No names, contact details, order IDs, payment references, revenue or refund amounts are added by this integration. Existing Analytics opt-out is respected.

These are website-wide visitor totals from tracked activity, not a checkout funnel or a list of customers. New coverage starts after publishing and cannot recover missed historical visits.

## Developer deployment notes

- Apply the new `website_analytics_access` migration after existing migrations. It adds one service-only authorization action to `shop_service`, leaving order processing intact and avoiding its maintenance/lock on traffic reads.
- Deploy `supabase/functions/website-analytics/index.ts`, its `reporting.ts` and the shared `server.ts`. The function validates the bearer token against Supabase Auth, checks current staff membership on every request, then reads Google. `verify_jwt=false` is intentional because authorization is implemented inside the handler and supports current public keys.
- Retain the existing `ALLOWED_ORIGINS` for the live website. No DNS, email, customer account or website-hosting changes are required.
- Set the two Google secrets above server-side. The only frontend credential remains the existing public Supabase key.
- Requests use fixed Google endpoints, the `analytics.readonly` scope, no dimensions/page filters, `runReport` with today's `totalUsers`, and `runRealtimeReport` with the last 30 minutes' `activeUsers`. This prevents double counting caused by adding page totals.
- Complete reports are cached for at most 60 seconds per function instance, with current staff authorization before cache access. Partial or unavailable reports retry on refresh. Requests are deduplicated and bounded by timeouts. Cache entries expire across the property's date boundary. OAuth tokens and keys never leave the server.
- The dashboard polls only while Analytics is visible, aborts on navigation/sign-out, ignores late responses and updates only the visitor panel, preserving order filters and focus.
- Run `npm run test:analytics`, `npm run test:traffic`, `npm run test:backend` and `node tests/edge/run.mjs`. Google requests are mocked in tests; verify real reporting only after access is configured. Tests do not send real visits or emails.

[Google's reporting metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [Realtime reporting API](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runRealtimeReport).
