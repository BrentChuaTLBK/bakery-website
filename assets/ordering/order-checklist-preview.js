import { api, formatDate } from './client.js?v=approved-20261002-1';
import { checklistOrders, checklistTitles, loadChecklistPeriod } from './order-checklist-data.js?v=refund-cancel-20261120';
import { renderOrderChecklist } from './order-checklist-print.js?v=compact-orders-20261120';

const params = new URLSearchParams(location.search);
const type = params.get('type');
const from = params.get('from');
const to = params.get('to') || from;
const status = document.getElementById('preview-status');
const print = document.getElementById('print-checklist');
const sheet = document.getElementById('order-checklist-print');
print.addEventListener('click', () => window.print());

try {
  const rows = await loadChecklistPeriod(api, type, from, to);
  const orders = checklistOrders(rows, type);
  document.title = checklistTitles[type];
  if (orders.length) {
    const periodLabel = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
    sheet.innerHTML = renderOrderChecklist({ orders, type, periodLabel });
    status.hidden = true;
    print.disabled = false;
  } else {
    status.textContent = 'No orders match this checklist for the selected dates.';
  }
} catch (error) {
  status.textContent = `Couldn’t load this checklist. ${error.message || 'Please reload to try again.'}`;
}
