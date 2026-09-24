# Owner accounting

The **Accounting** dashboard is available only to an authenticated owner. Staff
and customers cannot read or write accounting data, including actual courier
costs. Data stays behind the existing shop API; private tables have RLS enabled
and no browser or service-role grants.

Choose a month, or enter any **From date / Through date** and apply the timeframe.
Both endpoints are inclusive and use Asia/Manila dates. A summary shows sales
and income by category, expenses by category, and income less recorded expenses.
This is a management record of saved order amounts and manual entries; changes
in paid order value still need their actual customer settlement handled separately.

## Automatic website entries

- **Website sales:** product subtotal before discounts, on payment approval date.
- **Discounts:** a separate expense, so the discount is subtracted only once.
- **Delivery fees:** a separate income category.
- Later amount changes append their differences on the change date. Cancellation
  or a full Refund label reverses previously recorded sales, discounts and fees.
  A cancellation plus a Refund label cannot reverse the same amounts twice.
  Removing a Refund label restores the amounts only if the order is still eligible.
- Existing paid orders are imported from their approval records and saved change
  history. An older order without history uses its current amounts on approval
  date and is disclosed in the dashboard. Reapplying the migration does not import twice.

Approval records and existing orders are never rewritten by accounting. Ordinary
fulfillment changes and repeated payment approvals cannot duplicate income.

## Delivery costs

Open an order and expand **Delivery accounting**. Enter the actual courier cost,
its date and an optional note. The comparison shows the customer fee less the
actual cost, including a shortfall when the shop pays more. A blank cost is
unknown; zero means no cost. Costs appear as **Delivery costs** expenses on the
entered cost date. Previously incurred costs remain even if an order is refunded,
cancelled or switched to pickup. Saving a cost does not alter the customer-facing
order, payment, fulfillment or stock.

The comparison lists orders whose payments were approved in the selected range.
Their cost date may be outside that range; only costs dated inside the range
appear in that range's expense total. Missing costs are counted separately.

## Manual entries and categories

Use **Add entry** for date, sales/expense type, amount, category and optional notes.
Create a category directly in that form, or use **Manage categories** to create,
rename and archive manual categories. Custom cakes, Pastries and Nori sales
categories are provided initially. Automatic categories cannot be renamed or
used for manual entries. Existing categories keep their sales/expense type.

Manual entries can be edited or removed. Removed entries disappear from totals,
but their audit record is retained. Revision checks prevent stale changes from
overwriting newer ones; retrying a completed save does not duplicate an entry.

## Excel

**Export to Excel** downloads a real `.xlsx` workbook with the loaded timeframe,
a Summary worksheet, one worksheet per category, and a Delivery comparison.
Exports include all matching entries, beyond the dashboard's 50-row pages.
Amounts are numeric PHP values, dates are real dates, and totals use formulas
with cached results. Category names are made Excel-safe and unique; notes remain
literal text, including text beginning with `=`. All workbook data is processed
in the browser. ExcelJS 4.4.0 is loaded only on export, with an integrity hash.

## Validation

- `node tests/backend/run.mjs` covers approval, corrections, refunds, delivery
  costs, owner-only access, date boundaries, >1,000 entries and migration replay.
- `node --test tests/accounting.test.mjs` checks calculation rules and a real XLSX roundtrip.
- `node tests/ui/accounting.mjs` checks desktop/mobile owner flows, staff denial,
  manual entries/categories, delivery comparison and actual browser downloads.
- `node scripts/build-static.mjs` checks the website build.

Browser tests use the same `PLAYWRIGHT_PACKAGE_ROOT` and
`BROWSER_EXECUTABLE_PATH` overrides as other UI tests. Set `EXCELJS_TEST_PATH` to
the local `exceljs@4.4.0/dist/exceljs.min.js` browser bundle for XLSX tests (use a
`.cjs` extension if it is inside an ES-module package). Production pins this
same version and its SHA-384 integrity value in `accounting-export.js`.
