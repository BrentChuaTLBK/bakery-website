import test from 'node:test';
import assert from 'node:assert/strict';

const environment = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-service', ALLOWED_ORIGINS: 'https://thelittlebakerkitchen.com', RESEND_API_KEY: 'private-resend', EMAIL_FROM: 'TLB <orders@example.com>' };
let handler;
globalThis.Deno = { env: { get: key => environment[key] }, serve: value => { handler = value; } };
await import('../../supabase/functions/newsletter/index.ts');
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
const config = { topic_id: 'topic-newsletter', segment_id: 'segment-newsletter', site_url: 'https://thelittlebakerkitchen.com' };
const userId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const secret = 'a'.repeat(64);
function setup(services = {}, provider = () => reply({ id: 'contact-1', unsubscribed: false })) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });
    if (url.endsWith('/auth/v1/user')) return reply({ id: userId });
    if (url.endsWith('/rpc/newsletter_service')) {
      const value = services[body.p_action] ?? (body.p_action === 'configuration' ? config : {});
      return value instanceof Response ? value : reply(typeof value === 'function' ? value(body.p_payload) : value);
    }
    if (url.startsWith('https://api.resend.com/')) return provider(url, options, body);
    throw new Error(`Unexpected URL: ${url}`);
  };
  return calls;
}
const request = (body, authenticated = false, origin = 'https://thelittlebakerkitchen.com') => handler(new Request('https://project.supabase.co/functions/v1/newsletter', {
  method: 'POST', headers: { 'Content-Type': 'application/json', origin, ...(authenticated ? { Authorization: 'Bearer signed-user-token' } : {}) }, body: JSON.stringify(body),
}));
const rpcCalls = calls => calls.filter(x => x.url.endsWith('/rpc/newsletter_service'));
const providerCalls = calls => calls.filter(x => x.url.startsWith('https://api.resend.com/'));

test('capture sends a confirmation with a hashed token, no contact creation, and an idempotency key', async () => {
  const calls = setup({ request: { send: true, request_id: 'request-1' } }, url => reply(url.includes('/topics/') ? { id: config.topic_id, default_subscription: 'opt_out' } : { id: 'email-1' }));
  const response = await request({ action: 'subscribe', email: 'New+tlb@Example.com', source: 'shop_popup' });
  assert.equal(response.status, 200);
  const captured = rpcCalls(calls).find(x => x.body.p_action === 'request').body.p_payload;
  assert.equal(captured.email, 'new+tlb@example.com');
  assert.match(captured.token_hash, /^[0-9a-f]{64}$/);
  assert.match(captured.ip_hash, /^[0-9a-f]{64}$/);
  const sends = providerCalls(calls).filter(x => x.url.endsWith('/emails'));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].url, 'https://api.resend.com/emails');
  assert.equal(sends[0].options.headers['Idempotency-Key'], 'newsletter-confirm-request-1');
  const raw = sends[0].body.text.match(/#confirm=([a-f0-9]{64})/)[1];
  assert.notEqual(raw, captured.token_hash);
  assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('hex'), captured.token_hash);
  assert.doesNotMatch(await response.text(), /private-|[a-f0-9]{64}/);
});

test('sending-only key cannot send a confirmation that would fail during contact management', async () => {
  const calls = setup({ request: { send: true, request_id: 'request-2' } }, () => reply({ name: 'restricted_api_key' }, 401));
  assert.equal((await request({ action: 'subscribe', email: 'test@example.com' })).status, 503);
  assert.ok(!providerCalls(calls).some(x => x.url.endsWith('/emails')));
});

test('honeypot and throttled signup do not send mail and use generic success', async () => {
  let calls = setup();
  assert.equal((await request({ action: 'subscribe', website: 'bot' })).status, 200);
  assert.equal(calls.length, 0);
  calls = setup({ request: { send: false } });
  const response = await request({ action: 'subscribe', email: 'test@example.com' });
  assert.equal(response.status, 200);
  assert.equal(providerCalls(calls).length, 0);
});

test('origin, malformed email, unknown actions and unauthenticated account actions are rejected', async () => {
  const calls = setup();
  assert.equal((await request({ action: 'subscribe', email: 'x@example.com' }, false, 'https://evil.invalid')).status, 403);
  assert.equal((await request({ action: 'subscribe', email: 'bad@example.com\r\nBcc:x' })).status, 400);
  for (const action of ['status', 'popup_claim', 'popup_seen', 'unsubscribe']) assert.equal((await request({ action })).status, 401);
  assert.equal((await request({ action: 'anything' })).status, 400);
  assert.equal(providerCalls(calls).length, 0);
});

test('popup claims use the verified identity and do not expose internal status fields', async () => {
  const calls = setup({ popup_claim: { show: false, popup_seen: true }, status: { email: 'owner@example.com', status: 'none', popup_seen: true, contact_id: 'private-contact', revision: 9 } });
  assert.deepEqual(await (await request({ action: 'popup_claim', user_id: 'spoofed' }, true)).json(), { show: false, popup_seen: true });
  assert.equal(rpcCalls(calls)[0].body.p_payload.user_id, userId);
  assert.deepEqual(await (await request({ action: 'status' }, true)).json(), { email: 'owner@example.com', status: 'not_subscribed', popup_seen: true });
});

test('invalid and busy confirmation tokens never mutate a provider contact', async () => {
  for (const [state, status] of [[{ valid: false }, 410], [{ busy: true }, 409]]) {
    const calls = setup({ begin_confirm: state });
    assert.equal((await request({ action: 'confirm', token: secret })).status, status);
    assert.equal(providerCalls(calls).length, 0);
  }
  assert.equal((await request({ action: 'confirm', token: 'invalid' })).status, 400);
});

test('new confirmed contacts join only the newsletter segment and explicit topic', async () => {
  const calls = setup({ begin_confirm: { valid: true, email: 'test@example.com', operation_id: 'lease' }, finish_confirm: { status: 'subscribed' } }, (url, options) => options.method === 'GET' ? reply({}, 404) : reply({ id: 'new-contact' }));
  assert.equal((await request({ action: 'confirm', token: secret })).status, 200);
  const created = providerCalls(calls).find(x => x.options.method === 'POST');
  assert.deepEqual(created.body, { email: 'test@example.com', segments: [{ id: config.segment_id }], topics: [{ id: config.topic_id, subscription: 'opt_in' }] });
  const finished = rpcCalls(calls).find(x => x.body.p_action === 'finish_confirm').body.p_payload;
  assert.equal(finished.contact_id, 'new-contact');
  assert.equal(finished.operation_id, 'lease');
});

test('existing contact confirmation patches only newsletter topic and never global preferences', async () => {
  const calls = setup({ begin_confirm: { valid: true, email: 'test@example.com', operation_id: 'lease' }, finish_confirm: { status: 'subscribed' } });
  assert.equal((await request({ action: 'confirm', token: secret })).status, 200);
  const patches = providerCalls(calls).filter(x => x.options.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url, 'https://api.resend.com/contacts/contact-1/topics');
  assert.deepEqual(patches[0].body, [{ id: config.topic_id, subscription: 'opt_in' }]);
  assert.ok(providerCalls(calls).some(x => x.url.endsWith(`/segments/${config.segment_id}`)));
});

test('global opt-out is preserved with a useful error and a released unused lease', async () => {
  const calls = setup({ begin_confirm: { valid: true, email: 'test@example.com', operation_id: 'lease' } }, () => reply({ id: 'contact-1', unsubscribed: true }));
  const response = await request({ action: 'confirm', token: secret });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /opted out of all/);
  assert.equal(providerCalls(calls).length, 1);
  assert.ok(rpcCalls(calls).some(x => x.body.p_action === 'cancel_operation'));
  assert.ok(!rpcCalls(calls).some(x => x.body.p_action === 'finish_confirm'));
});

test('account unsubscribe opts out only the newsletter and preserves contact/global settings', async () => {
  const calls = setup({ begin_unsubscribe: { email: 'test@example.com', operation_id: 'lease' }, finish_unsubscribe: { status: 'unsubscribed' } });
  assert.deepEqual(await (await request({ action: 'unsubscribe', email: 'other@example.com' }, true)).json(), { ok: true, status: 'unsubscribed' });
  assert.deepEqual(rpcCalls(calls).find(x => x.body.p_action === 'begin_unsubscribe').body.p_payload, { user_id: userId });
  const patches = providerCalls(calls).filter(x => x.options.method !== 'GET');
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].body, [{ id: config.topic_id, subscription: 'opt_out' }]);
});

test('provider opt-out is reconciled into account preferences with a revision fence', async () => {
  const calls = setup({ status: { email: 'test@example.com', status: 'subscribed', revision: 4, popup_seen: true }, reconcile: { updated: true } }, url => url.includes('/topics') ? reply({ data: [{ id: config.topic_id, subscription: 'opt_out' }], has_more: false }) : reply({ id: 'contact-1', unsubscribed: false }));
  assert.equal((await (await request({ action: 'status' }, true)).json()).status, 'unsubscribed');
  assert.deepEqual(rpcCalls(calls).find(x => x.body.p_action === 'reconcile').body.p_payload, { email: 'test@example.com', status: 'unsubscribed', revision: 4 });
});

test('confirmation replay cannot opt a provider-unsubscribed address back in', async () => {
  const calls = setup({ begin_confirm: { valid: true, already_subscribed: true, email: 'test@example.com' } }, () => reply({ id: 'contact-1', unsubscribed: true }));
  assert.equal((await request({ action: 'confirm', token: secret })).status, 410);
  assert.ok(providerCalls(calls).every(x => x.options.method === 'GET'));
});

test('ambiguous provider failure keeps its lease and never reports successful confirmation', async () => {
  const calls = setup({ begin_confirm: { valid: true, email: 'test@example.com', operation_id: 'lease' } }, (url, options) => options.method === 'GET' ? reply({ id: 'contact-1', unsubscribed: false }) : reply({ error: 'private-provider-data' }, 500));
  const response = await request({ action: 'confirm', token: secret });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-provider/);
  assert.ok(!rpcCalls(calls).some(x => ['cancel_operation', 'finish_confirm'].includes(x.body.p_action)));
});

