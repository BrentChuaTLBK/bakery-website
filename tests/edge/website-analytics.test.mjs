import test from 'node:test';
import assert from 'node:assert/strict';

const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----\n`;
const account = { type: 'service_account', client_email: 'test@analytics-test.iam.gserviceaccount.com', private_key: pem, private_key_id: 'test-key', token_uri: 'https://untrusted.invalid/never-call' };
const baseEnv = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-backend-key', SUPABASE_ANON_KEY: 'public-test-key', ALLOWED_ORIGINS: 'https://thelittlebakerkitchen.com', GA_PROPERTY_ID: '123456789', GA_SERVICE_ACCOUNT_JSON: JSON.stringify(account) };
const environment = { ...baseEnv };
let endpoint;
globalThis.Deno = { env: { get: key => environment[key] }, serve: handler => { endpoint = handler; } };
const { createReporter } = await import('../../supabase/functions/website-analytics/reporting.ts');
await import('../../supabase/functions/website-analytics/index.ts');
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const daily = (count = '18') => ({ metricHeaders: [{ name: 'totalUsers', type: 'TYPE_INTEGER' }], rows: [{ metricValues: [{ value: count }] }], rowCount: 1, metadata: { timeZone: 'Asia/Manila' } });
const realtime = (count = '3') => ({ metricHeaders: [{ name: 'activeUsers', type: 'TYPE_INTEGER' }], rows: [{ metricValues: [{ value: count }] }], rowCount: 1 });
const tokenReply = () => reply({ access_token: 'private-google-token', token_type: 'Bearer', expires_in: 3600 });
function setup(overrides = {}) {
  const environment = { ...baseEnv, ...overrides };
  let currentTime = Date.parse('2026-09-17T08:00:00Z');
  const calls = [];
  let provider = async (url) => url.includes('oauth2.') ? tokenReply() : url.endsWith(':runReport') ? reply(daily()) : reply(realtime());
  const report = createReporter({ getEnv: key => environment[key] || '', now: () => currentTime,
    fetch: async (url, options) => { calls.push({ url, options }); return provider(url, options); },
  });
  return { report, environment, calls, advance: ms => { currentTime += ms; }, setTime: value => { currentTime = Date.parse(value); }, setProvider: fn => { provider = fn; } };
}

test('reports deduplicated whole-property users with a signed read-only Google assertion', async () => {
  const h = setup();
  const result = await h.report();
  assert.deepEqual(result, { status: 'ready', visitorsToday: 18, activeLast30Minutes: 3, timeZone: 'Asia/Manila', updatedAt: '2026-09-17T08:00:00.000Z' });
  assert.equal(h.calls.length, 3);
  const oauth = h.calls.find(c => c.url.includes('oauth2.'));
  assert.equal(oauth.url, 'https://oauth2.googleapis.com/token');
  assert.equal(oauth.options.redirect, 'error');
  assert.ok(oauth.options.signal instanceof AbortSignal);
  const form = new URLSearchParams(oauth.options.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header, claims, signature] = form.get('assertion').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  const payload = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/analytics.readonly');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(payload.iss, account.client_email);
  assert.equal(payload.sub, undefined);
  assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${claims}`)));
  const reports = h.calls.filter(c => c.url.includes('analyticsdata.'));
  assert.deepEqual(JSON.parse(reports[0].options.body), { dateRanges: [{ startDate: 'today', endDate: 'today' }], metrics: [{ name: 'totalUsers' }] });
  assert.deepEqual(JSON.parse(reports[1].options.body), { metrics: [{ name: 'activeUsers' }] });
  for (const call of reports) assert.equal(call.options.headers.Authorization, 'Bearer private-google-token');
  assert.doesNotMatch(JSON.stringify(result), /private-|service_account|123456789/);
});

test('a single Google dateRange label preserves the whole-property count', async () => {
  const withPeriod = report => ({ ...report, dimensionHeaders: [{ name: 'dateRange' }],
    rows: report.rows.map(row => ({ ...row, dimensionValues: [{ value: 'date_range_0' }] })) });
  for (const [dailyPeriod, realtimePeriod] of [[true, false], [false, true], [true, true]]) {
    const h = setup();
    h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply(url.endsWith(':runReport')
      ? dailyPeriod ? withPeriod(daily()) : daily()
      : realtimePeriod ? withPeriod(realtime()) : realtime()));
    const result = await h.report();
    assert.equal(result.visitorsToday, 18);
    assert.equal(result.activeLast30Minutes, 3);
  }
});

test('unexpected periods or visitor breakdowns cannot be mistaken for a whole-property total', async () => {
  const row = { ...realtime().rows[0], dimensionValues: [{ value: 'date_range_0' }] };
  const period = { ...realtime(), dimensionHeaders: [{ name: 'dateRange' }], rows: [row] };
  for (const broken of [
    { ...period, dimensionHeaders: [{ name: 'pagePath' }] },
    { ...period, dimensionHeaders: [{ name: 'dateRange' }, { name: 'country' }] },
    { ...period, rows: [{ ...row, dimensionValues: [{ value: 'date_range_1' }] }] },
    { ...period, rows: [{ ...row, dimensionValues: [{ value: 'RESERVED_TOTAL' }] }] },
    { ...period, rows: [{ ...row, dimensionValues: [] }] },
    { ...period, rows: [row, row], rowCount: 2 },
    { ...period, dimensionHeaders: [] },
  ]) {
    const h = setup();
    h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply(url.endsWith(':runReport') ? daily() : broken));
    const result = await h.report();
    assert.equal(result.status, 'partial');
    assert.equal(result.visitorsToday, 18);
    assert.equal(result.activeLast30Minutes, null);
    assert.equal(result.issues.realtime, 'unexpected_report');
  }
});

test('report validation identifies the failing report without exposing provider contents', async () => {
  for (const [reportType, broken, expected] of [
    ['daily', { ...daily(), metadata: { timeZone: 'Asia/Manila', emptyReason: 'PRIVATE_PROVIDER_REASON' } }, 'report_pending'],
    ['daily', { ...daily(), metadata: { timeZone: 'Asia/Manila', schemaRestrictionResponse: { activeMetricRestrictions: [{ metricName: 'PRIVATE_METRIC' }] } } }, 'restricted'],
    ['realtime', { ...realtime(), metricHeaders: [{ name: 'PRIVATE_METRIC' }] }, 'metric_mismatch'],
    ['realtime', { ...realtime(), dimensionHeaders: [{ name: 'PRIVATE_DIMENSION' }] }, 'unexpected_report'],
  ]) {
    const h = setup();
    h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply(url.endsWith(':runReport')
      ? reportType === 'daily' ? broken : daily()
      : reportType === 'realtime' ? broken : realtime()));
    const result = await h.report();
    assert.equal(result.status, 'partial');
    assert.equal(result.issues[reportType === 'daily' ? 'today' : 'realtime'], expected);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  }
});

test('concurrent reads share a report, 60-second refreshes reuse OAuth, expired OAuth is renewed', async () => {
  const h = setup();
  const [one, two] = await Promise.all([h.report(), h.report()]);
  assert.deepEqual(one, two); assert.equal(h.calls.length, 3);
  h.advance(59_999); assert.deepEqual(await h.report(), one); assert.equal(h.calls.length, 3);
  h.advance(1); await h.report(); assert.equal(h.calls.length, 5);
  h.advance(3600_000); await h.report(); assert.equal(h.calls.length, 8);
});

test('today cache is invalidated at the Google property midnight', async () => {
  const h = setup();
  h.setTime('2026-09-17T15:59:50Z'); await h.report();
  h.advance(15_000); await h.report();
  assert.equal(h.calls.length, 5);
});

test('an in-flight report crossing the property midnight is retried instead of caching yesterday as today', async () => {
  const h = setup();
  h.setTime('2026-09-17T15:59:59Z');
  h.setProvider(async url => {
    if (url.includes('oauth2.')) return tokenReply();
    if (url.endsWith(':runReport')) { h.advance(2_000); return reply(daily()); }
    return reply(realtime());
  });
  const first = await h.report();
  assert.equal(first.status, 'partial');
  assert.equal(first.visitorsToday, null);
  assert.equal(first.issues.today, 'day_changed');
  assert.equal(first.activeLast30Minutes, 3);
  assert.equal((await h.report()).status, 'ready');
  assert.equal(h.calls.length, 5);
});

test('missing configuration is explicit, invalid property IDs cannot become request URLs', async () => {
  const absent = setup({ GA_PROPERTY_ID: '' });
  assert.deepEqual(await absent.report(), { status: 'not_configured' }); assert.equal(absent.calls.length, 0);
  for (const id of ['G-108BDB1XQ0', '../../other', 'https://untrusted.invalid', '0']) {
    const h = setup({ GA_PROPERTY_ID: id });
    await assert.rejects(h.report(), { status: 503 }); assert.equal(h.calls.length, 0);
  }
});

test('a slower realtime request crossing midnight cannot cause yesterday to be cached as today', async () => {
  const h = setup();
  h.setTime('2026-09-17T15:59:59Z');
  h.setProvider(async url => {
    if (url.includes('oauth2.')) return tokenReply();
    if (url.endsWith(':runReport')) return reply(daily());
    // Let the daily fetch and JSON parsing finish before Realtime returns.
    await new Promise(resolve => setImmediate(resolve));
    h.advance(2_000);
    return reply(realtime());
  });
  const result = await h.report();
  assert.equal(result.status, 'partial');
  assert.equal(result.visitorsToday, null);
  assert.equal(result.activeLast30Minutes, 3);
  assert.equal(result.issues.today, 'day_changed');
  assert.equal((await h.report()).status, 'ready');
  assert.equal(h.calls.length, 5);
});

test('valid empty reports return zero; malformed or withheld reports never masquerade as zero', async () => {
  const h = setup();
  h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply(url.endsWith(':runReport')
    ? { metricHeaders: [{ name: 'totalUsers' }], metadata: { timeZone: 'Asia/Manila' } }
    : { metricHeaders: [{ name: 'activeUsers' }], rowCount: 0, rows: [] }));
  const result = await h.report(); assert.equal(result.visitorsToday, 0); assert.equal(result.activeLast30Minutes, 0);
  for (const broken of [ {}, daily('-1'), daily('12people'), daily('9007199254740992'), { ...daily(), metadata: {} },
    { ...daily(), rows: [], rowCount: 0, metadata: { timeZone: 'Asia/Manila', subjectToThresholding: true } },
    { ...daily(), metadata: { timeZone: 'Asia/Manila', emptyReason: 'Data unavailable' } },
    { ...daily(), rowCount: 2, rows: [daily().rows[0], daily().rows[0]] } ]) {
    const fresh = setup();
    fresh.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply(url.endsWith(':runReport') ? broken : realtime()));
    const result = await fresh.report();
    assert.equal(result.status, 'partial');
    assert.equal(result.visitorsToday, null);
    assert.equal(result.activeLast30Minutes, 3);
    assert.ok(result.issues.today);
  }
});

test('provider failures are redacted and an available card survives while failed cards retry', async () => {
  const h = setup();
  h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : url.endsWith(':runReport') ? reply(daily()) : reply({ error: { message: 'private-key-secret-upstream' } }, 403));
  const partial = await h.report();
  assert.equal(partial.status, 'partial');
  assert.equal(partial.visitorsToday, 18);
  assert.equal(partial.activeLast30Minutes, null);
  assert.deepEqual(partial.issues, { realtime: 'access' });
  assert.doesNotMatch(JSON.stringify(partial), /private-/);
  h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : url.endsWith(':runReport') ? reply(daily('21')) : reply(realtime('5')));
  assert.equal((await h.report()).visitorsToday, 21);
  assert.equal(h.calls.length, 5);
  h.advance(60_000);
  h.setProvider(async () => { throw new Error('private-network-secret'); });
  const failed = await h.report();
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.visitorsToday, null);
  assert.equal(failed.activeLast30Minutes, null);
  assert.equal(failed.timeZone, null);
  assert.deepEqual(failed.issues, { today: 'network', realtime: 'network' });
  assert.doesNotMatch(JSON.stringify(failed), /private-/);
});

test('a headerless daily report stays unavailable and does not hide realtime or fabricate zero', async () => {
  for (const empty of [
    { metadata: { timeZone: 'Asia/Manila' } },
    { metricHeaders: [], rows: [], rowCount: 0, metadata: { timeZone: 'Asia/Manila' } },
  ]) {
    const h = setup();
    h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply(url.endsWith(':runReport') ? empty : realtime()));
    const result = await h.report();
    assert.deepEqual(result, { status: 'partial', visitorsToday: null, activeLast30Minutes: 3,
      timeZone: 'Asia/Manila', updatedAt: '2026-09-17T08:00:00.000Z', issues: { today: 'report_pending' } });
    h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply(url.endsWith(':runReport') ? daily('6') : realtime('2')));
    const recovered = await h.report();
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.visitorsToday, 6);
    assert.equal(recovered.activeLast30Minutes, 2);
    assert.equal(h.calls.length, 5, 'A partial response must not delay an explicit retry through caching');
  }
});

test('headers with a different metric or missing headers with data are not treated as pending or counted', async () => {
  for (const broken of [
    { ...daily(), metricHeaders: [{ name: 'activeUsers' }] },
    { ...daily(), metricHeaders: [] },
    { ...daily(), metricHeaders: undefined },
    { ...daily(), metricHeaders: { name: 'totalUsers' }, rows: [] },
  ]) {
    const h = setup();
    h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply(url.endsWith(':runReport') ? broken : realtime()));
    const result = await h.report();
    assert.equal(result.visitorsToday, null);
    assert.equal(result.activeLast30Minutes, 3);
    assert.equal(result.issues.today, 'metric_mismatch');
  }
});

test('a missing daily timezone cannot hide a valid realtime report', async () => {
  const h = setup();
  h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply(url.endsWith(':runReport') ? { ...daily(), metadata: {} } : realtime('0')));
  const result = await h.report();
  assert.equal(result.status, 'partial');
  assert.equal(result.visitorsToday, null);
  assert.equal(result.activeLast30Minutes, 0);
  assert.equal(result.timeZone, null);
  assert.deepEqual(result.issues, { today: 'unexpected_report' });
});

test('revoked OAuth is discarded, quota responses use a retry message, changed property clears caches', async () => {
  const h = setup(); await h.report();
  h.advance(60_000);
  h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply({ error: 'secret' }, 401));
  assert.deepEqual((await h.report()).issues, { today: 'access', realtime: 'access' });
  h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : reply({ error: 'secret' }, 429));
  assert.deepEqual((await h.report()).issues, { today: 'busy', realtime: 'busy' });
  assert.equal(h.calls.filter(c => c.url.includes('oauth2.')).length, 2);
  h.environment.GA_PROPERTY_ID = '987654321';
  h.setProvider(async url => url.includes('oauth2.') ? tokenReply() : url.endsWith(':runReport') ? reply(daily('7')) : reply(realtime('1')));
  assert.equal((await h.report()).visitorsToday, 7);
  assert.ok(h.calls.at(-1).url.includes('properties/987654321:'));
});

const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request = (token = 'staff-session', origin = 'https://thelittlebakerkitchen.com') => new Request('https://project.supabase.co/functions/v1/website-analytics', {
  method: 'POST', headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: '{}',
});
test('endpoint validates user and current staff membership before configuration or cached data', async () => {
  const calls = []; let staff = true;
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) {
      assert.equal(options.headers.Authorization, 'Bearer staff-session');
      return reply({ id: userId, user_metadata: { role: 'owner' } });
    }
    if (url.endsWith('/rpc/shop_service')) {
      assert.deepEqual(JSON.parse(options.body), { p_action: 'authorize_analytics', p_payload: { user_id: userId } });
      assert.equal(options.headers.Authorization, 'Bearer private-backend-key');
      return staff ? reply({ allowed: true }) : reply({ code: '42501', message: 'Authorized staff access required' }, 403);
    }
    return url.includes('oauth2.') ? tokenReply() : url.endsWith(':runReport') ? reply(daily()) : reply(realtime());
  };
  const missing = environment.GA_PROPERTY_ID; environment.GA_PROPERTY_ID = '';
  assert.deepEqual(await (await endpoint(request())).json(), { status: 'not_configured' });
  staff = false;
  assert.equal((await endpoint(request())).status, 403);
  environment.GA_PROPERTY_ID = missing; staff = true;
  assert.equal((await endpoint(request())).status, 200);
  const providerCalls = calls.filter(x => x.includes('googleapis.')).length;
  staff = false;
  assert.equal((await endpoint(request())).status, 403);
  assert.equal(calls.filter(x => x.includes('googleapis.')).length, providerCalls);
  staff = true;
  const result = await endpoint(request());
  assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls.filter(x => x.includes('googleapis.')).length, providerCalls);
});

test('anonymous keys and foreign origins never reach reporting, auth or staff lookup', async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
  for (const token of ['', 'public-test-key', 'sb_publishable_not_a_session']) assert.equal((await endpoint(request(token))).status, 401);
  assert.equal((await endpoint(request('staff-session', 'https://untrusted.invalid'))).status, 403);
});
