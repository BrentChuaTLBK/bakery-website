# Staff Kitchen Recipe Access & Security

Implemented 1 October 2026. This guide describes the completed application behavior.
Deployment and verification evidence are recorded in `STAFF-RECIPE-SECURITY-RESULTS.json`.

## Daily owner workflow

Open **Recipes & costing → Staff Access → Access Calendar**.

1. Search/select staff, or choose **Select all active**.
2. Tap one or more dates, or enter a start/end date and select the range.
3. Choose **Block Selected Dates** or **Restore Scheduled Access**.

One request updates every selected staff/date pair. Six or more pairs require a
confirmation showing staff count, dates and total changes. Selected names remain
visible. Normal dates continue using the person's hours. **Mixed** explicitly
states how many selected staff are blocked. Saturday and Sunday are normal workdays.
Previous/next month, Today, clear selection and future scheduling are supported.

**Undo** restores the previous values for the latest calendar action by that owner,
within 30 minutes, only if nobody has changed any affected pair since. Undo never
overwrites a newer edit. Failed requests roll back; retrying the same request ID
cannot create a second batch. The API supports up to 500 staff, 366 dates, and
10,000 staff/date changes per request.

The other Staff Access tabs are:

| Tab | Use |
| --- | --- |
| Staff | Review scope, mode, hours, today's date block and current access status. Open Settings, block/restore an account, or inspect its Activity. Accounts & invitations retains the existing invitation workflow. |
| Default Hours | Set enabled days and same-day opening/closing times. Defaults are Monday–Sunday, 10:00 AM–7:00 PM, Asia/Manila. |
| Temporary Overrides | Select staff once and apply Temporary Allow Anytime or Temporary Block, using Manila start/end times. Overrides expire automatically and can be ended early. |
| Activity | Owner-only access history, admin changes, denied requests and simple recent security patterns. |

Per-person Settings supports default/custom weekly hours, display name, ingredient
brand visibility, Scheduled / Always Allowed / Blocked mode, and all production,
selected category or selected recipe scope. Categories include subcategories.
The existing global **Can view R&D** permission remains separate. Staff with it
enabled can switch between **Final** and **R&D** in one tap. The same hours, blocks,
overrides and recipe scope govern both collections. R&D does not grant testing-log,
editing, pricing, supplier, or export access to Kitchen Staff.

## Authoritative rules

Every Kitchen read uses the database clock, interpreted in Asia/Manila:

1. Account Blocked → deny, including during a Temporary Allow.
2. Active Temporary Block → deny.
3. Active Temporary Allow → bypass date/hours restrictions.
4. Blocked calendar date → deny for that entire Manila date.
5. Always Allowed bypasses normal hours; otherwise use the person's weekly hours.
6. Recipe/category permission must still permit the requested recipe.

Start time is inclusive; end time is exclusive. For 10:00–19:00, 09:59 is denied,
10:00 and 18:59 are allowed, and 19:00 is denied. Restoring a date removes that date
block; it does not change account mode or grant 24-hour access. Globally blocked
accounts must be explicitly restored. Owner access is unrestricted. Existing Chef
permissions remain separate from Kitchen Staff scheduling.

Final browsing resolves the current published version. Draft, Hidden, Archived,
unauthorized and arbitrary historic versions are unavailable. A pinned component
is readable only through an authorized current parent and its exact dependency
chain. Revoking a root also revokes its component context. Staff scaling and
checkoffs do not write to the master formula.

## Browser and API protection

- Kitchen data is projected on the server through an explicit field whitelist.
  Cost snapshots, prices, suppliers, margins, profitability, private notes, test
  logs, drafts and unrelated records are absent from responses. Searches, counts
  and categories are filtered before returning results.
- The public RPC has a Kitchen action allowlist. Export/PDF/CSV/print/download
  requests return HTTP 403 and a safe error. Denials return a response instead of
  raising a transaction exception so the audit event can commit. This follows
  [PostgREST's response-status and transaction behavior](https://docs.postgrest.org/en/stable/references/transactions.html).
- Private tables have RLS enabled and no direct browser/service-role table grants.
  Policy helpers and delegated legacy RPC functions have public execution revoked.
  Current database roles are checked; editable JWT metadata cannot grant access.
- Kitchen responses use `Cache-Control: no-store, private, max-age=0`. Recipe
  formulas are not stored in localStorage, sessionStorage, IndexedDB or an offline
  service worker. Session checkoffs contain only row IDs and booleans.
- Visible pages revalidate every 10 seconds, using a server-issued lease of at
  most 15 seconds. Leases shorten at known time/date/override boundaries. Client
  durations use `performance.now()`, so changing the device clock does not extend
  a grant. New reads and scaling still require server authorization.
- Expiry, failed revalidation, offline state and background/page-hide events clear
  recipe DOM, cached records, dialogs, retained library nodes and image blob URLs.
  Returning to a page reauthorizes. Permission changes invalidate stale requests;
  all open tabs independently revalidate. A revoked recipe returns to the remaining
  authorized library after reauthorization. Removing R&D returns to Final access.
- Staff images use `recipe-kitchen-media`: verified user identity, user-scoped RPC
  authorization before and after retrieval, image-only responses, no-store headers,
  and no signed URL returned. Direct Kitchen Storage reads/signing are denied.
- Staff has no Print/PDF, CSV, download or copy controls. Print CSS produces an
  explanatory message without recipe content; casual selection, copying, context
  menu and image dragging are deterred. Inputs, scrolling, scaling and checkoffs
  remain usable. Authorized Owner/Admin and existing Chef exports remain available
  and reauthorize before preparing output.

Known limits: screenshots, photographs and determined capture of content a person
was legitimately allowed to read cannot be prevented. Browser controls are
deterrents. Already-issued image URLs from before this release may remain valid
for their prior 15-minute expiry. Already-captured information cannot be withdrawn.
The compliant client locks within its lease; the database denies new requests as
soon as the changed rule commits. Physical device/Safari testing and real
multi-user production load testing are not represented by the local browser run.

## Activity, sessions and recovery

Activity records recipe opens/scaling, denial reason, export attempts, owner,
affected staff/dates and permission changes. Denied heartbeats are aggregated by
user/reason/action within a minute. Automatic bootstrap/access checks do not
generate suspicious-access flags. Five deliberate denied requests, any export
attempt, or twenty recipe opens in five minutes appear as simple review patterns.
No scrolling or general employee browsing telemetry is collected.

Existing Auth session persistence remains. Sign-out and account changes clear
protected state; a still-valid login never bypasses the recipe access policy.
On shared kitchen devices, staff can open Account to sign out. An inactivity lock
is an optional proposal below, not an enabled restriction.

Recovery exports include defaults, individual controls, date blocks, temporary
overrides, bulk action history, activity and their actor references. The archive
retains schema 2 with a `staff_access` feature marker so the existing download
checker remains compatible during rollout. The current reader requires all six
tables when the feature or any Staff Access table is present. The restore rehearsal compares full typed values,
relationships and file checksums and advances restored identity sequences.
Archives predating this feature restore with Monday–Sunday 10:00–19:00 defaults
and R&D off when that permission is missing. Formula values are not rewritten.
Use the matching current recovery script in a new isolated database.

## Verification and UI review

The direct database suite covers all required hours, calendar A–H, overrides,
recipe scope, versions/components, account/role changes, private RPC/table grants,
export denial, audit persistence, date boundaries, rollback, retry and Undo cases.
It executes the complete Vanilla/Matcha/Chocolate scenario from the request.
Separate browser checks cover owner bulk scheduling, actual client HTTP payloads,
all three lock screens, scaling/checkoffs, expiry while open, Back/Forward,
page restoration, offline mode, multiple tabs, live calendar/account blocking,
connection failure, role/R&D/scope revocation and Owner exports. Browser identities
and RPC transport terminate in an isolated database; they are not real production
staff accounts. Media tests separately exercise real handler authentication and
user-token forwarding with mocked providers.

Dedicated visual review inspected Staff overview/selector, the complete calendar,
date ranges, Mixed state, confirmation and Undo, temporary access, activity,
Kitchen library/reader/scaling and after-hours/date-block/account-block screens.
Reviewed screenshots use desktop, 1024px tablet and 390px phone layouts. Existing
Kitchen workflow regressions also cover 820px and 320px. Selection and Mixed states
have text labels as well as color; dates are native buttons with accessible labels
and pressed state; ranges have labeled inputs. Tablet date targets are at least
90px high. Phone layouts stay within the viewport; dense data tables scroll within
their containers. No optional redesign was applied.

Performance evidence is from isolated PGlite and Chromium: a 500-recipe library
returned Kitchen lists with 28.71 ms p95 and recipe detail with 4.75 ms p95. A single
200-pair calendar transaction took 11 ms in that run. These are local measurements,
not production network or concurrency guarantees.

## Optional proposals — not implemented

### SA-UX-01: compact Staff Access page header

| Field | Proposal |
| --- | --- |
| Current State / BEFORE | The existing Recipes & costing introduction and global navigation remain above the Staff Access title, counts and tabs. |
| Problem | On short tablet screens, the calendar begins below much of the first viewport. |
| Proposed State / PROPOSED | A compact contextual header while Staff Access is open, retaining global navigation and the visible selection summary. |
| Benefit | More dates visible with less initial scrolling. |
| Difficulty | Low to moderate. |
| Risk | Changes navigation hierarchy; verify orientation and consistent Back behavior. |
| Desktop / Tablet / Mobile | More calendar space on desktop/tablet; shorter scrolling on phones. |
| Approval Status | WAITING FOR APPROVAL |

### SA-SEC-02: optional shared-device inactivity lock

| Field | Proposal |
| --- | --- |
| Current State / BEFORE | Schedule/permission leases apply continuously; there is no additional inactivity timeout. |
| Problem | A signed-in shared device can remain usable by another person during permitted hours. |
| Proposed State / PROPOSED | An owner-configurable idle timeout with a warning and reauthentication; choose the timeout before implementation. |
| Benefit | Reduces unattended-session opportunity during an otherwise authorized shift. |
| Difficulty | Moderate. |
| Risk | Hands-free recipe reading may look idle; an aggressive timeout would interrupt production. |
| Desktop / Tablet / Mobile | Consistent warning/unlock behavior; especially relevant to shared tablets. |
| Approval Status | WAITING FOR APPROVAL |
