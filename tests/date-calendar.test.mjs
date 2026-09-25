import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDates, calendarKeyDate, calendarMonthDays, dateCalendar, isCalendarDate, shiftCalendarMonth, toggleCalendarDate } from '../assets/ordering/date-calendar.js';

test('civil dates validate leap days without rolling invalid dates into another month', () => {
  for (const date of ['2024-02-29', '2026-09-15', '2026-12-31']) assert.equal(isCalendarDate(date), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-9-15', '2026-09-15T00:00:00Z', '', null]) assert.equal(isCalendarDate(date), false);
});

test('multi-select values preserve past and future dates and toggle one date at a time', () => {
  const selected = ['2027-01-05', '2024-02-29', '2026-09-15', '2026-09-15'];
  assert.deepEqual(calendarDates(selected), ['2024-02-29', '2026-09-15', '2027-01-05']);
  assert.deepEqual(calendarDates('2027-01-05\r\n2024-02-29\n'), ['2024-02-29', '2027-01-05']);
  const removed = toggleCalendarDate(selected, '2026-09-15');
  assert.deepEqual(removed, ['2024-02-29', '2027-01-05']);
  assert.deepEqual(toggleCalendarDate(removed, '2026-09-15'), calendarDates(selected));
  assert.throws(() => toggleCalendarDate(selected, '2026-02-29'), /Invalid calendar date/);
});

test('month grids align Sunday through Saturday, including leap months and six-week months', () => {
  const leap = calendarMonthDays('2024-02');
  assert.equal(leap.length % 7, 0);
  assert.deepEqual(leap.slice(0, 5), [null, null, null, null, '2024-02-01']);
  assert.equal(leap.filter(Boolean).length, 29);
  assert.equal(calendarMonthDays('2026-02').filter(Boolean).length, 28);
  const sixWeeks = calendarMonthDays('2026-08');
  assert.equal(sixWeeks.length, 42);
  assert.equal(sixWeeks[6], '2026-08-01');
  assert.equal(sixWeeks[36], '2026-08-31');
});

test('month navigation crosses years and remains independent of local time zone', () => {
  const previousTZ = process.env.TZ;
  try {
    for (const zone of ['Asia/Manila', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      assert.equal(shiftCalendarMonth('2026-12', 1), '2027-01');
      assert.equal(shiftCalendarMonth('2026-01', -1), '2025-12');
      assert.equal(calendarMonthDays('2026-03').filter(Boolean)[0], '2026-03-01');
      assert.equal(calendarKeyDate('2026-03-08', 'ArrowRight'), '2026-03-09');
    }
  } finally {
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});

test('keyboard navigation handles month edges and clamps Page Up/Down to the target month', () => {
  assert.equal(calendarKeyDate('2026-01-01', 'ArrowLeft'), '2025-12-31');
  assert.equal(calendarKeyDate('2026-01-01', 'ArrowUp'), '2025-12-25');
  assert.equal(calendarKeyDate('2026-09-15', 'Home'), '2026-09-13');
  assert.equal(calendarKeyDate('2026-09-15', 'End'), '2026-09-19');
  assert.equal(calendarKeyDate('2026-01-31', 'PageDown'), '2026-02-28');
  assert.equal(calendarKeyDate('2024-02-29', 'PageDown', true), '2025-02-28');
  assert.equal(calendarKeyDate('2026-03-31', 'PageUp'), '2026-02-28');
  assert.equal(calendarKeyDate('2026-09-15', 'Enter'), null, 'Native button activation handles selection');
});

test('calendar markup retains all saved dates, identifies selected days and escapes descriptions', () => {
  const markup = dateCalendar('blocked_dates', '<Closed>', ['2025-12-25', '2026-09-15', '2027-01-01'], '<b>Existing bookings remain.</b>', '2026-09-15');
  assert.match(markup, /<textarea name="blocked_dates" hidden>2025-12-25\n2026-09-15\n2027-01-01<\/textarea>/);
  assert.match(markup, /data-calendar-date="2026-09-15"[^>]*aria-pressed="true"[^>]*aria-current="date"[^>]*tabindex="0"/);
  assert.match(markup, /data-calendar-remove="2025-12-25"/);
  assert.match(markup, /data-calendar-remove="2027-01-01"/);
  assert.match(markup, /&lt;Closed&gt;/);
  assert.match(markup, /&lt;b&gt;Existing bookings remain\.&lt;\/b&gt;/);
  assert.doesNotMatch(markup, /<b>/);
  assert.equal((markup.match(/tabindex="0"/g) || []).length, 1, 'One date is in the tab sequence');
  const readonly = dateCalendar('delivery_blocked_dates', 'Delivery closures', ['2026-09-15'], '', '2026-09-15', true);
  assert.match(readonly, /data-calendar-date="2026-09-15"[^>]*disabled/);
  assert.match(readonly, /data-calendar-remove="2026-09-15"[^>]*disabled/);
});

test('closure calendars keep all saved exceptions without rendering a growing date list', () => {
  const dates = Array.from({ length: 120 }, (_, index) => `${shiftCalendarMonth('2026-09', index)}-15`);
  for (const name of ['blocked_dates', 'delivery_blocked_dates', 'nonproduction_dates']) {
    const markup = dateCalendar(name, 'Schedule', dates, '', '2026-09-15', false, { mode: 'closures' });
    assert.match(markup, /calendar-closures/);
    assert.doesNotMatch(markup, /calendar-selection|calendar-date-list|data-calendar-remove/);
    assert.match(markup, new RegExp(dates.at(-1)), 'Distant closures are preserved in the saved field');
    assert.match(markup, /data-calendar-date="2026-09-15"[^>]*aria-pressed="true"/);
    assert.equal((markup.match(/data-calendar-date=/g) || []).length, 30, 'Only the displayed month creates date buttons');
    assert.match(markup, name === 'nonproduction_dates' ? /Crossed out = no production/ : /Crossed out = closed/);
  }
});
