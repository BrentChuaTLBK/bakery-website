import {accountingSheetName, accountingTotals, accountingPaymentMethods} from './accounting.js?v=accounting-entry-details-1';

let library;
async function excelLibrary() {
  if (globalThis.ExcelJS) return globalThis.ExcelJS;
  if (!library) library = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    script.integrity = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';
    script.crossOrigin = 'anonymous';
    script.onload = () => globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(Error('Excel export could not load.'));
    script.onerror = () => { script.remove(); library = null; reject(Error('Excel export could not load. Check your connection and try again.')); };
    document.head.append(script);
  });
  return library;
}
const currency = '"₱"#,##0.00;[Red]("₱"#,##0.00);"₱"0.00';
const date = value => new Date(value + 'T00:00:00Z');
const quoted = name => "'" + name.replaceAll("'", "''") + "'";

// Workbook construction is separate from downloading so its numeric values,
// formulas, literal text and sheet names can be tested without an external service.
export function buildAccountingWorkbook(report, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'The Little Baker Kitchen'; wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const summary = wb.addWorksheet('Summary'), used = new Set(['summary', 'delivery comparison']);
  function header(sheet, title, columns, widths) {
    sheet.views = [{state: 'frozen', ySplit: 5}];
    sheet.properties.defaultRowHeight = 21;
    sheet.columns = widths.map(width => ({width}));
    sheet.mergeCells(1, 1, 1, columns.length); sheet.getCell('A1').value = title;
    sheet.getCell('A1').font = {name: 'Calibri', size: 20, bold: true, color: {argb: 'FF764B25'}};
    sheet.getRow(1).height = 36;
    sheet.mergeCells(2, 1, 2, columns.length); sheet.getCell('A2').value = `${report.start} to ${report.end} · PHP · Asia/Manila`;
    sheet.mergeCells(3, 1, 3, columns.length);
    sheet.getCell('A3').value = 'Paid confirmed / fulfilled orders only. Cancelled and refunded orders, discounts and courier costs are excluded.';
    sheet.getCell('A3').alignment = {wrapText: true, vertical: 'middle'}; sheet.getRow(3).height = 32;
    sheet.getRow(5).values = columns;
    sheet.getRow(5).eachCell(cell => {cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF764B25'}}; cell.font = {bold: true, color: {argb: 'FFFFFFFF'}};});
    sheet.pageSetup = {orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9};
    sheet.pageSetup.printTitlesRow = '1:5';
  }
  function totalStyle(row) {
    row.eachCell(cell => {cell.font = {bold: true};cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb:'FFF1E6D6'}};});
  }
  header(summary, 'TLB · Accounting summary', ['Category','Type','Sales / income','Expenses','Net'], [34,15,22,22,22]);
  const groups = report.summary.slice().sort((a,b) => (a.kind === 'sale' ? 0 : 1) - (b.kind === 'sale' ? 0 : 1) || a.name.localeCompare(b.name));
  for (const group of groups) {
    const name = accountingSheetName(group.name, used), sheet = wb.addWorksheet(name);
    header(sheet, group.name, ['Date','Source','Order ID','Client name','Payment method','Description','Sales / income','Expenses','Net'], [15,18,20,28,20,60,22,22,22]);
    const entries = report.entries.filter(e => e.category_id === group.id);
    for (const e of entries) {
      const r = sheet.addRow([date(e.entry_date),e.source,e.reference || '',e.client_name || '',accountingPaymentMethods[e.payment_method] || (e.source==='Manual'?'Not recorded':''),e.note || '',group.kind === 'sale' ? e.amount_cents / 100 : 0,group.kind === 'expense' ? e.amount_cents / 100 : 0]);
      r.getCell(1).numFmt = 'mmm d, yyyy'; for (const col of [4,6]) r.getCell(col).alignment = {wrapText: true, vertical: 'top'};
      r.height = Math.min(150, 21 * Math.max(1, Math.ceil(String(e.note || '').length / 58), Math.ceil(String(e.client_name || '').length / 26)));
      r.getCell(9).value = {formula:`G${r.number}-H${r.number}`,result:(group.kind === 'sale' ? 1 : -1) * e.amount_cents / 100};
    }
    if (!entries.length) sheet.addRow([null,'No entries in this timeframe']);
    const last = sheet.lastRow.number;
    sheet.autoFilter = {from: 'A5', to: `I${last}`};
    const total = sheet.addRow(['Total']);
    for (const [col, value] of [['G',group.kind === 'sale' ? group.amount_cents / 100 : 0],['H',group.kind === 'expense' ? group.amount_cents / 100 : 0]])
      sheet.getCell(`${col}${total.number}`).value = {formula:`SUM(${col}6:${col}${last})`, result: value};
    sheet.getCell(`I${total.number}`).value = {formula:`G${total.number}-H${total.number}`, result:(group.kind === 'sale' ? 1 : -1) * group.amount_cents / 100};
    for (const col of [7,8,9]) sheet.getColumn(col).numFmt = currency;
    totalStyle(total);
    const row = summary.addRow([group.name,group.kind === 'sale' ? 'Sales / income' : 'Expense']);
    for (const [col, source] of [[3,'G'],[4,'H'],[5,'I']]) row.getCell(col).value = {formula:`${quoted(name)}!${source}${total.number}`,result:sheet.getCell(`${source}${total.number}`).value.result};
  }
  const end = summary.lastRow.number, totals = accountingTotals(report), total = summary.addRow(['Overall total']);
  for (const [col,key] of [['C','sales'],['D','expenses'],['E','net']]) summary.getCell(`${col}${total.number}`).value = {formula:end>=6?`SUM(${col}6:${col}${end})`:'0',result:totals[key]/100};
  totalStyle(total); for (const c of [3,4,5]) summary.getColumn(c).numFmt = currency;
  summary.addRow([]);
  summary.addRow(['Delivery costs not recorded', totals.missingCosts]);
  summary.addRow(['Net = recorded income less recorded expenses. Missing costs are not treated as free delivery.']);
  summary.mergeCells(summary.lastRow.number,1,summary.lastRow.number,5);
  summary.lastRow.getCell(1).alignment = {wrapText:true}; summary.lastRow.height=32;
  const delivery = wb.addWorksheet('Delivery comparison');
  header(delivery, 'Delivery fee comparison', ['Approval date','Order ID','Order status','Fee collected','Actual cost','Difference','Cost date'], [17,20,24,22,22,22,17]);
  for (const d of report.deliveries) {
    const row = delivery.addRow([date(d.approval_date),d.reference,d.refund_label ? 'Refunded' : d.status.replaceAll('_',' '),d.fee_cents/100,d.cost_cents === null ? 'Not recorded' : d.cost_cents/100,null,d.cost_date ? date(d.cost_date) : null]);
    row.getCell(1).numFmt = row.getCell(7).numFmt = 'mmm d, yyyy';
    if (d.cost_cents !== null) row.getCell(6).value = {formula:`D${row.number}-E${row.number}`,result:(d.fee_cents-d.cost_cents)/100};
  }
  for (const c of [4,5,6]) delivery.getColumn(c).numFmt = currency;
  if (report.deliveries.length) delivery.autoFilter = {from: 'A5',to:`G${delivery.lastRow.number}`};
  return wb;
}

export async function exportAccounting(report) {
  const ExcelJS = await excelLibrary();
  const workbook = buildAccountingWorkbook(report, ExcelJS);
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link = document.createElement('a'); link.href = url; link.download = `TLB-accounting-${report.start}-to-${report.end}.xlsx`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),60000);
}
