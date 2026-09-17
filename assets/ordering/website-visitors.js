const count = value => new Intl.NumberFormat('en-PH').format(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const reportStatuses = new Set(['ready', 'partial', 'unavailable']);
const issueMessages = Object.freeze({
  report_pending: 'Google has not returned this visitor count yet. It will be checked again automatically.',
  metric_mismatch: 'Google returned an unexpected visitor metric. Please try again shortly.',
  restricted: 'Google has restricted access to this visitor count.',
  withheld: 'Google has withheld this visitor count to protect visitor privacy.',
  unexpected_report: 'Google returned an incomplete visitor report. Please try again shortly.',
  network: 'The reporting connection is temporarily unavailable. Please try again shortly.',
  access: 'Check the Google reporting connection’s property ID, Viewer access and enabled Data API.',
  busy: 'Google reporting is busy. Please wait a minute before refreshing.',
  day_changed: 'A new day started while this report loaded. Please refresh analytics.',
});

function validReport(report) {
  if (report?.status === 'not_configured') return { status: 'not_configured' };
  const invalid = () => { throw new Error('Invalid traffic report.'); };
  if (!reportStatuses.has(report?.status) || typeof report.updatedAt !== 'string' || !Number.isFinite(Date.parse(report.updatedAt))) invalid();
  const today = isCount(report.visitorsToday), realtime = isCount(report.activeLast30Minutes);
  if ((!today && report.visitorsToday !== null) || (!realtime && report.activeLast30Minutes !== null)) invalid();
  const available = Number(today) + Number(realtime);
  if (available !== { ready: 2, partial: 1, unavailable: 0 }[report.status]) invalid();
  // The daily boundary must come from Google; realtime can use browser time.
  if (report.timeZone === null) {
    if (today) invalid();
  } else {
    if (typeof report.timeZone !== 'string' || !report.timeZone) invalid();
    new Intl.DateTimeFormat('en-PH', { timeZone: report.timeZone }).format();
  }
  const issues = {};
  for (const [key, present] of [['today', today], ['realtime', realtime]]) {
    const issue = report.issues?.[key];
    if (present ? issue !== undefined : typeof issue !== 'string' || !Object.hasOwn(issueMessages, issue)) invalid();
    if (!present) issues[key] = issue;
  }
  return { status: report.status, visitorsToday: report.visitorsToday, activeLast30Minutes: report.activeLast30Minutes, timeZone: report.timeZone, updatedAt: report.updatedAt, ...(available < 2 ? { issues } : {}) };
}

// The dashboard refreshes only this region, preserving date filters and focus.
export function renderWebsiteVisitors(traffic = { status: 'idle' }, escapeHtml) {
  const esc = escapeHtml;
  const received = reportStatuses.has(traffic.status);
  const card = (key, title, value, note) => {
    const available = received && isCount(value);
    const issue = traffic.issues?.[key];
    const message = received && !available ? (typeof issue === 'string' && Object.hasOwn(issueMessages, issue) ? issueMessages[issue] : 'This visitor count is temporarily unavailable.') : '';
    return `<article class="traffic-card"><h3>${esc(title)}</h3><div class="metric-value" data-traffic-metric="${key}">${available ? count(value) : '—'}</div><p class="metric-note">${esc(note)}</p>${message ? `<p class="help-text" data-traffic-issue="${key}">${esc(message)}</p>` : ''}</article>`;
  };
  let status = 'Open Analytics while signed in to load website visitors.';
  if (traffic.status === 'loading') status = 'Loading website visitors…';
  if (traffic.status === 'not_configured') status = 'Connect Google Analytics reporting to display visitor counts here. Website tracking continues while this connection is being set up.';
  if (traffic.status === 'error') status = 'Visitor counts are temporarily unavailable. Try Refresh analytics, or open Google Analytics below. This does not affect ordering.';
  if (received) {
    const updated = new Intl.DateTimeFormat('en-PH', { ...(traffic.timeZone ? { timeZone: traffic.timeZone } : {}), dateStyle: 'medium', timeStyle: 'short' }).format(new Date(traffic.updatedAt));
    const label = traffic.status === 'ready' ? 'Last received' : 'Last checked';
    status = `${traffic.refreshing ? 'Refreshing… ' : ''}${label} ${updated} (${traffic.timeZone || 'your browser time'}). Refreshes every minute while this page is open.`;
  }
  return `<div class="section-heading"><h2>Website visitors</h2><span class="badge">Whole website</span></div>
    <p class="muted">Visitors across the website’s tracked pages, counted once within each reporting period. These figures are independent of the order date filter.</p>
    <div class="traffic-metrics">${card('today', 'Visitors today', traffic.visitorsToday, received && traffic.timeZone ? `Unique visitors today · ${traffic.timeZone}` : 'Unique visitors today · Google Analytics timezone')}${card('realtime', 'Active visitors · last 30 minutes', traffic.activeLast30Minutes, 'Recent activity across the website')}</div>
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
    emit(['ready', 'partial'].includes(state.status) ? { ...state, refreshing: true } : { status: 'loading' });
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
