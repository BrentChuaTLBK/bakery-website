# Approved recipe improvements — 1 October 2026

All seven approved UX batches are implemented, including always-visible brands.
The follow-up requests add **R&D** status and one owner-controlled **Can view R&D**
permission per account. This permission applies across the recipe system.

The two database migrations are deployed and verified. Frontend changes are on
`codex/recipe-approved-ux` for upstream review and merge. They are not yet on the
live website. This branch includes upstream main through PR #126 (`7d8a0dd`).

## Implemented behavior

| Batch | Before | Implemented and checked |
| --- | --- | --- |
| A · Production | Open quantity controls, select a field and type a common multiplier; use a section dropdown | Always-visible ×1 / ×2 / ×3 / Custom. Wide tablets have named section buttons. Exact quantities, critical notes, checkoffs and saved Final remain intact. |
| B · Ingredient editing | Tall repeated ingredient fields; supplier context requires more navigation | Compact rows keep name, brand, quantity and unit visible. Current supplier has a separate line. Details expands notes and rounding. Keyboard entry and reorder retain row identities. Philadelphia and Anchor fixtures remain distinct. |
| C · R&D | Five actions to reach an editable test formula through a saved log | New test opens formula and observations in one action. Desktop uses adjacent panels; phones switch between formula and observations with one Save test. Historical source version and promoted-test locking are preserved. |
| D · Costing Overview | Product cards require more vertical scanning | Desktop table and phone cards compare saved figures. Batch / Unit changes every money column consistently. Details expands supporting figures. Sorting still labels its batch basis explicitly. |
| E · Record price | Open a full catalog editor and find supplier quotes | Record price locks the selected ingredient/packaging ID and brand, prefills supplier and pack units, and appends price history. Other brands and saved recipe snapshots are unaffected. |
| F · Phone costing | Several groups of cost figures and a less explicit source selector | Saved snapshot / Current prices controls, Batch / Per item basis, five main figures and an expandable breakdown. The sheet fills the phone viewport and keeps a 48 px Close control available; Escape works. |
| G · Back to results | Rebuild the library after opening a recipe | Retain result elements, filters, focus and scroll after an account/permission check. Writes, Refresh results, authentication changes and sign-out invalidate them. Opening a saved recipe still makes a fresh request. |

An older linked ingredient with no saved brand displays its catalog brand with a
source tooltip. This fallback does not rewrite the saved formula. New ingredient
selections retain their exact brand as before.

R&D test changes are saved explicitly, together with observations. They do not
use ordinary recipe draft autosave. Unsaved test changes require a leave
confirmation. Updating an existing test keeps its original source version; the
owner must separately promote a test into a new recipe version. Duplicate
promotion is rejected and promoted logs remain read-only.

## R&D status and global permission

The status list is **Draft, R&D, Final, Hidden, Archive**. The existing immutable
`testing` code displays as R&D, without rewriting historical version rows.
Legacy Approved still displays as Draft; Production displays as Final. Draft and
R&D saves retain the last Final production pointer. Existing explicit withdrawal
behavior for Draft, Hidden and Archive remains unchanged.

In **Access → Accounts & permissions**, the owner toggles **Can view R&D** for
each active recipe account. Non-owner accounts default to off. Owners always
retain R&D access. A newly invited account can be enabled after it activates its
recipe access. Removing and re-adding recipe access resets R&D to off.

| Account | Permission off | Permission on |
| --- | --- | --- |
| Owner | Not applicable | All recipes, test logs and existing owner actions |
| Chef | Normal recipe/costing access; no R&D formulas or logs | R&D formulas and logs available with existing Chef editing rights; publishing remains owner-only |
| Kitchen | Published Final recipes | Separate R&D recipes view for reading current research formulas; costs, private notes, editing and test logs remain excluded |

Server enforcement covers list rows and totals, search, version history, direct
version requests, duplicate/restore/save, working copies, test logs, audit details,
costing and linked formula previews, exports, and R&D-only/test-only attachments.
A restricted working recipe can still expose its previously published Final.
Costing Overview uses that visible version's name and category rather than the
restricted working title. Parents that pin restricted dependencies are hidden too.

Revocation blocks subsequent API and Storage authorization requests. Returning to
results and window-focus checks discard stale private views when permission or
account changes. Print preparation rechecks the exact version before constructing
a printable document. Previously downloaded/printed content cannot be withdrawn;
an already-issued attachment URL keeps its existing expiry of up to 15 minutes.

## Verification

The complete regression run passed **26 of 26 suites**:

- 283 unit checks.
- 83 recipe database checks, including eight R&D permission groups, across all 89 migrations.
- Eight existing account-access checks, six catalog checks and seven backup/restore checks.
- Recipe browser coverage: 24 core, 12 components, six ingredient picker, ten packaging,
  13 workflow, nine startup, six import/export, eight profitability, three security,
  seven approved-UX groups and five global R&D access groups.
- Academy database, restore, security/audit, student, authentication and admin suites,
  including the latest upstream Academy/email changes, plus targeted edge tests.
- Static website build: 24 pages.

After the visibility query was optimized, all 83 recipe database checks and the
profitability/R&D browser suites passed again. No production test accounts,
recipes, purchases, invitations or emails were created by this verification.

Notable checks include exact scaled ingredient totals, unchanged Final snapshots,
brand-specific price recording, per-batch/per-unit cost consistency, stale recipe
and test revisions, repeated Save and promotion attempts, original R&D source
versions, read-only Kitchen projections, file access after revocation, denied
print preparation, sign-out cleanup and repeated library open/return actions.
The latter found and fixed a retained Open button that had remained disabled.

Both current backups and pre-permission archives restore into a new isolated
database. New permissions and R&D draft flags round-trip. Older backups receive
least-privilege defaults; missing new columns do not become invalid null values.
Formulas, prices, timestamps and file relationships still pass complete comparisons.

### Performance

Isolated PGlite PostgreSQL and headless Chrome on the Windows workstation; 500
recipes, 6,000 ingredient rows, 400 ingredients and 100 suppliers. API values use
ten measured samples after warm-up; browser values use five unless stated otherwise.
These are local measurements without production network latency or concurrent load.

| Check | Median | 95th percentile |
| --- | ---: | ---: |
| Recipe library API | 21.71 ms | 23.25 ms |
| Open recipe API | 2.73 ms | 2.93 ms |
| Kitchen recipe API | 4.67 ms | 5.57 ms |
| Current costing API | 7.84 ms | 8.02 ms |
| Costing Overview API | 303.91 ms | 316.05 ms |
| Tablet initial library navigation/render | 149.69 ms | 169.83 ms |
| Return to rebuilt library | 66.65 ms | 70.43 ms |
| Return to retained library | 42.19 ms | 67.55 ms |
| Chef library with an R&D working version hidden | 9.57 ms | 10.46 ms |
| Kitchen library with R&D hidden | 9.50 ms | 10.16 ms |
| Kitchen opening the last Final while current version is R&D | 5.04 ms | 5.23 ms |

Retained return avoided a list request and reduced the median by about 37% in this
small local sample. Both paths recheck permissions. The initial R&D implementation
added repeated authorization/tree lookups; bulk visibility now computes the
restricted version set once per list/overview request. The final library query is
close to the previous audit's 20.70 ms median, rather than accepting that regression.

### Visual evidence

Local review: `work/recipe-audit/review/implemented/index.html`.
It contains seven actual BEFORE/AFTER pairs, using the same synthetic fixture as
the approved proposals, plus owner permission, Kitchen R&D and specific-brand
screens. The original before images and prototypes are preserved separately.
Desktop 1440×1000, tablet 820×1100 and phone 390×844 captures were visually reviewed.
The gallery fits 1440 px and 390 px widths; all 17 images load and all eight views
switch without browser errors. Additional browser tests cover 320 px phones.

### Live database verification and release boundary

Seven pre-deployment function bodies matched the locally tested baseline exactly.
`recipe_rd_status` and `recipe_rd_visibility` were then applied successfully.
Read-only post-deployment checks confirm the five-status mapping, default-off
non-null permission, authenticated-only public API and zero new private helpers
callable by anon, authenticated or service-role clients.

Production still has one recipe, three immutable versions and three working
copies. The aggregate fingerprint of all version formulas and cost snapshots is
unchanged. No existing recipe content or saved costs were modified.

Supabase security advisor findings are unchanged before/after: 105 existing
RLS-without-policy notices, ten existing anon and twenty authenticated definer
function notices, and one existing leaked-password-protection warning. See
[RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security),
[database function guidance](https://supabase.com/docs/guides/database/functions),
and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Frontend publication requires the upstream merge. Authenticated live-browser
acceptance, physical tablets/phones, Safari, assistive technology and concurrent
production load remain unverified. The database and browser authorization tests
used isolated synthetic accounts with actual application SQL and browser code.

Machine-readable suite and performance evidence:
[RECIPE-APPROVED-UX-RESULTS-2026-10-01.json](RECIPE-APPROVED-UX-RESULTS-2026-10-01.json).
