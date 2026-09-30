# Recipe System production audit — 1 October 2026

The required fixes and profitability feature pass the documented local regression.
This report does **not** certify that every possible scenario or real device has been tested.
All destructive, failure, security-injection and restore tests used isolated synthetic data.
Live data checks were read-only; the two required database migrations were applied
after testing. Optional UX changes have not been implemented.

Release state: the integrity and profitability migrations are deployed and their
read-only live verification passes. The frontend is prepared on
`codex/recipe-production-audit` and awaits upstream merge/publication.
See [release details](RECIPE-AUDIT-RELEASE-2026-10-01.md).

## Scope and test environment

The audit used actual application JavaScript, headless Chrome and an isolated
PGlite PostgreSQL database with all 86 migrations. Browser authentication/transport
was replaced by a fixture adapter; SQL functions, role checks, rows, constraints,
version capture and cost calculations were real. This distinguishes these tests
from live Supabase network, JWT and multi-session load verification.
The existing live project was checked for record relationships, backups and
security-advisor baseline. No real recipe or supplier price was edited.

The authoritative workflow remains **Draft / Final / Hidden / Archive**.
The older Testing/Approved states in the checklist were tested for compatibility,
not reinstated. Historical Testing/Approved displays as Draft; Production as Final.
Saving a draft retains the prior kitchen Final; an explicit status change to
Draft, Hidden or Archive withdraws kitchen access. Only the owner marks Final.

## Fresh regression results

All 20 suites below exited successfully. Initial environment-only failures were
resolved by using absolute paths to the already installed PGlite/Excel libraries.
A new portion-scaling fixture was corrected to supply its required target weight.
The final result set contains the successful reruns, not those setup failures.

| Suite | Verified checks | Result |
|---|---:|---|
| unit | 283 | PASS |
| recipes-db | 74 | PASS |
| access-db | 8 | PASS |
| catalog-db | 6 | PASS |
| backup-db | 6 | PASS |
| academy-db | 19 | PASS |
| academy-recovery | 1 | PASS |
| edge | 7 | PASS |
| ui-recipes | 24 | PASS |
| ui-recipe-components | 12 | PASS |
| ui-recipe-ingredient-picker | 6 | PASS |
| ui-recipe-packaging | 10 | PASS |
| ui-recipe-workflow | 12 | PASS |
| ui-recipe-startup | 9 | PASS |
| ui-recipe-import-export | 6 | PASS |
| ui-recipe-profitability | 8 | PASS |
| ui-recipe-security | 3 | PASS |
| ui-academy-portal | 12 | PASS |
| ui-academy-auth | 5 | PASS |
| build | 24 pages | PASS |

The recipe browser suites total 90 checks. Academy adds 17 browser checks.
The new independent costing matrix has 19 cases (A–S) within the recipe database
suite; each checks all applicable totals, saleable yield and per-unit values.

Reproduction commands: `npm run test:unit`, `npm run test:recipes`,
`node tests/backend/run.mjs --recipe-access`, `npm run test:academy`,
`npm run test:recipe-performance`, and `npm run build`.
`PGLITE_PACKAGE_ROOT`, `PLAYWRIGHT_PACKAGE_ROOT` and `EXCELJS_TEST_PATH` can point
to existing dependencies outside this checkout. Test files and fixtures are included
in the release; private logs, screenshots and downloaded backups are excluded.

## Findings and required fixes

No historical formula corruption, version loss or unauthorized SQL access was
reproduced in the tested cases. This is a scoped result, not a claim that no other
security defect can exist. The confirmed findings are below.

### HIGH — RECIPE-TECH-01: saved identifier could execute a browser event handler

1. **Issue:** stored ingredient/photo/component identifiers were interpolated into HTML attributes without escaping.
2. **Severity:** HIGH; an authorized malicious editor could target another recipe viewer, including an owner.
3. **Reproduction:** save an ingredient ID containing a quote and an `onfocus` handler, open the recipe, and focus its checkoff. Repeat with photo/file and component-size identifiers.
4. **Expected:** every identifier renders only as data.
5. **Actual before fix:** the injected focus handler ran in the local browser probe.
6. **Root cause:** incomplete escaping in string-generated attribute markup.
7. **Fix:** escape the affected row, photo, file and size attributes.
8. **Changed:** `assets/ordering/recipes.js`; security browser fixtures in `tests/ui/recipe-security.mjs`.
9. **Verification:** the same saved payloads cannot create event attributes or execute handlers; ordinary ingredient/method text also remains text.
10. **Regression:** all 90 recipe browser checks pass, including the three security/legacy-checkoff cases. No exploit was attempted against live users.

### HIGH — RECIPE-TECH-02: pieces scaling required redundant portion data

1. **Issue:** a recipe yielding six pieces could not scale to eighteen unless a separate portions value existed.
2. **Severity:** HIGH; blocks a common production quantity operation.
3. **Reproduction:** yield `6 pcs`, leave portions blank, choose Pieces and enter `18`.
4. **Expected:** multiplier 3 and all ingredient/cost quantities scaled by 3.
5. **Actual before fix:** “Add a base portions before using this scaling method.”
6. **Root cause:** pieces always read the portions field instead of a count-unit base yield.
7. **Fix:** derive pieces from count yield, retain custom-unit fallback, and provide a separate portions mode.
8. **Changed:** `recipe-math.js`, `recipe-model.js`, `recipes.js`, unit and profitability browser tests.
9. **Verification:** six pieces → eighteen gives 3 kg from 1 kg, base cost ₱375 from ₱125, and leaves the saved six-piece master unchanged.
10. **Regression:** all nine requested multipliers, portion-weight semantics, linked components, saved scaled copies and browser workflows pass.

### HIGH — RECIPE-TECH-03: invalid rounding could leave stale production quantities visible

1. **Issue:** a zero/invalid practical rounding increment threw during rendering.
2. **Severity:** HIGH; stale quantities could be mistaken for the newly requested production run.
3. **Reproduction:** open Production, select practical rounding, enter `0`, `-1` or nonnumeric text.
4. **Expected:** actionable validation with unavailable quantities and disabled exports.
5. **Actual before fix:** rendering failed while previously rendered quantities remained.
6. **Root cause:** validation happened during table construction, after the reader had started rendering.
7. **Fix:** validate rounding first, remove numeric production panels on error, disable print/CSV and retain the expanded adjustment controls.
8. **Changed:** `recipes.js`; `tests/recipe-audit.test.mjs`, `tests/ui/recipe-profitability.mjs`.
9. **Verification:** tablet and phone error states contain no visible numeric component panel and Print is disabled; correcting the input recovers.
10. **Regression:** original production workflow, practical rounding, PDF and CSV tests pass.

### MEDIUM — RECIPE-TECH-04: duplicate method identities could share checkoff state

1. **Issue:** duplicated procedure/step IDs were accepted, and legacy missing IDs could share an undefined checkoff key.
2. **Severity:** MEDIUM.
3. **Reproduction:** save repeated method or step IDs, or load legacy steps without IDs; check one step and refresh.
4. **Expected:** independent ingredient/step checkoffs.
5. **Actual before fix:** duplicate identities were saved; missing step IDs did not have distinct stable fallback keys.
6. **Root cause:** server validation covered ingredients but not all procedure identities; reader fallback was incomplete.
7. **Fix:** validate IDs on new writes and use method/step position fallbacks for legacy steps and reset.
8. **Changed:** `recipe-model.js`, `recipes.js`, `20260930215155_recipe_audit_integrity.sql` (`tlb.recipe_validate`).
9. **Verification:** duplicate saves fail; two ID-less steps remain independent after refresh/reset. Live existing versions contain no duplicate methods/steps.
10. **Regression:** component reorder, legacy import, checkoff and version tests pass; no historical JSON was rewritten.

### MEDIUM — RECIPE-TECH-05: editor quantity validation disagreed with the database

1. **Issue:** negative optional yields, loss over 100% and excessive quantities passed client validation.
2. **Severity:** MEDIUM; database already rejected these saves.
3. **Reproduction:** enter a negative batch/portion/pan value, loss `101`, or quantity `1000000000001`.
4. **Expected:** consistent, immediate validation before save.
5. **Actual before fix:** client returned no validation error; save failed at the backend.
6. **Root cause:** optional fields and the server quantity bound were absent from client checks.
7. **Fix:** align validation with nonnegative values, positive base yield, loss limits and the 1-trillion input limit.
8. **Changed:** `recipe-math.js`, `recipe-model.js`; audit unit/database tests.
9. **Verification:** invalid values fail both layers; the exact maximum is accepted by the input parser.
10. **Regression:** mixed fractions, tiny amounts, normal yields and required profitability validation pass.

### MEDIUM — RECIPE-TECH-06: contradictory yield information was not flagged

1. **Issue:** raw ingredient mass, recorded batch weight, finished weight and loss could contradict each other without a warning.
2. **Severity:** MEDIUM.
3. **Reproduction:** 1,000 g ingredients with 1,200 g finished yield, or 900 g finished and an inconsistent loss percentage.
4. **Expected:** show the measured raw mass and flag inconsistencies without guessing density or preventing intentional process adjustments.
5. **Actual before fix:** inconsistent values saved without review guidance.
6. **Root cause:** no cross-field yield review.
7. **Fix:** calculate known mass from g/kg/mg ingredients, exclude packaging/equipment, label incomplete volume/component contributions and warn about conflicts.
8. **Changed:** `recipe-model.js` (`yieldReview`) and editor rendering in `recipes.js`.
9. **Verification:** 94 g + 0.906 kg = 1,000 g; 900 g finished with 10% loss is consistent; 1,200 g finished warns; 100 ml adds uncertainty, not guessed mass.
10. **Regression:** original yields are retained; scaling and costing tests pass.

### LOW — RECIPE-TECH-07: wrong-recipe R&D version exposed a raw constraint error

1. **Issue:** a mismatched recipe/version reference produced a technical foreign-key error.
2. **Severity:** LOW; the existing foreign key already prevented corruption.
3. **Reproduction:** submit a test log for Recipe A with a version from Recipe B.
4. **Expected:** “Choose a saved version of this recipe for the testing log.”
5. **Actual before fix:** database constraint name appeared in the error.
6. **Root cause:** relationship validation was deferred to the foreign key.
7. **Fix:** validate the relationship before attempting the insert.
8. **Changed:** integrity migration, private recipe API implementation, audit database tests.
9. **Verification:** readable error and zero saved logs for the invalid request.
10. **Regression:** create/edit/promote R&D, duplicate promotion rejection and historical version preservation pass.

### Required feature — versioned profitability and product overview

The required feature is implemented, not an optional proposal. Each size now has
Costing Only or Saleable Product Costing, an allowance percentage, explicit saleable
yield/unit and a manual selling price per unit or base batch. Base cost separates
ingredients, packaging and other direct costs. Batch and unit summaries show
adjusted cost, selling revenue/price, estimated profit, margin, markup and break-even.

The new `20260930215639_recipe_profitability.sql` migration supplies the authoritative
`costing`, `cost_preview` and `costing_overview` actions. Private helper functions
are not directly callable by authenticated users. Owner/chef access is required;
kitchen and Academy payloads exclude the new configuration and results.
`assets/ordering/recipe-costing.js`, the recipe editor/reader and CSS provide the UI.

Important rules verified:

- Margin divides by revenue; markup divides by adjusted cost. Zero denominators produce an unavailable value, never an invented percentage.
- Missing prices or conversions retain known costs but suppress complete base/adjusted/profit totals.
- Negative profit is visible. Zero price remains a valid explicit value with a reminder.
- Fixed direct charges do not multiply; variable packaging/ingredients do.
- Portion-weight scaling keeps the saleable count; piece/batch scaling changes it.
- Saved costs use saved pinned-component prices. Current costs reprice those same pinned formulas recursively; neither mode silently adopts a newer component formula.
- New versions capture new direct prices. Historical snapshots, status changes and version restore retain their saved prices and costing configuration.
- Legacy unnamed manual charges remain other direct cost; their category is not guessed. New manual packaging charges can be categorized explicitly.
- Costing Overview filters before pagination, identifies version and size, defaults to saleable active recipes, and omits detailed line arrays from its payload.

The comparison reader also normalizes sparse legacy documents before comparing
defaults, and the release updates the recipe asset import versions so cached module
dependencies do not retain older math/model code.

## Independent calculation verification

`scripts/recipe-cost-oracle.py` uses Python `Fraction` and 48-digit `Decimal`
without importing application code. PostgreSQL actuals are checked against those
expected values with absolute tolerance below 1e-9 for these fixtures. Presentation
below uses six decimal places; full values are retained in the local calculation
evidence and expected fixtures in `tests/fixtures/recipe-cost-oracle.json`.
PostgreSQL division can leave tiny residuals: case A returns
212.00000000000000000250 versus the exact rational 212. This does not change the
currency display or satisfy an inaccurate early-rounded cost.

Independent examples:

- Cream cheese: 750 / (1.5 × 1,000) × 424 = **₱212**.
- Mixed ingredients: 212 + 56.4 + 10 + 0.109375 = **₱278.509375**.
- Packaging: 2,000 / 100 × 1 box = **₱20**; three holders add ₱4.50.
- Mixed recipe + packaging + ₱5 direct charge = **₱308.009375**.
- Linked component ₱5 + cream cheese ₱212 + box ₱20 = **₱237**.
- 94 g × 1.15 = **108.1 g**; 6 pieces → 18 = **3×**.
- Raw 1,000 g → finished 900 g gives **10%** measured loss.

| Case | Scenario | Base expected / actual | Profit expected / actual | Margin expected / actual | Result |
|---|---|---:|---:|---:|---|
| A | Single ingredient | 212 / 212 | 868 / 868 | 80.37037 / 80.37037 | PASS |
| B | Mixed purchase sizes | 278.509375 / 278.509375 | 801.490625 / 801.490625 | 74.212095 / 74.212095 | PASS |
| C | Ingredients, multiple packaging items and direct cost | 308.009375 / 308.009375 | 771.990625 / 771.990625 | 71.480613 / 71.480613 | PASS |
| D | Pinned component portion | 237 / 237 | 843 / 843 | 78.055556 / 78.055556 | PASS |
| E | Half batch | 154.004688 / 154.004688 | 385.995312 / 385.995312 | 71.480613 / 71.480613 | PASS |
| F | 1.15 batch | 354.210781 / 354.210781 | 887.789219 / 887.789219 | 71.480613 / 71.480613 | PASS |
| G | Ten batches | 3,080.09375 / 3,080.09375 | 7,719.90625 / 7,719.90625 | 71.480613 / 71.480613 | PASS |
| H | Missing ingredient price | Unavailable / Unavailable | Unavailable / Unavailable | Unavailable / Unavailable | PASS |
| I | New supplier price | 223.306667 / 223.306667 | 856.693333 / 856.693333 | 79.323457 / 79.323457 | PASS |
| J | Labor allowance zero | 100 / 100 | 100 / 100 | 50 / 50 | PASS |
| K | Labor allowance ten percent | 100 / 100 | 90 / 90 | 45 / 45 | PASS |
| L | Labor allowance twenty-five percent | 100 / 100 | 75 / 75 | 37.5 / 37.5 | PASS |
| M | Selling below adjusted cost | 100 / 100 | -20 / -20 | -20 / -20 | PASS |
| N | Break even | 100 / 100 | 0 / 0 | 0 / 0 | PASS |
| O | Selling above adjusted cost | 100 / 100 | 80 / 80 | 40 / 40 | PASS |
| P | Six saleable units | 600 / 600 | 480 / 480 | 44.444444 / 44.444444 | PASS |
| Q | Explicit batch selling price | 600 / 600 | 480 / 480 | 44.444444 / 44.444444 | PASS |
| R | Zero selling price | 212 / 212 | -212 / -212 | Unavailable / Unavailable | PASS |
| S | Confirmed zero cost | 0 / 0 | 200 / 200 | 100 / 100 | PASS |

For case O, one saleable item, base ₱100, allowance 20%, selling price ₱200:

| Test | Expected | Actual | Result |
|---|---:|---:|---|
| Base cost | 100 | 100 | PASS |
| Labor allowance | 20 | 20 | PASS |
| Adjusted cost | 120 | 120 | PASS |
| Profit | 80 | 80 | PASS |
| Margin % | 40 | 40 | PASS |
| Markup % | 66.666667 | 66.666667 | PASS |

The browser independently checked a separate complete workflow: ingredients ₱100,
packaging ₱20, direct charge ₱5, 20% allowance = ₱25, adjusted cost ₱150,
six items × ₱40 = ₱240 revenue, ₱90 profit, 37.5% margin, 60% markup.
At 18 pieces, base cost is ₱375 and saved profit ₱270. Doubling the current flour
price gives current profit −₱90 while saved profit remains ₱270.

## Performance measurements

Dataset: 500 recipes, 6,000 ingredient rows, 400 master ingredients and 100 suppliers.
Measurements exclude seed time and one warm-up. API timings have ten samples;
navigation timings have five. This is local PGlite/Chrome performance, not live
Supabase, WAN, cold-start or concurrent-user load. The observed payloads are JSON
response bytes, not compressed transfer size.

| Operation | p50 ms | p95 ms | Response bytes |
|---|---:|---:|---:|
| Recipe library API | 20.7 | 21.82 | 8781 |
| Recipe opening API | 1.85 | 2.11 | 6243 |
| Ingredient search API | 11.35 | 12.38 | 4066 |
| Supplier search API | 9.38 | 9.47 | 3660 |
| Current costing API | 7.33 | 8.7 | 6237 |
| Production recipe API | 3.02 | 5.3 | 2087 |
| Version history API | 1.53 | 1.6 | 218 |
| Costing overview API | 296.76 | 301.83 | 31981 |
| Tablet library navigation and render | 153.21 | 167.3 | not measured |
| Tablet scaling through rendered cost update | 17.46 | 19.94 | not measured |
| Tablet costing overview and return to library | 439.36 | 471.92 | not measured |

No unacceptable slowdown was reproduced at this dataset size. The overview returns
24 summaries in about 32 KB and no ingredient-line arrays. Code review found
per-component lookups in recursive costing; larger/deeper graphs remain a scale
risk. Existing full-text and relationship indexes are retained. Images are fetched
after the recipe markup rather than blocking initial formula rendering. No optional
cache/index redesign was introduced without workload evidence.

## Live integrity, access and backup evidence

Read-only live checks found one recipe with three versions, zero broken current
version pointers, zero duplicate method/step IDs and zero repeated active ingredient
name/brand groups. Initial catalog counts were 187 ingredients, 77 suppliers,
68 packaging records and 340 prices. No production test records were created.

Direct isolated API/RLS tests reject anonymous, unverified, ordinary customer,
unassigned staff and Academy users. Chef/kitchen privileges are distinct. New
profitability helpers deny direct execution. Imported Student Recipes retain only
allowed teaching fields, omit cost/supplier/profit data recursively and remain
independent after the source production recipe changes. Tests also cover private
file access, malformed upload metadata, revoked access and account invitation rules.

The immediate pre-deployment security-advisor baseline contains existing findings:
105 RLS-without-policy items, 10 anonymous/security-definer items, 20 authenticated/
security-definer items and one leaked-password-protection setting. These span the
larger project. Their existence is recorded; this recipe audit does not claim they
were remediated. Recipe tables deliberately deny direct grants and use checked APIs.
After both recipe migrations, the complete advisor result is unchanged (excluding
observation timestamps). All six recipe functions matched the tested pre-migration
baseline before deployment. Afterward, all three existing historical cost snapshots
remain readable, the independent ₱100/20%/₱200 example produces ₱80 profit and 40%
margin, the new helpers remain private, and anonymous API execution remains denied.
The live system still contains one recipe and three saved versions.

Advisor references: [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[anonymous security-definer access](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[authenticated security-definer access](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Live backup configuration was enabled with 44 retention slots, five valid archives,
five completed jobs and no failed job at inspection. Daily and monthly files were
separate Drive objects with private user permissions. The latest verified daily
archive was created at **2026-09-30 18:00:17 UTC**; the monthly copy at **16:00:08 UTC**.
Downloaded daily archive: 4,124,401 bytes; SHA-256
`cba5fbcff4ce81166633fab51ab8ec92491e03d3f5cdefefddf3801792e10584`, matching backup metadata.

Actual isolated restoration verified **1,026 metadata rows and two files**, including
332 resources, 333 supplier links, 340 prices, 14 categories, settings and one draft.
Checksums, typed values and relationships matched. **This archive predates creation
of the live recipe and contains zero recipes/versions/R&D/production records.**
It is not evidence that the new live recipe has already been backed up.

Separate synthetic archive/recovery tests cover recipes, immutable versions, linked
components, ingredient links, R&D, production logs, per-version profitability,
cost snapshots, photos, settings and user state. They verify checksum rejection,
timezones, relationships, failed-upload retention, retries, daily/monthly history,
and preservation of prior good copies. Passwords, API secrets and service credentials
are not selected into the recipe archive. No live restore or owner impersonation
was performed.

## Complete system checklist

Statuses below apply to the concrete scenarios stated. “PASS AFTER FIX” includes
the new required costing capability. Physical-device, full-load and fresh-live-backup
limits are separately marked NOT TESTABLE below.

| Area | Result | Tested scope / evidence |
|---|---|---|
| Recipe Library | PASS | Create/open, active/default archive exclusion, alphabetical pagination, favorite/pin/recent. |
| Search | PASS | Name, Unicode, ingredients, tag and private kitchen-search exclusion; 400-ingredient benchmark. |
| Filters | PASS | Combined category/tag/product-line/status/favorite/pinned/recent/author/version; empty matches. |
| Categories | PASS | Parent/child create, cycle rejection, edit, delete and parent-first restoration. |
| Recipe creation | PASS | Valid, blank/invalid, duplicate names with distinct IDs; duplicate code rejection. |
| Recipe editing | PASS | Continued edits after Save, failure retry, stale revision rejection, dirty draft recovery. |
| Recipe duplication | PASS | Independent copy, variation and scaled copy create new identities. |
| Recipe archiving | PASS | Four-status aliases, kitchen withdrawal, default exclusion, delete/undelete history. |
| Ingredients | PASS | Add, select, change, unlink, remove, reorder, brand, supplier, notes and exact quantities. |
| Ingredient groups | PASS | Multiple groups, own methods, final assembly, rename/move/remove, no state loss. |
| Ingredient Database | PASS | Purchase creation/reuse, master references, allergens, soft deletion and recovery. |
| Units | PASS | Mass/volume/count aliases; pack/bottle/tray/box retained as explicit custom units. |
| Unit conversions | PASS | kg↔g, L↔ml, count; incompatible dimensions and unknown pack contents rejected. |
| Decimal precision | PASS | 0.1/0.25 g, fractions, ×1.15, independent high-precision ingredient costs. |
| Scaling | PASS AFTER FIX | All nine requested factors; linked/component/cost propagation and unchanged master. |
| Scaling by yield | PASS AFTER FIX | 6→18 pieces, separate portions, raw weight and pan counts; portion weight semantics. |
| Production scaling | PASS AFTER FIX | Immediate quantity and saved-cost render; invalid values suppress stale output. |
| Yield | PASS AFTER FIX | Positive base yield; optional nonnegative fields; conflict warnings and saleable yield separate. |
| Batch weight | PASS AFTER FIX | 94 g + 0.906 kg = 1,000 g; unknown volume excluded from known mass. |
| Production loss | PASS AFTER FIX | 1,000→900 g / 10%; finished-over-raw and inconsistent loss warnings. |
| Components | PASS | Pinned named sizes, compatible yield quantity, cycles, expansion and whole-batch leftovers. |
| Component versions | PASS | New child formula does not mutate parent; explicit update and saved/current cost distinction. |
| Method | PASS AFTER FIX | Step order, linked procedures, assembly, timers, equipment, photos and independent checkoffs. |
| Baking settings | PASS | Two stages and distinct top/bottom/time settings retained in save, reader and print. |
| R&D logs | PASS AFTER FIX | Date, rating, changes, bake notes, observations, result, next test, photos and tested formula. |
| Test promotion | PASS | Explicit owner action, new version, duplicate promotion rejected; previous versions retained. |
| Version history | PASS | Immutable v1/v2/v3, pagination, authors/reasons and kitchen access denial. |
| Version comparison | PASS | Structured document differences; normalized legacy defaults avoid false-only differences. |
| Version restore | PASS | New version from old formula; no newer history deleted; cost/profile snapshot retained. |
| Production Mode | PASS AFTER FIX | Quantity-only reader, sections, ingredient/method navigation, admin return by role. |
| Production tablet use | PASS | Chrome at portrait 820 and landscape 1024/1440; checkoffs/scaling; physical tablet unverified. |
| Suppliers | PASS | Multiple suppliers, quotes, preferred supplier, contact/notes, active/inactive and deletion. |
| Supplier prices | PASS | Correct comparable unit cost, preferred override, price change and no-history rewrite. |
| Price history | PASS | Append-only quote records and immutable historical recipe costs. |
| Packaging | PASS | Reusable items, dimensions, notes, private photos and per-recipe overrides. |
| Packaging suppliers | PASS | Multiple quotes, supplier-only links, preferred pricing and price history. |
| Packaging costing | PASS | ₱2,000/100 boxes=₱20 each; multiple items/holders and quantity scaling. |
| Base Cost | PASS AFTER FIX | Independent A–S oracle plus browser purchase→recipe workflow. |
| Cost per batch | PASS AFTER FIX | Ingredients + packaging + direct; full total withheld if incomplete. |
| Cost per unit | PASS AFTER FIX | Explicit saleable yield, per item/box/cake/tray/set; no raw-weight inference. |
| Labor & Utilities % | PASS AFTER FIX | 0/10/20/25%; displayed percent and amount; invalid negative/oversized values denied. |
| Adjusted Cost | PASS AFTER FIX | Base + allowance; fixed/variable direct-charge behavior. |
| Selling Price | PASS AFTER FIX | Manual unit/batch basis, zero allowed, invalid negative/missing rejected. |
| Estimated Profit | PASS AFTER FIX | Positive, zero and negative results; never auto-updates selling price. |
| Profit Margin | PASS AFTER FIX | Profit/revenue; case O 40%; zero revenue undefined. |
| Markup | PASS AFTER FIX | Profit/adjusted; case O 66.666667%; zero cost undefined. |
| Costing snapshots | PASS AFTER FIX | Immutable version/profile; status and restore retain values; legacy format-one reconstruction. |
| Current vs historical costing | PASS AFTER FIX | Recursively reprice pinned child formula; saved total remains unchanged. |
| Missing-cost warnings | PASS AFTER FIX | Missing ingredient/packaging or incompatible conversion; known subtotal and unavailable profit. |
| Costing Overview | PASS AFTER FIX | Version/size, yield, cost split, allowance, price, profit, margin, timestamp and missing flag. |
| Cost filters | PASS AFTER FIX | Search/category/product-line/status/mode/condition/recent and matching pagination. |
| Cost sorting | PASS AFTER FIX | Highest/lowest adjusted cost, highest profit, lowest/highest margin, updated, stable name order. |
| Negative-profit handling | PASS AFTER FIX | Visible negative profit and warning; current-price browser case −₱90. |
| Break-even | PASS AFTER FIX | Adjusted cost at selected price basis; no selling price mutation. |
| Student Recipe import | PASS | Actual costed source imports allowed fields only; later production edit leaves student copy unchanged. |
| Security | PASS AFTER FIX | Role/API/RLS boundaries, private helpers/files, stored identifier injection fixed; live baseline recorded. |
| Supabase/database integrity | PASS | 86 migrations, relationships/immutable triggers/stale revisions; live read-only pointer/ID checks. |
| Google Drive backup | PASS | Private daily/monthly metadata and actual archive checksum; new live recipe absent from older archive. |
| Restore process | PASS | Actual older archive plus complete synthetic recipe/profitability archive in isolated database. |
| Desktop | PASS | 1440px reader/editor/catalog/profitability; complete browser workflows and PDFs. |
| Tablet | PASS | 820/1024px browser emulation, quantities/checkoffs/layout; not real iPad/Safari certification. |
| Mobile | PASS | 390px editor/reader/costing/catalog, 320px kitchen; no tested horizontal overflow. |
| Performance | PASS | 500 recipes/6,000 rows, API and browser measurements; concurrent/remote load unverified. |
| Accessibility | PASS | Keyboard ingredient picker, labels/focus, native dialogs, alt text and responsive checks; full assistive-tech audit unverified. |
| Error handling | PASS AFTER FIX | Save/API/upload/backup failure, retry, invalid inputs, missing prices and clear R&D relation error. |
| Concurrency | PASS | Stale two-editor interleaving, duplicate save/promotion, pinned open production version and backup consistency; simultaneous server sessions unverified. |

## Requirements 1–92 traceability

The rows map the numbered request to tested evidence or the approval gate. They do
not imply every hypothetical input or hardware combination has been executed.

| Request | Result | Evidence / boundary |
|---|---|---|
| 1. COMPLETE RECIPE LIBRARY AUDIT | PASS | Library, duplicate/archive/recover, status compatibility, personal state and combined filters. |
| 2. RECIPE BASIC INFORMATION | PASS | Unicode/emoji/special names, long description, blank name, duplicate name/code; generated timestamps/author/version. |
| 3. INGREDIENT TABLE | PASS | Browser ingredient picker, add/remove/reorder, linked metadata persistence and keyboard add. |
| 4. INGREDIENT GROUPS / COMPONENTS | PASS | Component editor, ordering, assembly and scaling suites. |
| 5. MASTER INGREDIENT DATABASE | PASS | Purchase/resource/catalog tests; IDs reused, allergens and historical references retained. |
| 6. UNIT CONVERSION | PASS | Math units and A/B/C independent cost oracle. |
| 7. INCOMPATIBLE UNITS | PASS | Cross-dimension and unknown pack conversion errors; no density guessed. |
| 8. DECIMAL PRECISION | PASS | Fraction/rational math plus independent small-price oracle. |
| 9. RECIPE SCALING | PASS AFTER FIX | Nine factors in audit unit test; stored source comparison. |
| 10. SCALE BY YIELD | PASS AFTER FIX | Count/portions/weight/pans tests; custom molds use explicit pan count. |
| 11. TEMPORARY PRODUCTION SCALE | PASS | Kitchen scaling and saved formula deep equality. |
| 12. ROUNDING | PASS AFTER FIX | Exact/display rounding; invalid rounding now hides stale values. |
| 13. YIELD | PASS AFTER FIX | Yield validation, raw-mass review and configured size fields. |
| 14. TOTAL RECIPE WEIGHT | PASS AFTER FIX | Mass-only known weight; no packaging/equipment in raw food mass. |
| 15. PRODUCTION LOSS | PASS AFTER FIX | Measured total loss and warnings; separate trimming/transfer loss fields are not implemented. |
| 16. RECIPE COMPONENT LINKING | PASS | Linked source versions, named sizes, quantities and costs. |
| 17. COMPONENT VERSION SAFETY | PASS | Pinned parent and changed child test. |
| 18. METHOD / PROCEDURE | PASS AFTER FIX | Component methods/assembly, timers, equipment and photos; legacy checkoffs. |
| 19. MULTI-STAGE BAKING | PASS | Two-stage save/production/PDF fixture; physical oven behavior not simulated. |
| 20. R&D / TESTING LOG | PASS AFTER FIX | R&D browser/API flows and immutable approved recipe. |
| 21. PROMOTE TEST TO NEW VERSION | PASS | Owner promotion creates version; duplicate promotion denied. |
| 22. VERSION HISTORY | PASS | Immutable version history and restore suites. |
| 23. VERSION COMPARISON | PASS | Structured diff and legacy normalization; quantities/method/yield/baking comparisons. |
| 24. RESTORE PREVIOUS VERSION | PASS | Restoration creates a new version and retains saved costs. |
| 25. PRODUCTION MODE | PASS AFTER FIX | Kitchen workflow/section/allergen/quantity reader. |
| 26. PRODUCTION MODE SAFETY | PASS | No kitchen editing controls; direct API write denial. |
| 27. PRODUCTION MODE SCALING | PASS | Scaled quantities and price result; master deep equality. |
| 28. PRODUCTION MODE CHECKLIST | PASS AFTER FIX | Ingredient and step state, independent legacy fallback, refresh and reset. |
| 29. TABLET PRODUCTION USE | PASS | 820/1024 portrait/landscape emulation; real touch hardware remains NOT TESTABLE. |
| 30. SUPPLIER SYSTEM | PASS | Supplier resource UI and database quote relationships. |
| 31. INGREDIENT PRICE MANAGEMENT | PASS | Purchase and preferred/lowest-comparable policy fixtures. |
| 32. PRICE HISTORY | PASS | Append-only price history and saved snapshot tests. |
| 33. ACTIVE COST | PASS | Documented automatic lowest comparable latest quote per active supplier; explicit preferred override. |
| 34. PACKAGING DATABASE | PASS | Packaging CRUD, dimensions/photos/supplier table, soft deletion. |
| 35. PACKAGING COST CALCULATION | PASS | ₱2,000/100=₱20 independently checked. |
| 36. PRODUCT PACKAGING COMPOSITION | PASS | Multiple packaging rows, 3 holders, linked and manual costs. |
| 37. BASE COSTING — REQUIRED | PASS AFTER FIX | Dedicated required cost breakdown implemented. |
| 38. COST PER BATCH | PASS AFTER FIX | Complete base batch costs and missing-total withholding. |
| 39. COST PER PIECE / UNIT | PASS AFTER FIX | Saleable count independent from raw yield. |
| 40. LABOR & UTILITIES ALLOWANCE — REQUIRED | PASS AFTER FIX | Allowance 0/10/20/25 and percent/peso display. |
| 41. DO NOT CONFUSE LABOR ALLOWANCE WITH PROFIT | PASS AFTER FIX | Explicit allowance labels, margin and markup denominators separate. |
| 42. SELLING PRICE — REQUIRED | PASS AFTER FIX | Manual selling price, selected unit/batch basis. |
| 43. GROSS PROFIT — REQUIRED | PASS AFTER FIX | Expected ₱80 profit from ₱200−₱120. |
| 44. PROFIT MARGIN — REQUIRED | PASS AFTER FIX | Expected 40% margin. |
| 45. MARKUP — REQUIRED | PASS AFTER FIX | Expected 66.666667% markup. |
| 46. PROFITABILITY SUMMARY | PASS AFTER FIX | Saved/current batch+unit summary and source/version labels. |
| 47. BATCH VS UNIT PROFITABILITY | PASS AFTER FIX | Six-unit and batch-price fixtures P/Q; individual values checked. |
| 48. SELLING PRICE MAY BE PER UNIT OR PER BATCH | PASS AFTER FIX | Item, box, cake, tray and set tested. |
| 49. PRODUCT YIELD VS RECIPE YIELD | PASS AFTER FIX | Explicit saleable yield; raw yield not reused. |
| 50. COST SNAPSHOTS | PASS AFTER FIX | Costing Only has no invented selling price/profit. |
| 51. LIVE COST VS HISTORICAL COST | PASS AFTER FIX | Saved/current selector; immutable historical prices. |
| 52. COST RECALCULATION | PASS AFTER FIX | Current price update does not write saved snapshot. |
| 53. MISSING COST DATA | PASS AFTER FIX | Missing ingredient/packaging/conversion warnings and null complete totals. |
| 54. ZERO / INVALID COST | PASS | Zero and negative prices, zero purchase size, negative quantity and unsupported conversion fixtures. |
| 55. COSTING PRECISION | PASS AFTER FIX | No early two-decimal cost-unit rounding; exact Python oracle and PG numeric. |
| 56. COSTING TEST MATRIX | PASS AFTER FIX | Independent A–O plus P–S matrix. |
| 57. SELLING PRICE BELOW COST | PASS AFTER FIX | Negative-profit warning and preserved sign. |
| 58. BREAK-EVEN | PASS AFTER FIX | Break-even value at selected basis; no price mutation. |
| 59. PRODUCT COSTING OVERVIEW — REQUIRED | PASS AFTER FIX | Required central overview implemented and browser tested. |
| 60. COSTING OVERVIEW FILTERS | PASS AFTER FIX | Combined filters tested against real SQL. |
| 61. SORTING | PASS AFTER FIX | All cost/profit/margin orders verified. |
| 62. COSTING ALERTS | PASS AFTER FIX | Missing, negative, >90-day saved reminder; changed-price indication on explicit current calculation. |
| 63. COSTING PER RECIPE VERSION | PASS AFTER FIX | Version ID/number and size on every saved cost response. |
| 64. SUPPLIER CHANGE IMPACT | PASS AFTER FIX | Preferred supplier/active quote changes affect current only. |
| 65. DELETE / ARCHIVE SAFETY | PASS | Recoverable catalog/recipe deletion; versions/prices immutable; referenced component guard. |
| 66. SECURITY / PERMISSIONS | PASS AFTER FIX | Direct API/RLS denial and stored attribute-injection regression. |
| 67. STUDENT RECIPE IMPORT REGRESSION | PASS | Actual new profitability fields excluded from independent Academy copy. |
| 68. GOOGLE DRIVE BACKUP | PASS | Archive field coverage plus older real Drive archive verification. |
| 69. BACKUP HISTORY | PASS | Daily/monthly files, retention slots, failures and previous-copy preservation. |
| 70. RESTORE VALIDATION | PASS | Actual 1,026-row/2-file restore plus complete synthetic recipe restore. |
| 71. PERFORMANCE | PASS | 500-recipe local p50/p95; simultaneous/remote load excluded. |
| 72. ERROR HANDLING | PASS AFTER FIX | Injected connection/save/upload/backup failures and recoverable errors. |
| 73. CONCURRENCY | PASS | Interleaved stale revisions, duplicate save/promotion, production pins; multi-session load excluded. |
| 74. AUTOSAVE | PASS | Private draft autosave separate from saved/Final versions; stale base revision retained. |
| 75. DATA INTEGRITY | PASS AFTER FIX | Constraints, IDs, catalog soft deletes and live pointer/duplicate checks. |
| 76. LEGACY / CONTRADICTION AUDIT | PASS AFTER FIX | Authoritative PG costing, shared rational quantity math; cache versions and legacy defaults reconciled. |
| 77. FINAL TECHNICAL REGRESSION | PASS | Fresh 20-suite regression all PASS; executed scenarios listed below. |
| 78. POST-AUDIT UI / UX REVIEW | PASS | Post-audit proposal review follows this technical report. |
| 79. RECIPE LIBRARY UX | PASS | Library reviewed in Batch B/G proposals. |
| 80. RECIPE EDITOR UX | PASS | Ingredient editor reviewed in Batch B. |
| 81. R&D UX | PASS | R&D reviewed in Batch C. |
| 82. PRODUCTION UX | PASS | Production reviewed in Batch A. |
| 83. COSTING UX | PASS | Costing summary reviewed in Batch D. |
| 84. COSTING SUMMARY DESIGN | PASS | Five main values emphasized; optional compaction proposed, not applied. |
| 85. COSTING OVERVIEW UX | PASS | Missing/negative/low margin identification reviewed in Batch D. |
| 86. SUPPLIER UX | PASS | Supplier price update/comparison/history reviewed in Batch E. |
| 87. MOBILE / TABLET UX | PASS | Desktop/tablet/phone browser review in Batch F; physical hardware unverified. |
| 88. UI / UX APPROVAL GATE | PASS | Every proposal has required fields and WAITING FOR APPROVAL. |
| 89. BEFORE VS PROPOSED | PASS | Actual BEFORE screenshots and separate HTML/CSS mockups; no application redesign applied. |
| 90. WORKFLOW COMPARISON | PASS | Counted workflow actions, proposed action counts and tradeoffs in proposal pack. |
| 91. GROUP RECOMMENDATIONS | PASS | Seven batches A–G in the proposal pack. |
| 92. AFTER APPROVAL | NOT TESTABLE | NOT TESTABLE until owner approves specific optional changes; implementation and actual AFTER intentionally pending. |

## Untested items and remaining risks

| Status | What | Why not fully verified | Required next evidence | Risk |
|---|---|---|---|---|
| NOT TESTABLE | New frontend through authenticated live browser/CDN | Database is deployed; frontend awaits upstream merge | Merge frontend, then authenticated live smoke check | Auth/network or cached-browser issues can differ from the fixture adapter |
| NOT TESTABLE | Fresh live recipe backup and live disaster recovery | Latest actual archive predates the recipe; destructive live restore prohibited | Next successful scheduled backup containing recipe/version IDs; repeat isolated restore | Recovery point has not yet demonstrated coverage of this newly created live recipe |
| NOT TESTABLE | iPad/Safari, Android, touch/oven-floor use | Available browser is desktop Chrome with emulated widths | Staff trial on real portrait/landscape tablets, keyboard and touch | Browser rendering, wet/gloved hands, sleep/wake and print differences |
| NOT TESTABLE | Concurrent PostgreSQL sessions and sustained load | PGlite fixture serializes database requests | Staging multi-session save/price/backup load with real network | Lock contention, peak latency and multi-client races beyond tested stale-revision interleavings |
| NOT TESTABLE | Very large/deep recipe graphs | Benchmark is 500 recipes, 12 ingredient rows each; recursive correctness fixtures are smaller | Representative 5,000+ recipe/deep-component dataset and query plans | Recursive costing/index demand could grow |
| NOT TESTABLE | Complete WCAG/assistive technology certification | Keyboard, labels, focus, dialogs and viewports checked; no full screen-reader/device suite | NVDA/VoiceOver, zoom, contrast and target-size audit | Some users may experience reading/focus/touch friction |
| NOT TESTABLE | Actual supplier invoice accuracy | Stored prices were not reconciled with invoices | Owner reviews purchase quantity/unit/currency and chosen supplier | Software can calculate consistently from incorrect source data |
| NOT TESTABLE | Actual yield/loss and oven settings | Physical production was not performed | Weigh a real batch before/after and validate stages | Process loss and equipment calibration remain operational inputs |
| NOT TESTABLE | Arbitrary density/pack contents and separate loss categories | No explicit general density/container-contents or trimming/transfer-loss model exists | Define conversion/loss requirements before adding those features | Unsupported dimensions are refused; manual configuration may be needed |
| NOT TESTABLE | Every possible legacy/OCR file | Executed DOCX, text PDF, scanned PDF and image fixtures are finite | Owner review of imported quantities and uncertain layouts | OCR/handwriting or unusual table layouts may require correction |
| ISSUE REMAINS | Project-wide pre-existing security advisories | Outside the recipe change; baseline preserved | Review the exact advisor objects/settings in a separate scoped security task | Larger project posture is not certified by recipe role tests |
| NOT TESTABLE | Optional UX implementations | Owner explicitly required approval first | Approve named changes, then implement/retest and capture actual AFTER | Mockups represent proposals only |

Operational follow-up: monitor failed backups, pricing changes, incomplete costing,
unusually low margins, stale editors and slow library/overview requests. At rollout,
manually reconcile one actual product's invoice-derived base cost and saleable yield.

## Executed scenario inventory

The following are the actual named checks from the final database and browser logs.
Unit test source files supply the exact quantity/conversion/precision fixtures.

### recipes-db

- recipes reject anonymous, unverified, customer and unassigned staff access
- owner grants chef and kitchen permissions independently of ordinary staff privileges
- create and explicitly publish a recipe, keeping private information out of kitchen payloads
- chef changes create drafts while the approved kitchen formula remains unchanged
- production versions, prices and audit history cannot be overwritten
- draft autosave and local production scaling do not touch saved formulas
- structured quantities and identities are validated on the server
- master resources retain supplier links and append-only price history
- linked components stay pinned when their source changes and cycles are rejected
- duplication and variations create new IDs with their base version retained
- R&D updates preserve prior values and promotion requires an explicit owner action
- search, tag/status filters and pagination do not leak draft recipes to kitchen staff
- restoring a historical version makes a new version without overwriting the old formula
- archive and recoverable deletion preserve history and remove kitchen access
- pinned component costs and ingredient allergens stay historically reproducible
- unpublished variation bases and private search terms are hidden from kitchen access
- completed production quantities are versioned references without editing formulas
- uploads require matching metadata and test photos remain private
- empty formulas cannot be published
- linked packaging costs and approved snapshots survive supplier price changes
- removing a former chef account preserves historical formulas and attribution safely
- a thousand-recipe library stays paginated and searchable without returning recipe documents
- revoked kitchen access immediately blocks recipe APIs
- recipe component associations survive saving and the kitchen privacy projection
- component reordering in a draft leaves the approved formula and associations unchanged
- invalid, cross-size and duplicate component associations are rejected atomically
- legacy recipes without procedure associations remain editable and private helpers stay private
- linked packaging costs are captured while kitchen references exclude every pricing field
- packaging price updates affect a new draft while approved packaging and costs stay historical
- packaging photos are taken from the catalog, linked to the recipe, and available only to authorized kitchen viewers
- a recipe photo override and catalog changes preserve approved photos, prices, and other packaging records
- older linked recipes inherit packaging photos without rewriting their stored versions or exposing unrelated files
- Final is a direct transition from Draft, preserves prices and publishes the saved formula
- status changes require owner access, a current revision and one of the four statuses
- Hidden withdraws a recipe from kitchen listing and direct access while retaining admin history
- Archive leaves the active library and remains searchable through the Archive filter with matching totals
- explicitly returning to Draft withdraws Final without modifying its saved formula
- Final still requires reviewed imports and nonempty ingredients; hidden saves cannot bypass owner permissions
- legacy Testing and Approved versions appear under Draft; legacy Production appears under Final
- duplicate procedure and step IDs cannot create shared kitchen checkoffs
- all optional yield fields reject invalid values in direct API requests
- a mismatched R&D version produces a clear error and writes no log
- Unicode names, duplicate names, distinct codes and combined library filters retain separate identities
- two editors and duplicate saves cannot overwrite a newer version, and stale autosaves remain private drafts
- Independent cost oracle A: Single ingredient
- Independent cost oracle B: Mixed purchase sizes
- Independent cost oracle C: Ingredients, multiple packaging items and direct cost
- Independent cost oracle D: Pinned component portion
- Independent cost oracle E: Half batch
- Independent cost oracle F: 1.15 batch
- Independent cost oracle G: Ten batches
- Independent cost oracle H: Missing ingredient price
- Independent cost oracle I: New supplier price
- Independent cost oracle J: Labor allowance zero
- Independent cost oracle K: Labor allowance ten percent
- Independent cost oracle L: Labor allowance twenty-five percent
- Independent cost oracle M: Selling below adjusted cost
- Independent cost oracle N: Break even
- Independent cost oracle O: Selling above adjusted cost
- Independent cost oracle P: Six saleable units
- Independent cost oracle Q: Explicit batch selling price
- Independent cost oracle R: Zero selling price
- Independent cost oracle S: Confirmed zero cost
- selling basis and saleable yield are independent of raw yield, including box, cake, tray and set
- incomplete ingredient or packaging prices suppress full cost and profit, while zero cost remains explicit
- costing-only components have base and adjusted costs without invented selling prices
- larger portion weights increase ingredient cost without inventing extra saleable items
- server rejects invalid profitability settings before saving any recipe version
- a fixed charge is not multiplied while variable ingredients and packaging scale
- legacy format-one snapshots reconstruct saved costs without consulting new prices or guessing charge categories
- current prices recursively refresh pinned component formulas while saved costs and profitability remain immutable
- costing APIs and private helper functions deny students, kitchen, unverified and anonymous callers
- Academy imports whitelist a real costed production version and retain an independent student copy
- costing overview filters, totals, sorting and pagination operate on matching saleable sizes

### access-db

- only an owner can invite accounts and owner privileges cannot be overwritten
- a verified recipe-only account receives access without shop administration privileges
- pending invitations are idempotent, verified-email-bound, and privately listed
- expired, revoked and changed-role invitations cannot send stale access emails
- packaging supplier is saved without pricing and invalid supplier references are rejected
- alternative quotes use lowest compatible unit cost with an explicit preferred-supplier override
- one purchase creates missing ingredient/supplier records atomically and retries cannot duplicate it
- packaging photos require completed private image uploads and retain canonical file paths

### catalog-db

- only the owner can delete, restore or list deleted catalog records
- delete and restore each resource kind without losing records or historical quotes
- deleting preferred supplier falls back for new costing and preserves production snapshots
- deleted ingredients remain readable in existing production versions
- category deletion preserves references and enforces parent/child restoration order
- deletion applies before pagination and is retained in the audit trail

### backup-db

- recipe backup is owner-only and cannot report success without Drive verification
- backup snapshot remains consistent while recipes and prices are edited
- complete archive restores across timezones with matching nested formulas, timestamps and relationships
- modified file bytes are rejected by recovery checksum validation
- verified uploads advance status and monthly copies use the verified daily archive
- failed Drive uploads preserve good copies, expose the error and permit retry

### academy-db

- Anonymous API and gallery gate
- Existing/new account without classes gets global sections and no protected features
- Bulk assignment deduplicates and never opts accounts into newsletters
- Instructor assignment is dynamic and class-scoped
- Student recipe whitelist and independent production copy
- Recipe edit creates a version and leaves Production unchanged
- Announcement reads are per account; future announcements stay hidden
- Upcoming workshops accessible without enrollment
- Submission starts pending; other accounts cannot read media
- Global mixed-class gallery is visible to all signed-in accounts
- Private-to-Instructor submissions never become gallery posts
- Wrong-class instructor contact and forged class/recipe references fail
- Question with multiple attachments stays in the correct private thread
- Instructor replies have participant-specific unread state
- Direct private tables and self-elevation are denied
- Revocation blocks classes, recipes, messages, uploads immediately but preserves gallery/history
- Independent Academy consent and marketing recipient suppression
- Owner backup snapshot contains Academy metadata, excludes secrets and image bytes
- All new tables have RLS and no direct customer grants

### academy-recovery

- linked-component import, module photo, archive integrity and isolated metadata restore

### edge

See the corresponding checked-in test and successful final log.

### ui-recipes

- Upload, convert and preview a private product photo
- Create and publish through the editor
- Temporary scaling preserves the saved formula
- Draft changes leave the kitchen recipe on its published version
- Compare and duplicate saved versions
- Create a master ingredient with a purchase price
- Record purchase creates the ingredient, supplier, brand and price together
- Compact ingredient table shows per-gram costs, sorts quotes, preserves search focus and fits desktop/tablet/phone
- Packaging supplier and photo persist without price; unrelated edits preserve price history; desktop/mobile spacing
- Compare supplier prices, set preferred override and view history without losing form edits
- Packaging uses the same table, shares spacing preference and shows preferred-supplier cost per piece
- Ingredients: compact list, cancel deletion, delete, and restore
- Suppliers: compact list, cancel deletion, delete, and restore
- Packaging: compact list, cancel deletion, delete, and restore
- Equipment: compact list, cancel deletion, delete, and restore
- Categories: compact search, mobile/tablet fit, delete from editor and restore
- Owner invites recipe-only accounts from Access with Kitchen as default
- Save an R&D photo and log, then explicitly promote the formula
- Record finished production quantities separately from recipes
- Backup UI does not imply success or allow an unconfigured upload
- Mobile editor accepts fractions with no horizontal page overflow
- Read-only kitchen layout, checkoffs and overflow at 390px
- Read-only kitchen layout, checkoffs and overflow at 820px
- Read-only kitchen layout, checkoffs and overflow at 1440px

### ui-recipe-components

- Import through the review screen: three ingredient/procedure pairs, assembly last, simple step inputs
- Rename, move, add and remove components while retaining their own procedures and final assembly
- Component editor and expanded procedure options fit desktop, tablet and phone
- Reviewed import saves and publishes all component links through the real database API
- kitchen A4 export has paired components followed by assembly
- presentation Letter export has paired components followed by assembly
- Duplicating a size remaps component links and leaves the approved version intact
- Kitchen 390px: paired sections, final assembly, scaling, no overflow or private source
- Kitchen 820px: paired sections, final assembly, scaling, no overflow or private source
- Kitchen 1440px: paired sections, final assembly, scaling, no overflow or private source
- Older-import rebuild requires explicit review/save and preserves yield, notes and the approved recipe
- Renaming a legacy component retains its matched procedure in the working draft without rewriting the saved recipe

### ui-recipe-ingredient-picker

- Explicit ingredient selection distinguishes brands, fills the unit, links costing and saves the correct supplier price
- Saving refreshes linked ingredient prices while historical recipe costs remain unchanged
- Typing clears the old link; keyboard selection of an unpriced ingredient never reuses the previous ingredient price
- Linking imported fractions converts kg to g without changing the amount
- Search, selection and compact ingredient rows fit desktop, tablet and phone
- Late search responses cannot replace current suggestions, and a failed search can be retried

### ui-recipe-packaging

- Selected packaging automatically supplies its details and both photos without duplicate entry fields
- Packaging selection lives in its own section, links unit/prices and avoids duplicate cost entries
- Unpriced packaging remains visibly incomplete, and removing it removes the cost link
- Desktop, tablet and phone layouts fit; saving captures the linked ingredient and packaging total
- Both PDF layouts include linked packaging, inherited photos and quantities scaled once without printing costs
- Custom photo upload replaces the inherited display; restoring defaults works and leaves the Packaging list unchanged
- Saved custom packaging photos appear alone in both PDF layouts
- Kitchen references scale correctly; new prices update a draft while approved costs and packaging stay unchanged
- Restoring catalog photos persists across saves while the previous custom-photo version remains intact
- Existing packaging notes and manual charges remain available; draft removal does not rewrite saved recipes

### ui-recipe-workflow

- One-click Save keeps the editor and selected size open across repeated saves; library Edit skips the reader
- A failed save leaves entered changes available for an immediate retry
- Draft becomes Final directly from the reader without reopening the editor or a confirmation dialog
- The reader shows a single scaled quantity; invalid input hides quantities instead of reverting to base amounts
- Hidden removes kitchen access, Archive leaves the active library, and Final restores access from the Archive filter
- Owner kitchen view has working recipe-admin and dashboard navigation
- Kitchen 1440px: one section, scaled quantities, retained checkoffs, reachable method/assembly/packaging, no overflow or admin access
- Kitchen 820px: one section, scaled quantities, retained checkoffs, reachable method/assembly/packaging, no overflow or admin access
- Kitchen 390px: one section, scaled quantities, retained checkoffs, reachable method/assembly/packaging, no overflow or admin access
- Kitchen 320px: one section, scaled quantities, retained checkoffs, reachable method/assembly/packaging, no overflow or admin access
- Linked component detail uses the selected size and production amount instead of its base formula
- Chef can return to recipe editing while owner-only status controls stay protected

### ui-recipe-startup

See the corresponding checked-in test and successful final log.

### ui-recipe-import-export

- Real DOCX text and ingredient rows
- Text PDF extraction
- Photo OCR using locally hosted worker, WASM and language data
- Scanned PDF page rendering and OCR
- kitchen PDF: scaled main formula, pinned component, photos and separate references
- presentation PDF: scaled main formula, pinned component, photos and separate references

### ui-recipe-profitability

- Browser creates ingredient, two suppliers, ingredient price and packaging purchase price
- Browser totals independently match ₱125 base, 20% allowance, ₱150 adjusted, ₱90 profit, 37.5% margin and 60% markup
- Desired 18 pieces gives 3 kg, ₱375 base and unchanged six-piece master formula
- Current supplier-price update shows negative profit while the saved version retains its original costs
- Failed or invalid costing clears stale totals, shows a useful error and can be retried
- Costing Overview filters, version-specific opening and profitability display fit desktop, landscape/portrait tablet and phone
- Invalid saleable yield cannot save, and Costing Only requires no selling price
- Kitchen cannot see profitability, and invalid rounding hides quantities and disables printing at all tested tablet/phone widths

### ui-recipe-security

- Saved row IDs, photo IDs, file references, ingredient text and procedures render as data without event attributes
- Saved component size identifiers cannot inject click handlers in the component picker
- Legacy steps without IDs have independent checkoffs that survive refresh and reset correctly

### ui-academy-portal

- Logged-out direct URL has login/signup and no protected data
- No-class account can browse the gallery and has no instructor/submission controls
- Assigned class opens recipe; online tablet presentation has no download controls
- Mobile multiple-photo submission shows visibility and enters moderation
- Assigned instructor approves work and it appears to a no-class account
- Question with multiple photos, private instructor reply, and unread indicators
- Admin class, module, account assignment and announcement controls save through real APIs
- Structured student recipe editing preserves groups and method details
- Failed photo upload can retry and publish one private submission
- Academy newsletter control saves independently and instructor can resolve a conversation
- Desktop, tablet and mobile dashboard layout
- Recipe ingredients fit a phone and revoked access clears an open private dialog

### ui-academy-auth

- Existing TLB login returns directly to Academy
- Signup verification link preserves Academy return across a new browser tab
- Signup with an immediate existing-auth session returns directly to Academy
- Forgot password preserves the Academy destination
- Authentication return allowlist rejects external and protocol-relative destinations


## Approval boundary

The required technical fixes and profitability system are complete in this branch.
The separate UX proposal pack groups options into A–G, shows actual BEFORE states
and isolated PROPOSED mockups, and labels each WAITING FOR APPROVAL. No optional
proposal has been implemented. After approval, only the named scope will be changed,
retested across calculations/recipes/devices, and shown with actual BEFORE/AFTER.
