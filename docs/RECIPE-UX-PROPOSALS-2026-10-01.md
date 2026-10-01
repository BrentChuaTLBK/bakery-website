# Recipe UX approval proposals — 1 October 2026

**All seven batches were approved by the owner and implemented on 1 October 2026.**
The owner also requested visible ingredient brands, an R&D status, and a global
per-account **Can view R&D** permission. See the [implementation and verification
report](RECIPE-APPROVED-UX-2026-10-01.md). The original proposal details below are
retained as the approval record; proposed mockups are not implementation evidence.

The required technical fixes, profitability summary and Costing Overview are already
implemented in the review branch. “BEFORE” means that tested branch state, after
required fixes, with synthetic data. “PROPOSED” is separate HTML/CSS; it does not
call application APIs, save data or replace application files.

Open the local visual review (`work/recipe-audit/review/index.html`) for side-by-side
screens and standalone prototypes. Actual screenshots cover desktop 1440×1000,
tablet 820×1100 and phone 390×844. No physical device claims are made.

The review found the core workflows functional. Priorities are A (production),
B (frequent editing), and D (product comparison). C offers a larger workflow change.
E/F/G can be approved independently. G is an optional optimization; the measured
500-recipe workload did not show a confirmed performance failure.

## Batch A — Production quick wins

**Change ID:** RECIPE-UX-01

**Area:** Production quick wins

**Current state:** Production has a collapsed Adjust quantity control and a section dropdown with previous/next buttons.

**Problem:** A common multiplier requires opening the controls and focusing a field. Jumping to a nonadjacent section requires opening the dropdown.

**Proposed change:** Add an always-visible quantity strip with ×1, ×2, ×3 and Custom, plus named section buttons on wide tablets. Keep exact quantities, version and warnings visible.

**Expected benefit:** Faster repeated batch changes and section jumps while keeping the formula read-only.

**Impact:** High

**Difficulty:** Easy

**Risk:** Low

**Platforms:** Tablet first; desktop and phone adapted

**Files / components affected:** recipe-kitchen.js, recipes.js, recipes.css

**BEFORE:** Open Adjust quantity → focus multiplier → type 3 → commit. A section jump uses the dropdown.

**PROPOSED:** Tap ×3. Tap the named section.

**Workflow comparison:** Common ×3 case: 2 pointer clicks plus typing/commit → 1 click. Section selection: 2 clicks → 1 where a named tab fits. Custom quantities retain the full controls.

**Information consolidated / error controls:** Recheck selected variant, exact factor, checkoffs, warning visibility and full PDF export; no master save from this strip.

**Visual evidence:** actual `before-A.png`; isolated `proposed-A.html` and rendered `proposed-A.png` in the local review folder.

**Approval:** WAITING FOR APPROVAL

## Batch B — Recipe editing

**Change ID:** RECIPE-UX-02

**Area:** Recipe editing

**Current state:** Each ingredient repeats labels, notes, picker guidance and row controls; four rows occupy much of the viewport.

**Problem:** Frequent quantity edits require scanning vertically past repeated labels. Supplier context needs additional opening/scrolling.

**Proposed change:** Use one column heading row, aligned quantity/unit inputs, a compact active-supplier hint and a per-row Details control. Keep the existing keyboard picker, Alt+Enter and reorder buttons.

**Expected benefit:** More formula rows visible at once, with predictable keyboard movement.

**Impact:** High

**Difficulty:** Moderate

**Risk:** Medium

**Platforms:** Desktop and tablet; stacked row cards on phone

**Files / components affected:** recipe-component-editor.js, recipe-ingredient-picker.js, recipes.js, recipes.css

**BEFORE:** Find ingredient → edit quantity; scroll for later rows or open row detail.

**PROPOSED:** Scan aligned rows → edit quantity; open Details only for less-used fields.

**Workflow comparison:** Quantity editing remains one field activation; the benefit is reduced scrolling. No new keyboard shortcut is claimed—the existing Alt+Enter already adds a row.

**Information consolidated / error controls:** Verify row identity, linked ingredient/supplier state, unsaved values, reorder, keyboard focus and all existing fields.

**Visual evidence:** actual `before-B.png`; isolated `proposed-B.html` and rendered `proposed-B.png` in the local review folder.

**Approval:** WAITING FOR APPROVAL

## Batch C — R&D

**Change ID:** RECIPE-UX-03

**Area:** R&D

**Current state:** The test-log dialog and tested formula editor are separate. Formula editing follows saving a test log and reopening it.

**Problem:** Reaching the tested quantities takes five navigation/save actions from the recipe, and formula changes are separated from observations.

**Proposed change:** Provide a New test workspace with the source version, editable test formula and observations together. Save a test explicitly; keep promotion as a separate owner action.

**Expected benefit:** Less manual back-and-forth and clearer association between the tested formula and its result.

**Impact:** High

**Difficulty:** Major

**Risk:** Medium

**Platforms:** Desktop/tablet split view; phone tabs

**Files / components affected:** recipes.js, recipe-model.js, component editor, R&D dialog/workspace styles

**BEFORE:** Testing / R&D → New test → Save test log → View / edit → Edit tested formula.

**PROPOSED:** New test → edit formula and notes together → Save test; review and Promote remain explicit later.

**Workflow comparison:** To reach formula editing: 5 actions → 1 proposed action, removing 4. This does not remove the eventual explicit Save or owner promotion.

**Information consolidated / error controls:** A test draft must never replace Final; preserve base version, revision conflicts, photo privacy, historical log edits and duplicate-promotion protection.

**Visual evidence:** actual `before-C.png`; isolated `proposed-C.html` and rendered `proposed-C.png` in the local review folder.

**Approval:** WAITING FOR APPROVAL

## Batch D — Costing and profitability

**Change ID:** RECIPE-UX-04

**Area:** Costing and profitability

**Current state:** The required overview is implemented as detailed product cards. Each includes eight values and metadata; the full recipe summary shows both batch and unit detail.

**Problem:** Comparing several margins requires scrolling. Batch amounts and per-item selling prices need careful reading.

**Proposed change:** Offer a desktop/tablet table with Base, Adjusted, Selling revenue, Profit and Margin using an explicit Batch / Unit switch. Keep source, version, missing-cost flags and an expandable breakdown. Preserve stacked cards on phone.

**Expected benefit:** Compare the same basis across products and identify missing or negative costs quickly.

**Impact:** High

**Difficulty:** Moderate

**Risk:** Medium

**Platforms:** All

**Files / components affected:** recipe-costing.js, recipes.css; presentation only, no new formula

**BEFORE:** Open Costing Overview → scan successive full product cards; open a product for details.

**PROPOSED:** Open Costing Overview → scan aligned figures on one chosen basis → expand a row for detail.

**Workflow comparison:** No guaranteed click reduction. More products fit in the mockup viewport; opening details remains deliberate. The required overview itself is already implemented.

**Information consolidated / error controls:** No mixed batch/unit columns; retain exact version and saved/current distinction; re-run independent calculations and keyboard/table accessibility checks.

**Visual evidence:** actual `before-D.png`; isolated `proposed-D.html` and rendered `proposed-D.png` in the local review folder.

**Approval:** WAITING FOR APPROVAL

## Batch E — Suppliers, ingredients and packaging

**Change ID:** RECIPE-UX-05

**Area:** Suppliers, ingredients and packaging

**Current state:** The general purchase form is available, and editing an item exposes full supplier forms below its other metadata.

**Problem:** Updating one known item can involve scrolling through unrelated fields or reselecting the item in the general purchase form.

**Proposed change:** Add Record price on each ingredient/packaging row. Open a focused form with the exact item, supplier, pack size and unit prefilled for review, then append a dated quote.

**Expected benefit:** Faster routine price entry without changing other item fields or historical snapshots.

**Impact:** Medium

**Difficulty:** Moderate

**Risk:** Medium

**Platforms:** All

**Files / components affected:** recipe-resource-table.js, recipe-suppliers.js, recipes.js; existing purchase API

**BEFORE:** Edit item → scroll to supplier quote → enter price → Save ingredient; or Record purchase → select item/supplier → save.

**PROPOSED:** Record price on the item → review prefilled supplier/size/unit → enter amount/date → Save price.

**Workflow comparison:** Edit and save remain 2 primary actions. The improvement is prefilled identity and fewer fields/scrolling, not a guaranteed click-count reduction.

**Information consolidated / error controls:** Show total purchase amount and quantity together; keep supplier choice explicit, use idempotent requests, append price history and leave saved recipe costs unchanged.

**Visual evidence:** actual `before-E.png`; isolated `proposed-E.html` and rendered `proposed-E.png` in the local review folder.

**Approval:** WAITING FOR APPROVAL

## Batch F — Tablet and mobile

**Change ID:** RECIPE-UX-06

**Area:** Tablet and mobile

**Current state:** At 390 px the native Price source selector truncates its visible label, and the dialog scrolls past batch and per-item details.

**Problem:** The active price source takes more attention to confirm; repeated long dialog scrolling slows quick lookups.

**Proposed change:** Use a full-height narrow-screen sheet with visible Saved / Current source buttons, a compact selected-basis summary, expandable breakdown and a fixed Close control. Increase kitchen checkoff hit areas without enlarging every text row.

**Expected benefit:** Clear source, easier touch use, and key figures visible together.

**Impact:** Medium

**Difficulty:** Moderate

**Risk:** Low

**Platforms:** Phone and small tablets

**Files / components affected:** recipe-costing.js, recipes.js, recipes.css

**BEFORE:** Open costing → inspect truncated source selector → scroll through supporting values.

**PROPOSED:** Open costing → see the full source label and five main values → expand supporting detail if needed.

**Workflow comparison:** Opening and closing still take one action each. Source changes become one button tap instead of opening a selector and selecting an option.

**Information consolidated / error controls:** Keep source/version labels explicit; test focus trap, Escape/back behavior, dynamic errors, zoom, 48 px targets and real devices before claiming touch validation.

**Visual evidence:** actual `before-F.png`; isolated `proposed-F.html` and rendered `proposed-F.png` in the local review folder.

**Approval:** WAITING FOR APPROVAL

## Batch G — Performance and library browsing

**Change ID:** RECIPE-UX-07

**Area:** Performance and library browsing

**Current state:** Returning from a recipe rebuilds and refetches the library. Search/filter state exists, but the browser work and scroll restoration are not retained as a browse session.

**Problem:** Repeated lookups restart the visual scan. Local benchmarks show approximately 153 ms median library navigation/render; real network cost is unmeasured.

**Proposed change:** Retain the library view and scroll position during a recipe visit. Invalidate it after edits/status changes and on permission/auth changes; show an explicit refresh. Keep current-price costing fresh and fetch the selected Final when opening production.

**Expected benefit:** Less rebuilding and more predictable return navigation.

**Impact:** Medium

**Difficulty:** Moderate

**Risk:** Medium

**Platforms:** All

**Files / components affected:** recipes.js, recipe-loading.js; library view lifecycle

**BEFORE:** Open recipe → Library → wait for list reconstruction → find the previous place.

**PROPOSED:** Open recipe → Back to results → return to the same filters and scroll position.

**Workflow comparison:** One Back action remains one action. Potential waiting/scroll reduction must be measured after implementation; no invented speed-up is promised.

**Information consolidated / error controls:** Do not cache private data across sign-out or permission revocation. Invalidate on mutations; verify archive and newly finalized versions before production use.

**Visual evidence:** actual `before-G.png`; isolated `proposed-G.html` and rendered `proposed-G.png` in the local review folder.

**Approval:** WAITING FOR APPROVAL

## After approval

Implement only the named changes. Repeat affected calculations and the complete
recipe regression, check desktop/tablet/phone, verify no historical formulas or
cost snapshots changed, and deliver actual BEFORE/AFTER captures. The current
mockups must not be relabeled as implemented AFTER screenshots.
