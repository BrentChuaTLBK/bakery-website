import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWebsiteVisitors, createVisitorPoller } from '../assets/ordering/website-visitors.js';
import { renderAnalytics } from '../assets/ordering/analytics-view.js';

const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const report = { status: 'ready', visitorsToday: 1234, activeLast30Minutes: 12, timeZone: 'Asia/Manila', updatedAt: '2026-09-17T06:30:00.000Z' };
const realtimeOnly = { ...report, status: 'partial', visitorsToday: null, timeZone: null, issues: { today: 'report_pending' } };
const todayOnly = { ...report, status: 'partial', activeLast30Minutes: null, issues: { realtime: 'network' } };
const metric = (html, key) => html.match(new RegExp(`data-traffic-metric="${key}">([^<]*)`))?.[1];
function harness(fetchReport) {
  const changes = [], timers = new Map();
  let id = 0;
  const poller = createVisitorPoller({ fetchReport, onChange: state => changes.push(state), schedule: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, cancel: id => timers.delete(id) });
  return { poller, changes, timers, latest: () => changes.at(-1) };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('visitor cards label the whole website, timezone and rolling realtime window', () => {
  const html = renderWebsiteVisitors(report, esc);
  assert.equal(metric(html, 'today'), '1,234');
  assert.equal(metric(html, 'realtime'), '12');
  assert.match(html, /Whole website/);
  assert.match(html, /last 30 minutes/);
  assert.match(html, /Asia\/Manila/);
  assert.match(html, /independent of the order date filter/);
  assert.match(html, /take longer to process than Realtime/);
});

test('zero is shown only for a successful zero-count report', () => {
  for (const status of ['idle', 'loading', 'error', 'not_configured']) {
    const html = renderWebsiteVisitors({ status }, esc);
    assert.equal(metric(html, 'today'), '—');
    assert.equal(metric(html, 'realtime'), '—');
  }
  const html = renderWebsiteVisitors({ ...report, visitorsToday: 0, activeLast30Minutes: 0 }, esc);
  assert.equal(metric(html, 'today'), '0');
  assert.equal(metric(html, 'realtime'), '0');
});

test('a pending daily report preserves the realtime count and labels browser time accurately', async () => {
  const h = harness(() => realtimeOnly);
  await h.poller.setActive(true);
  assert.deepEqual(h.latest(), realtimeOnly);
  const html = renderWebsiteVisitors(h.latest(), esc);
  assert.equal(metric(html, 'today'), '—');
  assert.equal(metric(html, 'realtime'), '12');
  assert.match(html, /data-traffic-issue="today">Google has not returned this visitor count yet/);
  assert.doesNotMatch(html, /data-traffic-issue="realtime"/);
  assert.match(html, /your browser time/);
  assert.doesNotMatch(html, /Asia\/Manila/);
  h.poller.reset();
});

test('a failed realtime report preserves the daily count and its Google timezone', async () => {
  const h = harness(() => todayOnly);
  await h.poller.setActive(true);
  assert.deepEqual(h.latest(), todayOnly);
  const html = renderWebsiteVisitors(h.latest(), esc);
  assert.equal(metric(html, 'today'), '1,234');
  assert.equal(metric(html, 'realtime'), '—');
  assert.match(html, /data-traffic-issue="realtime">The reporting connection is temporarily unavailable/);
  assert.doesNotMatch(html, /data-traffic-issue="today"/);
  assert.match(html, /Asia\/Manila/);
  assert.doesNotMatch(html, /your browser time/);
  h.poller.reset();
});

test('two unavailable reports show their fixed explanations without invented zeroes', async () => {
  const unavailable = { ...realtimeOnly, status: 'unavailable', activeLast30Minutes: null, issues: { today: 'report_pending', realtime: 'busy' } };
  const h = harness(() => unavailable);
  await h.poller.setActive(true);
  assert.deepEqual(h.latest(), unavailable);
  const html = renderWebsiteVisitors(h.latest(), esc);
  assert.equal(metric(html, 'today'), '—');
  assert.equal(metric(html, 'realtime'), '—');
  assert.match(html, /has not returned this visitor count yet/);
  assert.match(html, /Google reporting is busy/);
  h.poller.reset();
});

test('a verified zero remains visible independently of the other unavailable report', async () => {
  const h = harness(() => ({ ...realtimeOnly, activeLast30Minutes: 0 }));
  await h.poller.setActive(true);
  const html = renderWebsiteVisitors(h.latest(), esc);
  assert.equal(metric(html, 'today'), '—');
  assert.equal(metric(html, 'realtime'), '0');
  h.poller.reset();
});

test('refreshing a partial report retains its available figure until the response arrives', async () => {
  let requests = 0;
  const pending = deferred();
  const h = harness(() => ++requests === 1 ? realtimeOnly : pending.promise);
  await h.poller.setActive(true);
  const refresh = h.poller.refresh();
  assert.deepEqual(h.latest(), { ...realtimeOnly, refreshing: true });
  const html = renderWebsiteVisitors(h.latest(), esc);
  assert.equal(metric(html, 'realtime'), '12');
  assert.match(html, /Refreshing/);
  pending.resolve(report);
  await refresh;
  assert.deepEqual(h.latest(), report);
  assert.equal(h.timers.size, 1);
  h.poller.reset();
});

test('inconsistent partial reports and arbitrary issue codes are rejected', async () => {
  for (const invalid of [
    { ...realtimeOnly, status: 'ready' },
    { ...realtimeOnly, status: 'unavailable' },
    { ...realtimeOnly, visitorsToday: 2 },
    { ...realtimeOnly, activeLast30Minutes: null },
    { ...realtimeOnly, issues: undefined },
    { ...realtimeOnly, issues: { realtime: 'network' } },
    { ...realtimeOnly, issues: { today: 'report_pending', realtime: 'network' } },
    { ...realtimeOnly, issues: { today: 'PRIVATE_PROVIDER_ERROR' } },
    { ...realtimeOnly, issues: { today: ['report_pending'] } },
    { ...realtimeOnly, issues: { today: 'toString' } },
    { ...todayOnly, timeZone: null },
    { ...realtimeOnly, timeZone: 'invalid-zone' },
    { ...realtimeOnly, timeZone: undefined },
    { ...report, issues: { today: 'report_pending' } },
    { ...realtimeOnly, updatedAt: 0 },
  ]) {
    const h = harness(() => invalid);
    await h.poller.setActive(true);
    assert.deepEqual(h.latest(), { status: 'error' });
    h.poller.reset();
  }
  const html = renderWebsiteVisitors({ ...realtimeOnly, issues: { today: '<script>PRIVATE_PROVIDER_ERROR</script>' } }, esc);
  assert.doesNotMatch(html, /PRIVATE_PROVIDER_ERROR|<script>/);
  assert.match(html, /This visitor count is temporarily unavailable/);
});

test('traffic totals stay fixed when the order period changes', () => {
  const helpers = { today: '2026-09-17', money: value => `PHP ${value}`, escapeHtml: esc, formatDate: value => value };
  const state = { orders: [], products: [], websiteTraffic: report };
  const today = renderAnalytics({ ...state, analyticsFilter: { period: 'today' } }, helpers);
  const all = renderAnalytics({ ...state, analyticsFilter: { period: 'all' } }, helpers);
  assert.equal(metric(today, 'today'), metric(all, 'today'));
  assert.equal(metric(today, 'realtime'), metric(all, 'realtime'));
  assert.ok(today.indexOf('id="website-visitors"') < today.indexOf('id="analytics-filters"'));
});

test('polling deduplicates refreshes and schedules one request per minute', async () => {
  let requests = 0;
  const pending = deferred();
  const h = harness(() => { requests++; return pending.promise; });
  const first = h.poller.setActive(true);
  const duplicate = h.poller.refresh();
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.equal(first, duplicate);
  assert.equal(h.latest().status, 'loading');
  pending.resolve(report);
  await first;
  assert.equal(h.latest().visitorsToday, 1234);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 60000);
  await h.poller.setActive(true);
  assert.equal(requests, 1, 'Re-rendering order filters must not trigger a new request');
  await h.poller.setActive(false);
  assert.equal(h.timers.size, 0);
});

test('leaving Analytics aborts the request and a late response cannot overwrite a newer one', async () => {
  const pending = deferred();
  let signal, requests = 0;
  const h = harness(options => { requests++; signal = options.signal; return requests === 1 ? pending.promise : { ...report, activeLast30Minutes: 20 }; });
  const first = h.poller.setActive(true);
  await Promise.resolve();
  const firstSignal = signal;
  await h.poller.setActive(false);
  assert.equal(firstSignal.aborted, true);
  await h.poller.setActive(true);
  pending.resolve(report);
  await first;
  assert.equal(h.latest().activeLast30Minutes, 20);
  assert.equal(h.timers.size, 1);
});

test('sign-out clears figures and blocks an outstanding response', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  const request = h.poller.setActive(true);
  h.poller.reset();
  pending.resolve(report);
  await request;
  assert.deepEqual(h.latest(), { status: 'idle' });
  assert.equal(h.timers.size, 0);
});

test('provider failure clears previous figures instead of presenting stale counts as live', async () => {
  let fail = false;
  const h = harness(() => { if (fail) throw new Error('PRIVATE_PROVIDER_ERROR'); return report; });
  await h.poller.setActive(true);
  fail = true;
  await h.poller.refresh();
  assert.deepEqual(h.latest(), { status: 'error' });
  const html = renderWebsiteVisitors(h.latest(), esc);
  assert.equal(metric(html, 'today'), '—');
  assert.doesNotMatch(html, /PRIVATE_PROVIDER_ERROR|1,234/);
});

test('invalid counts, missing dates and invalid timezones become unavailable', async () => {
  for (const invalid of [
    { ...report, visitorsToday: -1 }, { ...report, activeLast30Minutes: '12' },
    { ...report, visitorsToday: 1.2 }, { ...report, updatedAt: undefined },
    { ...report, timeZone: 'invalid-zone' }, {}, null,
  ]) {
    const h = harness(() => invalid);
    await h.poller.setActive(true);
    assert.deepEqual(h.latest(), { status: 'error' });
    h.poller.reset();
  }
});

test('missing Google connection has its own setup state and no invented counts', async () => {
  const h = harness(() => ({ status: 'not_configured' }));
  await h.poller.setActive(true);
  assert.deepEqual(h.latest(), { status: 'not_configured' });
  const html = renderWebsiteVisitors(h.latest(), esc);
  assert.match(html, /Connect Google Analytics reporting/);
  assert.match(html, /TRAFFIC.md#connect-the-visitor-cards/);
  assert.equal(metric(html, 'today'), '—');
});
