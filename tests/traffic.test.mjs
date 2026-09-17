import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/ordering/traffic.js', import.meta.url), 'utf8');
const origin = 'https://thelittlebakerkitchen.com';
const disabledKey = 'ga-disable-G-108BDB1XQ0';

function load({url = origin + '/shop.html', referrer = '', enabled = true, disabled = false} = {}) {
  const scripts = [], windowEvents = {}, documentEvents = {};
  const window = {location: {href: url}, [disabledKey]: disabled, addEventListener(name, fn) {windowEvents[name] = fn;}};
  const document = {
    currentScript: {dataset: {gaPageviewsEnabled: String(enabled)}}, referrer,
    head: {appendChild(script) {scripts.push(script);}},
    createElement(tag) {assert.equal(tag, 'script'); return {};},
    addEventListener(name, fn) {documentEvents[name] = fn;}
  };
  const context = vm.createContext({window, document, URL, Set});
  vm.runInContext(source, context);
  return {window, scripts, windowEvents, documentEvents, context, commands: () => (window.dataLayer || []).map(args => Array.from(args))};
}

test('explicitly disabling shop tracking prevents script loading and events', () => {
  const fixture = load({enabled: false});
  assert.deepEqual(fixture.scripts, []);
  assert.deepEqual(fixture.commands(), []);
});

test('published shop enables public traffic while private links remain excluded', () => {
  const html = readFileSync(new URL('../shop.html', import.meta.url), 'utf8');
  const flag = html.match(/traffic\.js[^>]*data-ga-pageviews-enabled="(true|false)"/)?.[1];
  assert.equal(flag, 'true');
  const enabled = flag === 'true';
  const publicPage = load({enabled});
  assert.equal(publicPage.scripts.length, 1);
  assert.equal(publicPage.commands().filter(command => command[0] === 'event' && command[1] === 'page_view').length, 1);
  const privatePage = load({enabled, url: origin + '/shop.html#order=private&token=secret'});
  assert.equal(privatePage.scripts.length, 0);
  assert.deepEqual(privatePage.commands(), []);
});

test('production page sends one sanitized pageview and suppresses automatic initial pageview', () => {
  const fixture = load({url: origin + '/shop.html?utm_source=instagram&utm_campaign=holiday', referrer: 'https://instagram.com/private-path?token=secret#details'});
  const commands = fixture.commands();
  assert.equal(fixture.scripts.length, 1);
  assert.equal(fixture.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-108BDB1XQ0');
  assert.equal(fixture.scripts[0].referrerPolicy, 'no-referrer');
  assert.equal(commands.filter(command => command[0] === 'event').length, 1);
  const config = commands.find(command => command[0] === 'config');
  assert.equal(config[1], 'G-108BDB1XQ0');
  assert.equal(config[2].send_page_view, false);
  const event = commands.find(command => command[0] === 'event');
  assert.equal(event[1], 'page_view');
  assert.equal(event[2].page_location, origin + '/shop.html');
  assert.equal(event[2].page_referrer, 'https://instagram.com/');
  assert.equal(event[2].allow_google_signals, false);
  assert.equal(event[2].allow_ad_personalization_signals, false);
  assert.doesNotMatch(JSON.stringify(commands), /holiday|secret|private-path|utm_|token=/);
  vm.runInContext(source, fixture.context);
  assert.equal(fixture.scripts.length, 1);
});

test('private order/auth links, demo URLs, previews and other pages never load analytics', () => {
  for (const url of [
    origin + '/shop.html#order=abc&token=secret', origin + '/shop.html?order=abc&token=secret',
    origin + '/shop.html?demo=1', origin + '/shop.html?email=buyer@example.com',
    origin + '/shop.html?code=auth-code', origin + '/account.html', origin + '/manage.html',
    origin + '/auth-callback.html', origin + '/orders/abc',
    'http://thelittlebakerkitchen.com/shop.html', 'http://localhost:4173/shop.html',
    'https://preview.example.com/shop.html', 'https://thelittlebakerkitchen.com.evil.test/shop.html'
  ]) {
    const fixture = load({url});
    assert.equal(fixture.scripts.length, 0, url);
    assert.equal(fixture.commands().length, 0, url);
  }
  assert.equal(load({url: 'https://www.thelittlebakerkitchen.com/shop.html'}).scripts.length, 1);
  assert.equal(load({disabled: true}).scripts.length, 0);
});

test('internal referrers reveal only known public pages and no query or fragment', () => {
  for (const referrer of [origin + '/manage.html?order=private', origin + '/account.html', origin + '/orders/private', origin + '/shop.html#order=private', 'javascript:secret', 'invalid']) {
    const event = load({referrer}).commands().find(command => command[0] === 'event');
    assert.equal(event[2].page_referrer, '', referrer);
  }
  const event = load({referrer: origin + '/index.html?email=private'}).commands().find(command => command[0] === 'event');
  assert.equal(event[2].page_referrer, origin + '/index.html');
});

test('order submission, form focus and navigation disable further collection permanently', () => {
  for (const name of ['hashchange', 'popstate', 'pagehide']) {
    const fixture = load();
    fixture.windowEvents[name]();
    assert.equal(fixture.window[disabledKey], true);
  }
  const submitting = load();
  submitting.documentEvents.submit();
  assert.equal(submitting.window[disabledKey], true);
  for (const [eventName, selector] of [['click', '#place-order'], ['focusin', 'form']]) {
    const fixture = load();
    fixture.documentEvents[eventName]({target: {closest: value => value === selector}});
    assert.equal(fixture.window[disabledKey], true);
  }
  const browsing = load();
  browsing.documentEvents.click({target: {closest: () => null}});
  assert.equal(browsing.window[disabledKey], false);
});
