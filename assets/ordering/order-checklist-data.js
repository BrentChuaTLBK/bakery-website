import { isCalendarDate } from './date-calendar.js?v=daily-quantities-1';

export const checklistTitles = { orders: 'Orders checklist', pickup: 'Pickup checklist', delivery: 'Delivery checklist' };
const handoffStatuses = new Set(['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery']);
const dayMs = 86400000;

export function checklistSource(type) {
  if (!Object.hasOwn(checklistTitles, type)) throw new Error('Choose a checklist type.');
  return type === 'orders' ? 'order_checklist_period' : 'calendar_list';
}

export function checklistOrders(rows, type) {
  return rows.filter(row => !row.refund_label && row.status !== 'cancelled' && row.payment_status !== 'cancelled'
    && (type === 'orders' || (row.method === type && handoffStatuses.has(row.status))));
}

export async function loadChecklistPeriod(api, type, from, to, isCurrent = () => true) {
  const source = checklistSource(type);
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
    throw new Error('Choose a valid fulfillment date and an end date on or after it.');
  }
  const rows = new Map();
  const last = Date.parse(to + 'T00:00:00Z');
  const isoDate = value => new Date(value).toISOString().slice(0, 10);
  // Both staff reads accept up to 63 inclusive fulfillment dates at a time.
  for (let cursor = Date.parse(from + 'T00:00:00Z'); cursor <= last; cursor += 63 * dayMs) {
    const range = { from: isoDate(cursor), to: isoDate(Math.min(cursor + 62 * dayMs, last)) };
    const result = await api(source, range);
    if (!isCurrent()) return null;
    if (!Array.isArray(result?.orders)) throw new Error('Order data was incomplete.');
    for (const order of result.orders) {
      if (order.date >= range.from && order.date <= range.to) rows.set(order.id, order);
    }
  }
  return [...rows.values()];
}
