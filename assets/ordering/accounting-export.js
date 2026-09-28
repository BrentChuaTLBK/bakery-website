import {accountingSheetName, accountingTotals, accountingPaymentMethods} from './accounting.js?v=shared-categories-1';

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
    sheet.views = [{state: 'frozen', ySplit: 5, showGridLines: false}];
    sheet.properties.defaultRowHeight = 21;
    sheet.columns = widths.map(width => ({width}));
    sheet.mergeCells(1, 1, 1, columns.length); sheet.getCell('A1').value = title;
    sheet.getCell('A1').font = {name: 'Calibri', size: 20, bold: true, color: {argb: 'FF764B25'}};
    sheet.getRow(1).height = 36;
    sheet.mergeCells(2, 1, 2, columns.length); sheet.getCell('A2').value = `${report.start} to ${report.end} · PHP · Asia/Manila`;
    sheet.mergeCells(3, 1, 3, columns.length);
    sheet.getCell('A3').value = 'Paid confirmed / fulfilled orders only. Cancelled and refunded orders are excluded in full, including their discounts and courier costs.';
    sheet.getCell('A3').alignment = {wrapText: true, vertical: 'middle'}; sheet.getRow(3).height = 32;
    sheet.getRow(5).values = columns;
    sheet.getRow(5).eachCell(cell => {cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF764B25'}}; cell.font = {bold: true, color: {argb: 'FFFFFFFF'}};});
    sheet.pageSetup = {orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9};
    sheet.pageSetup.printTitlesRow = '1:5';
  }
  function tableStyle(sheet, first, last, columns, amountColumns, totalRow = null) {
    for (let number = first; number <= last; number++) {
      const row = sheet.getRow(number), isHeader = number === first, isTotal = number === totalRow;
      let lines = 1;
      // Include blank cells so borders and total-row shading run across the whole table.
      for (let column = 1; column <= columns; column++) {
        const cell = row.getCell(column), edge = {style: 'thin', color: {argb: 'FFD9C9B8'}};
        cell.border = {top: edge, bottom: edge, left: edge, right: edge};
        cell.font = {name: 'Calibri', size: 11, bold: isHeader || isTotal, color: {argb: isHeader ? 'FFFFFFFF' : 'FF2F2624'}};
        cell.alignment = {horizontal: amountColumns.includes(column) ? 'right' : 'left', vertical: 'middle', wrapText: true, indent: 1};
        cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: isHeader ? 'FF764B25' : isTotal ? 'FFF1E6D6' : 'FFFFFFFF'}};
        if (typeof cell.value === 'string') {
          const width = Math.max(8, sheet.getColumn(column).width - (isHeader ? 5 : 3));
          lines = Math.max(lines, cell.value.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0));
        }
      }
      row.height = Math.min(210, Math.max(28, lines * 16 + 10));
    }
  }
  header(summary, 'TLB · Accounting summary', ['Category','Sales / income','Expenses','Net'], [36,24,24,24]);
  const groups = report.summary.slice().sort((a,b) => a.name.localeCompare(b.name));
  for (const [index, group] of groups.entries()) {
    const name = accountingSheetName(group.name, used), sheet = wb.addWorksheet(name);
    const columns=['Date','Source','Order ID','Client name','Payment method','Description','Amount'];
    header(sheet, group.name, columns, [17,19,22,28,23,60,24]);
    sheet.views = [{state:'frozen',ySplit:6,showGridLines:false}];
    sheet.pageSetup.printTitlesRow='1:3';
    const subtotal = {};
    let titleRow = 5;
    for (const [kind, title, amountKey] of [['sale','Sales / income','sales_cents'],['expense','Expenses','expense_cents']]) {
      sheet.getRow(titleRow).values=[];
      sheet.mergeCells(titleRow,1,titleRow,7);
      const titleCell=sheet.getCell(titleRow,1);titleCell.value=title;
      titleCell.font={name:'Calibri',bold:true,size:14,color:{argb:'FF764B25'}};
      titleCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1E6D6'}};
      sheet.getRow(titleRow).height=30;
      const entries=report.entries.filter(e=>e.category_id===group.id&&e.kind===kind);
      const rows=entries.map(e=>[date(e.entry_date),e.source,e.reference||null,e.client_name||null,accountingPaymentMethods[e.payment_method]||(e.source==='Manual'?'Not recorded':null),e.note||null,e.amount_cents/100]);
      if(!rows.length)rows.push([null,null,null,null,null,'No entries in this timeframe',null]);
      const first=titleRow+2,last=first+rows.length-1,totalRow=last+1;
      // Excel requires the table definition and its totals cell to agree.
      // Keep SUM (including filtered rows) so the summary remains the period total.
      const totals={totalsRowFunction:'custom',totalsRowFormula:`SUM(G${first}:G${last})`,totalsRowResult:group[amountKey]/100};
      sheet.addTable({name:`Accounting_${kind}_${index+1}`,ref:`A${titleRow+1}`,headerRow:true,totalsRow:true,
        style:{theme:'TableStyleLight9',showRowStripes:true},
        columns:columns.map((name,i)=>({name:i===3&&kind==='expense'?'Supplier':name,filterButton:true,...(i===0?{totalsRowLabel:`Total ${title.toLowerCase()}`}:i===6?totals:{})})),rows});
      tableStyle(sheet,titleRow+1,totalRow,7,[7],totalRow);
      for(let row=first;row<=last;row++) {
        const r=sheet.getRow(row);r.getCell(1).numFmt='mmm d, yyyy';
      }
      if(!entries.length)sheet.getCell(first,6).alignment={horizontal:'center',vertical:'middle',wrapText:true};
      subtotal[kind]=totalRow;titleRow=totalRow+3;
    }
    sheet.getColumn(7).numFmt=currency;
    const row = summary.addRow([group.name]);
    row.getCell(2).value={formula:`${quoted(name)}!G${subtotal.sale}`,result:group.sales_cents/100};
    row.getCell(3).value={formula:`${quoted(name)}!G${subtotal.expense}`,result:group.expense_cents/100};
    row.getCell(4).value={formula:`B${row.number}-C${row.number}`,result:(group.sales_cents-group.expense_cents)/100};
  }
  const end = summary.lastRow.number, totals = accountingTotals(report), total = summary.addRow(['Overall total']);
  for (const [col,key] of [['B','sales'],['C','expenses'],['D','net']]) summary.getCell(`${col}${total.number}`).value = {formula:end>=6?`SUM(${col}6:${col}${end})`:'0',result:totals[key]/100};
  tableStyle(summary,5,total.number,4,[2,3,4],total.number);
  for (const c of [2,3,4]) summary.getColumn(c).numFmt = currency;
  summary.addRow([]);
  summary.addRow(['Delivery costs not recorded', totals.missingCosts]).getCell(2).numFmt='0';
  summary.addRow(['Net = recorded income less recorded expenses. Missing costs are not treated as free delivery.']);
  summary.mergeCells(summary.lastRow.number,1,summary.lastRow.number,4);
  summary.lastRow.getCell(1).alignment = {wrapText:true}; summary.lastRow.height=32;
  const delivery = wb.addWorksheet('Delivery comparison');
  header(delivery, 'Delivery fee comparison', ['Approval date','Order ID','Order status','Fee collected','Actual cost','Difference','Cost date'], [17,20,24,22,22,22,17]);
  for (const d of report.deliveries) {
    const row = delivery.addRow([date(d.approval_date),d.reference,d.refund_label ? 'Refunded' : d.status.replaceAll('_',' '),d.fee_cents/100,d.cost_cents === null ? 'Not recorded' : d.cost_cents/100,null,d.cost_date ? date(d.cost_date) : null]);
    row.getCell(1).numFmt = row.getCell(7).numFmt = 'mmm d, yyyy';
    if (d.cost_cents !== null) row.getCell(6).value = {formula:`D${row.number}-E${row.number}`,result:(d.fee_cents-d.cost_cents)/100};
  }
  for (const c of [4,5,6]) delivery.getColumn(c).numFmt = currency;
  tableStyle(delivery,5,delivery.lastRow.number,7,[4,5,6]);
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
