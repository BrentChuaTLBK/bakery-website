# Recipe audit and profitability release — 1 October 2026

The required technical fixes and versioned profitability feature are ready on
`codex/recipe-production-audit`, based on upstream `a42ed7f` (including the TLB
Kitchen branding update). Optional UX proposals have not been implemented.

## Database deployment

Applied successfully to the existing project:

- `recipe_audit_integrity`: duplicate procedure/step identity validation and a
  readable R&D recipe/version mismatch error.
- `recipe_profitability`: private saved/current cost calculations, per-version
  saleable-unit configuration, allowance/profit/margin/markup and filtered overview.

Before deployment, six live recipe function hashes matched the tested baseline.
After deployment, all three existing historical snapshots remain readable; a
synthetic read-only live calculation produces base 100, adjusted 120, profit 80,
margin 40% and markup 66.666667%. API/helper grants and both validation guards pass.
The existing one recipe and three versions remain. No live recipe, invoice price,
test log or production run was created or edited by this audit.

The complete security-advisor result is unchanged from immediately before these
migrations: 105 RLS-without-policy, 10 anonymous security-definer, 20 authenticated
security-definer and one password-protection finding. These are existing project
findings; details and remediation links are in the technical report.

## Frontend and verification

The frontend requires the review branch to be merged into upstream `main` before
it appears on the live website. Its recipe module/CSS versions are updated together.
Do not describe a local mockup as the live release.

A fresh regression after integrating upstream branding passed all 20 suites:
283 unit checks; 74 recipe, 8 access, 6 catalog and 6 backup database checks across
86 migrations; 19 Academy database checks and a separate recovery test; 7 targeted
edge tests; 90 recipe browser checks; 17 Academy browser/auth checks; 24-page build.
Nineteen independent Python-derived costing cases are checked against SQL results.

The 500-recipe performance run measured median 20.70 ms for library API, 296.76 ms
for costing overview API and 17.46 ms for tablet-width scaling through cost render.
These are isolated local measurements, not live network or concurrent-user load.

## Review artifacts

- [Complete technical report](RECIPE-PRODUCTION-AUDIT-2026-10-01.md): 92 requirements,
  66-area checklist, defect reproduction/fixes, calculations, scenario inventory,
  backup evidence and explicit untested limits.
- [Optional UX proposals](RECIPE-UX-PROPOSALS-2026-10-01.md): seven batches A–G,
  all WAITING FOR APPROVAL.
- Local side-by-side gallery: `work/recipe-audit/review/index.html`. Its seven real
  screenshots and seven separate mockups use synthetic data; it is excluded from
  the public source release along with private logs and the actual Drive archive.

The actual latest Drive archive restored 1,026 rows and two files in isolation,
but predates the live recipe. A fresh backup containing that recipe and real-device/
authenticated-live-browser checks remain outstanding. The report states these
limits explicitly.
