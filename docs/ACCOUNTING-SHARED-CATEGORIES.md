# Shared accounting categories

Manual categories can contain both sales and expenses. The type belongs to each entry. Automatic website sales, discounts, delivery fees and courier costs retain their existing accounting treatment and owner-only access.

The migration copies the original category type onto every existing manual entry before combining categories whose trimmed, case-insensitive names match. Original duplicate category rows remain as archived aliases, and historical audit snapshots remain intact. Entry amounts, dates, client names and payment methods are preserved. Changing an entry's type creates a revision and audit event.

Excel exports have one Summary row per category, with Sales / income, Expenses and Net columns. Each category worksheet contains separate, independently filterable Sales / income and Expenses tables, with subtotals and no Net column. Summary formulas link to those subtotals. The date range and cancelled/refunded order exclusion apply to all exported sections.

## Rollout

Deploy the frontend and apply `supabase/migrations/20260926024704_accounting_shared_categories.sql` together. Accounting reports require `report_version: 2`; stale clients receive a refresh message instead of misclassifying shared categories. The new frontend also detects an older backend instead of showing incorrect totals. Refresh any open accounting tabs after rollout.

## Verification

- 241 backend checks, including original order eligibility, owner-only access, shared-category sales/expenses, type-only edits, duplicate consolidation, history preservation and replay safety.
- Five accounting/export tests, including a real XLSX round trip, literal handling of formula-like text, mixed-category subtotals and one summary row.
- Browser flows at 1440 px and 390 px, including expense selection, retained category selection, editing, payment details, delivery costs, date ranges, staff denial and an actual Excel download.
- Export imported and recalculated independently; summary reconciles. Summary and category sheets visually reviewed.

No Academy changes are included in this accounting release.
