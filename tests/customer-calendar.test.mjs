import test from 'node:test';
import assert from 'node:assert/strict';
import { customerBookingWindow, customerDateIssue } from '../assets/ordering/shop-rules.js';
import { customerCalendarKeyTarget, customerCalendarModel, customerCalendarView } from '../assets/ordering/customer-calendar.js';

const now = new Date('2026-09-15T04:00:00Z');
const day = (model, date) => model.cells.find(item => item?.date === date);

test('booking window includes the current month and exactly two following calendar months', () => {
  assert.deepEqual(customerBookingWindow(now), {
    today: '2026-09-15', minDate: '2026-09-16', maxDate: '2026-11-30', minMonth: '2026-09', maxMonth: '2026-11'
  });
  assert.equal(customerDateIssue('2026-11-30', {}, 'pickup', now), '');
  assert.match(customerDateIssue('2026-12-01', {}, 'pickup', now), /Bookings are open through 2026-11-30/);
  assert.match(customerDateIssue('2026-09-14', {}, 'pickup', now), /past-date/);
  assert.match(customerDateIssue('2026-09-15', {}, 'pickup', now), /Same-day/);
});

test('Manila midnight rolls both date and month bounds, including year-end and leap February', () => {
  assert.equal(customerBookingWindow(new Date('2026-09-30T15:59:59Z')).maxDate, '2026-11-30');
  assert.deepEqual(customerBookingWindow(new Date('2026-09-30T16:00:00Z')), {
    today: '2026-10-01', minDate: '2026-10-02', maxDate: '2026-12-31', minMonth: '2026-10', maxMonth: '2026-12'
  });
  assert.equal(customerBookingWindow(new Date('2026-12-31T08:00:00Z')).maxDate, '2027-02-28');
  assert.equal(customerBookingWindow(new Date('2023-12-31T08:00:00Z')).maxDate, '2024-02-29');
  assert.equal(customerBookingWindow(new Date('2026-12-31T16:00:00Z')).minDate, '2027-01-02');
});

test('customer month navigation is bounded even with an old or malformed stored selection', () => {
  const initial = customerCalendarModel({ now });
  assert.equal(initial.month, '2026-09');
  assert.equal(initial.previousDisabled, true);
  assert.equal(initial.nextDisabled, false);
  assert.equal(initial.focusDate, '2026-09-16');
  assert.equal(customerCalendarModel({ now, month: '2020-01' }).month, '2026-09');
  const last = customerCalendarModel({ now, month: '2029-03' });
  assert.equal(last.month, '2026-11');
  assert.equal(last.nextDisabled, true);
  for (const value of ['2025-12-10', '2027-01-01', '2026-02-30', '<script>']) {
    const stale = customerCalendarModel({ now, value });
    assert.equal(stale.month, '2026-09');
    assert.ok(stale.selectionIssue);
  }
  assert.equal(customerCalendarModel({ now, value: '2026-11-17' }).month, '2026-11');
});

test('past dates, method closures and fulfillment weekdays disable date buttons without treating nonproduction dates as closures', () => {
  const settings = { blocked_dates: ['2026-09-17'], delivery_blocked_dates: ['2026-09-18'], pickup_blocked_dates: ['2026-09-19'], nonproduction_dates: ['2026-09-21'] };
  const delivery = customerCalendarModel({ now, method: 'delivery', settings });
  for (const date of ['2026-09-14', '2026-09-15', '2026-09-17', '2026-09-18']) assert.ok(day(delivery, date).reason, date);
  assert.equal(day(delivery, '2026-09-19').reason, '');
  assert.equal(day(delivery, '2026-09-21').reason, '', 'Nonproduction dates affect preparation lead time, not fulfillment availability');
  const pickup = customerCalendarModel({ now, method: 'pickup', settings });
  assert.equal(day(pickup, '2026-09-18').reason, '');
  assert.ok(day(pickup, '2026-09-19').reason);
  const weekdays = customerCalendarModel({ now, settings: { fulfillment_weekdays: [1, 2, 3, 4, 5] } });
  assert.ok(day(weekdays, '2026-09-19').reason);
  assert.equal(day(weekdays, '2026-09-21').reason, '');
});

test('arrow and page keys skip closures and never reach earlier or later months outside the window', () => {
  assert.equal(customerCalendarKeyTarget('2026-09-16', 'ArrowLeft', {}, 'pickup', now), '2026-09-16');
  assert.equal(customerCalendarKeyTarget('2026-11-30', 'ArrowRight', {}, 'pickup', now), '2026-11-30');
  assert.equal(customerCalendarKeyTarget('2026-09-16', 'PageUp', {}, 'pickup', now, true), '2026-09-16');
  assert.equal(customerCalendarKeyTarget('2026-10-31', 'PageDown', {}, 'pickup', now), '2026-11-30');
  assert.equal(customerCalendarKeyTarget('2026-10-01', 'ArrowLeft', {}, 'pickup', now), '2026-09-30');
  assert.equal(customerCalendarKeyTarget('2026-09-16', 'ArrowRight', { blocked_dates: ['2026-09-17', '2026-09-18'] }, 'pickup', now), '2026-09-19');
  assert.equal(customerCalendarKeyTarget('2026-09-16', 'ArrowRight', { delivery_blocked_dates: ['2026-09-17'] }, 'delivery', now), '2026-09-18');
  assert.equal(customerCalendarKeyTarget('2026-09-16', 'Enter', {}, 'pickup', now), null);
  assert.equal(customerCalendarKeyTarget('2026-09-16', 'ArrowRight', { fulfillment_weekdays: [] }, 'pickup', now), null);
});

test('the customer grid exposes accessible selection and genuinely disabled controls', () => {
  const markup = customerCalendarView(customerCalendarModel({ now, value: '2026-09-20' }));
  assert.match(markup, /data-customer-month="-1"[^>]*disabled/);
  assert.match(markup, /data-customer-date="2026-09-14"[^>]*disabled[^>]*tabindex="-1"/);
  assert.match(markup, /data-customer-date="2026-09-20"[^>]*aria-pressed="true"[^>]*tabindex="0"/);
  assert.match(markup, /aria-live="polite">September 2026/);
  assert.match(markup, /Book through 30 November 2026/);
  assert.equal((markup.match(/tabindex="0"/g) || []).length, 1);
  assert.doesNotMatch(markup, /type="date"/);
  const last = customerCalendarView(customerCalendarModel({ now, month: '2026-11' }));
  assert.match(last, /data-customer-month="1"[^>]*disabled/);
});

test('all-closed months have no selectable tab stop and explain why no day can be chosen', () => {
  const model = customerCalendarModel({ now, settings: { fulfillment_weekdays: [] } });
  assert.equal(model.focusDate, '');
  const markup = customerCalendarView(model);
  assert.match(markup, /No dates are available in this month/);
  assert.doesNotMatch(markup, /tabindex="0"/);
  assert.equal(model.nextDisabled, false, 'The customer can still browse the next allowed month');
});

test('a calendar left open across a Manila month boundary clamps its month and rejects yesterday’s selection', () => {
  const before = new Date('2026-09-30T15:59:59Z');
  const after = new Date('2026-09-30T16:00:00Z');
  const initial = customerCalendarModel({ now: before, value: '2026-10-01' });
  assert.equal(initial.selectionIssue, '');
  const refreshed = customerCalendarModel({ now: after, month: '2026-09', value: '2026-10-01' });
  assert.equal(refreshed.month, '2026-10');
  assert.equal(refreshed.previousDisabled, true);
  assert.equal(refreshed.maxMonth, '2026-12');
  assert.ok(refreshed.selectionIssue);
  assert.ok(day(refreshed, '2026-10-01').reason);
  assert.equal(refreshed.focusDate, '2026-10-02');
});
