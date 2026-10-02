# Recipe, purchase and Accounting workflow refinement

The recipe workspace now groups daily work into Recipes, Costing, Ingredients & supplies, and Manage. Library cards show current batch cost, yield, margin when applicable, and incomplete or below-cost conditions. Costing opens with all recipes, keeps optional filters collapsed, and returns from editing to the previous search.

The owner can set one labor and utilities percentage for every current recipe and size. An unset percentage preserves existing allowances; explicit zero is supported. Current linked component costs are included once. Saved historical snapshots remain unchanged.

The recipe editor has Ingredients & method, Yield & pricing, and Details & notes sections, with a live current-cost estimate. Each component keeps its ingredients and method together. Assembly follows the components and Packaging is last. The existing R&D test workspace, imports, photos, advanced scaling, production history and printing remain available. Working recipe drafts can be kept, resumed after reload, and saved as a new version.

Manage includes saved suppliers and custom units. Purchases choose a saved supplier, accept explicit contents for a custom unit such as a bag, and preview the comparable price, effective supplier price and number of linked recipes. Purchase retries are idempotent. Pack prices are normalized before storage; the item's conversion is saved separately. No mass/volume conversion is inferred. Unfinished purchases survive closing and reloading the same browser tab, and sign-out clears that tab's purchase draft. Ingredient and packaging lists include linked recipe counts.

Accounting opens in the current Manila month. All time derives its bounds from the earliest and latest eligible entry on every refresh and export. Pagination affects the visible table only; Excel includes the complete loaded range. Unapplied date edits do not silently change the export's range. Empty All time reports show no invented entry dates.

The shared form stylesheet removes native number-input spinner arrows on all 27 website pages, including the Academy pages. Numeric validation and numeric keyboards are retained.

## Release order

Apply `20261002085146_recipe_workflow_refinement.sql` before publishing the updated frontend. It adds shared settings, item-specific unit conversions, purchase previews, recipe-card costs, catalog usage counts and Accounting All time. Existing purchase clients remain supported. No production records are rewritten to choose a new default allowance.

This change was tested against an isolated database and browser fixtures. It does not itself apply a production migration or send email.

## Validation

- Recipe database suite: 93 checks, including shared allowance, nested components, immutable snapshots, pack conversions, supplier selection and purchase retries.
- Staff database suite: 21 checks; catalog deletion/restoration: 6 checks; backup and restore: 7 checks.
- Relevant recipe and Accounting unit tests: 54 checks, including serialized Excel workbooks.
- New recipe browser acceptance: 10 checks; Accounting acceptance: 5 checks, including a 56-entry Excel export across two table pages.
- Existing approved recipe UX: 7 checks; safe rendering/checklists: 3 checks; staff browser security: 18 checks; R&D browser visibility: 5 checks.
- Site-wide number controls: all 27 pages checked for the shared stylesheet, hidden spinners, valid decimals and retained range validation.

Run the targeted acceptance suites with `npm run test:recipe-refinement`. Existing dependency overrides (`PGLITE_PACKAGE_ROOT`, `PLAYWRIGHT_PACKAGE_ROOT`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` and `EXCELJS_TEST_PATH`) remain supported. Windows migration readers normalize CRLF before running SQL so function-patch matching also works during backup restore rehearsal.
