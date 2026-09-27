# Excel export compatibility

The September 2026 export could trigger Excel's recovery dialog with “Repaired Records: Table from /xl/tables/tableN.xml part (Table)”. Category table totals were written directly into worksheet cells after `addTable`. ExcelJS therefore serialized the Amount column with `totalsRowFunction="none"` even though the matching totals cell contained a SUM formula. Every category's income and expense table had the same mismatch.

Totals now use ExcelJS's table-column API: `totalsRowFunction: 'custom'`, `totalsRowFormula` and `totalsRowResult`. ExcelJS writes the formula and cached numeric value to the worksheet and marks the table column as a custom total. The worksheet cells, formulas, formatting, amounts and summary links are unchanged. SUM still includes filtered rows so the summary continues to represent the full report period. Each category retains separate income and expense tables.

The relevant format rule is documented in [Microsoft's totals-row formula reference](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.totalsrowformula?view=openxml-3.0.1). ExcelJS 4.4.0 emits the custom-function marker in the table definition and stores its formula in the worksheet cell. Native Excel verification is therefore required in addition to an ExcelJS round trip.

## Verification on 28 September 2026

- Reproduced a normal-load failure in desktop Excel 16.0 using the old exporter and synthetic records.
- Opened the corrected mixed-category export normally, read-only with recovery disabled: all 8 worksheets and 12 tables were retained, and net recalculated to the expected PHP 2,999.00.
- Opened the empty-period export normally: all 12 tables remained and net was zero.
- Opened the file produced by the browser's actual Export to Excel download normally: all 12 tables remained and the fixture net was PHP 2,249.75.
- Compared the old and corrected XLSX archives: only table definitions and the workbook creation timestamp differed. Worksheet cells, formulas, styles and other workbook parts were identical.
- Passed 6 accounting tests, including independent inspection of the serialized table metadata for mixed and empty categories, plus browser flows for desktop/mobile owners and staff restrictions.

Run `node --test tests/accounting.test.mjs` with `EXCELJS_TEST_PATH` pointing to the pinned ExcelJS 4.4.0 build. The browser flow is `node tests/ui/accounting.mjs` with the existing Playwright variables.

This is a frontend-only update. No accounting records or database migrations change. Refresh the accounting page after deployment and export a fresh workbook; previously downloaded files keep their original metadata.
