const count = value => new Intl.NumberFormat('en-PH').format(value);

function validReport(report) {
  if (report?.status === 'not_configured') return { status: 'not_configured' };
  if (report?.status !== 'ready' || ![report.visitorsToday, report.activeLast30Minutes].every(value => Number.isSafeInteger(value) && value >= 0) ||
      typeof report.timeZone !== 'string' || !Number.isFinite(Date.parse(report.updatedAt))) {
    throw new Error('Invalid traffic report.');
  }
  // A timezone supplied by Google is used for the daily date boundary and label.
  new Intl.DateTimeFormat('en-PH', { timeZone: report.timeZone }).format();
  return { status: 'ready', visitorsToday: report.visitorsToday, activeLast30Minutes: report.activeLast30Minutes, timeZone: report.timeZone, updatedAt: report.updatedAt };
}

// The dashboard refreshes only this region, preserving date filters and focus.
export function renderWebsiteVisitors(traffic = { status: 'idle' }, escapeHtml) {
  const esc = escapeHtml;
  const ready = traffic.status === 'ready';
  const card = (key, title, value, note) => `<article class="traffic-card"><h3>${esc(title)}</h3><div class="metric-value" data-traffic-metric="${key}">${ready ? count(value) : '—'}</div><p class="metric-note">${esc(note)}</p></article>`;
  let status = 'Open Analytics while signed in to load website visitors.';
  if (traffic.status === 'loading') status = 'Loading website visitors…';
  if (traffic.status === 'not_configured') status = 'Connect Google Analytics reporting to display visitor counts here. Website tracking continues while this connection is being set up.';
  if (traffic.status === 'error') status = 'Visitor counts are temporarily unavailable. Try Refresh analytics, or open Google Analytics below. This does not affect ordering.';
  if (ready) {
    const updated = new Intl.DateTimeFormat('en-PH', { timeZone: traffic.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(traffic.updatedAt));
    status = `${traffic.refreshing ? 'Refreshing… Last received' : 'Last received'} ${updated} (${traffic.timeZone}). Refreshes every minute while this page is open.`;
  }
  return `<div class="section-heading"><h2>Website visitors</h2><span class="badge">Whole website</span></div>
    <p class="muted">Visitors across the website’s tracked pages, counted once within each reporting period. These figures are independent of the order date filter.</p>
    <div class="traffic-metrics">${card('today', 'Visitors today', traffic.visitorsToday, ready ? `Unique visitors today · ${traffic.timeZone}` : 'Unique visitors today · Google Analytics timezone')}${card('realtime', 'Active visitors · last 30 minutes', traffic.activeLast30Minutes, 'Recent activity across the website')}</div>
    <p class="analytics-updated" role="status">${esc(status)}</p>
    <p class="help-text">Today’s total can take longer to process than Realtime. Google Analytics may miss visits blocked by browsers and may count one person on different devices separately.</p>
    <div class="row-actions"><a class="button button-secondary" href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer">Open Google Analytics ↗</a>${traffic.status === 'not_configured' ? '<a class="button button-quiet" href="docs/TRAFFIC.md#connect-the-visitor-cards" target="_blank" rel="noopener">Connection guide ↗</a>' : ''}</div>`;
}

export function createVisitorPoller({ fetchReport, onChange, schedule = setTimeout, cancel = clearTimeout, interval = 60_000 }) {
  let active = false;
  let timer = null;
  let pending = null;
  let controller = null;
  let generation = 0;
  let state = { status: 'idle' };
  const emit = next => { state = next; onChange({ ...next }); };
  const clearTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  function refresh() {
    if (!active) return Promise.resolve();
    if (pending) return pending;
    clearTimer();
    const current = generation;
    controller = new AbortController();
    const signal = controller.signal;
    emit(state.status === 'ready' ? { ...state, refreshing: true } : { status: 'loading' });
    pending = Promise.resolve().then(() => fetchReport({ signal })).then(report => {
      if (active && current === generation) emit(validReport(report));
    }).catch(() => {
      // An unavailable report must never masquerade as zero visitors.
      if (active && current === generation) emit({ status: 'error' });
    }).finally(() => {
      if (current !== generation) return;
      pending = null;
      controller = null;
      if (active) timer = schedule(refresh, interval);
    });
    return pending;
  }
  function setActive(next) {
    if (active === Boolean(next)) return pending || Promise.resolve();
    active = Boolean(next);
    clearTimer();
    if (active) return refresh();
    generation++;
    controller?.abort();
    controller = null;
    pending = null;
    return Promise.resolve();
  }
  return {
    refresh,
    setActive,
    reset() { setActive(false); emit({ status: 'idle' }); },
  };
}
