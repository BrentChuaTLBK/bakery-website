export function accountingTotals(report) {
  const summary = report.summary || [];
  const sales = summary.filter(c => c.kind === 'sale').reduce((n, c) => n + Number(c.amount_cents), 0);
  const expenses = summary.filter(c => c.kind === 'expense').reduce((n, c) => n + Number(c.amount_cents), 0);
  const deliveries = report.deliveries || [];
  const recorded = deliveries.filter(d => d.cost_cents !== null);
  return {sales, expenses, net: sales - expenses,
    deliveryDifference: recorded.reduce((n, d) => n + Number(d.fee_cents) - Number(d.cost_cents), 0),
    missingCosts: deliveries.filter(d => d.cost_cents === null && !d.refund_label && !['cancelled','expired'].includes(d.status)).length};
}

export function parseAccountingAmount(value, optional = false) {
  const text = String(value).trim();
  if (optional && !text) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw Error('Enter a valid amount with up to two decimal places.');
  const [whole, decimal = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (cents > 999999999 || (!optional && cents === 0)) throw Error('Enter an amount from 0.01 to 9,999,999.99.');
  return cents;
}

export function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month) || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12) throw Error('Choose a valid month.');
  const [year, m] = month.split('-').map(Number);
  return {start: month + '-01', end: month + '-' + new Date(Date.UTC(year, m, 0)).getUTCDate()};
}

export function accountingSheetName(name, used) {
  const clean = String(name).replace(/[\\/*?:\[\]\x00-\x1f]/g, ' ').replace(/^'+|'+$/g, '').trim() || 'Category';
  let result = clean.slice(0, 31), n = 2;
  while (used.has(result.toLowerCase()) || result.toLowerCase() === 'history') {
    const suffix = ' (' + n++ + ')'; result = clean.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(result.toLowerCase()); return result;
}
