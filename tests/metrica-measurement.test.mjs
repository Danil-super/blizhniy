import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { loadLocalPrimaryModule: load } = createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const { getMetricaTransport } = load('metrica-config');
const { handleMetricaMeasurement } = load('metrica-measurement');

const origin = 'https://fixture.example.invalid';
const token = '00000000-0000-4000-8000-000000000000';
const config = { origin, counterId: 987654321, token };
const granted = '__Host-blizhniy_analytics=v1.granted';
const visit = '__Host-blizhniy_analytics_visit=07b3ebf15caab89900538f1396f22d68';
const cookies = granted + '; ' + visit;
const view = { path: '/obyavlenie/card', referrer: '/specialist/card' };
const makeRequest = (data = view, headers = {}, path = '/api/analytics/pageview') => new Request(origin + path, {
  method: 'POST',
  headers: { host: 'fixture.example.invalid', origin, 'sec-fetch-site': 'same-origin', 'x-blizhniy-request': '1',
    'content-type': 'application/json', 'x-real-ip': '192.0.2.15', cookie: cookies, ...headers },
  body: JSON.stringify(data),
});

test('measurement mode is explicit and incomplete settings never fall back to the browser script', () => {
  assert.equal(getMetricaTransport({}), 'sdk');
  assert.equal(getMetricaTransport({ BLIZHNIY_YANDEX_METRICA_MODE: 'measurement-protocol',
    BLIZHNIY_YANDEX_METRICA_MEASUREMENT_TOKEN: token }), 'measurement-protocol');
  for (const env of [
    { BLIZHNIY_YANDEX_METRICA_MODE: 'measurement-protocol' },
    { BLIZHNIY_YANDEX_METRICA_MODE: 'measurement-protocol', BLIZHNIY_YANDEX_METRICA_MEASUREMENT_TOKEN: 'wrong' },
    { BLIZHNIY_YANDEX_METRICA_MODE: 'unknown' },
    { BLIZHNIY_YANDEX_METRICA_MEASUREMENT_TOKEN: token },
  ]) assert.equal(getMetricaTransport(env), null);
});

test('pageviews contain only a scoped pseudonym, aggregate path, filtered source and protocol fields', async () => {
  const sent = [];
  const send = async (url, init) => { sent.push([url, init]); return new Response('<!-- OK -->'); };
  const views = [makeRequest(), makeRequest({ path: '/poisk', referrer: 'https://www.google.com/' }), makeRequest(view, {
    cookie: granted + '; __Host-blizhniy_analytics_visit=66772a29c5c85de603c3a97e89b9e8d9',
  })];
  for (const request of views) {
    const result = await handleMetricaMeasurement(request, config, send);
    assert.equal(result.status, 204);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  const forms = sent.map(([url, init]) => {
    assert.equal(url, 'https://mc.yandex.ru/collect');
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers, undefined);
    assert.ok(init.signal instanceof AbortSignal);
    return Object.fromEntries(init.body);
  });
  assert.match(forms[0].cid, /^\d{1,19}$/);
  assert.equal(forms[1].cid, forms[0].cid);
  assert.notEqual(forms[2].cid, forms[0].cid);
  assert.deepEqual(forms[0], { tid: String(config.counterId), ms: token, t: 'pageview', cid: forms[0].cid,
    dl: origin + '/obyavlenie/card', dt: 'Ближний', dr: origin + '/specialist/card' });
  assert.equal(forms[1].dr, 'https://www.google.com/');
  assert.doesNotMatch(JSON.stringify(forms), /07b3ebf15caab89900538f1396f22d68/);
});

test('invalid consent, origins, payloads and private paths never contact the provider', async () => {
  const blocked = [
    [makeRequest(view, { cookie: visit }), 403],
    [makeRequest(view, { cookie: cookies + '; ' + granted }), 403],
    [makeRequest(view, { cookie: cookies.replace('granted', 'denied') }), 403],
    [makeRequest(view, { cookie: granted }), 403],
    [makeRequest(view, { origin: 'https://other.example.invalid' }), 403],
    [makeRequest(view, { 'x-real-ip': '' }), 403],
    [makeRequest(view, { host: 'other.example.invalid' }), 403],
    [makeRequest(view, { 'sec-fetch-site': 'same-site' }), 403],
    [makeRequest(view, { 'content-type': 'text/plain' }), 415],
    [makeRequest(view, {}, '/api/analytics/pageview?fixture=1'), 400],
    [makeRequest({ path: '/poisk', referrer: 'https://private-origin.example.invalid/' }), 400],
    [makeRequest({ path: '/poisk?q=fixture', referrer: '' }), 400],
    [makeRequest({ path: '/obyavlenie/fixture-record', referrer: '' }), 400],
    [makeRequest({ path: '/auth', referrer: '' }), 400],
    [makeRequest({ path: '/kabinet', referrer: '' }), 400],
    [makeRequest({ path: '/poisk', referrer: '/cabinet/private' }), 400],
    [makeRequest({ ...view, email: 'fixture@example.invalid' }), 400],
    [makeRequest({ path: 'x'.repeat(1000), referrer: '' }), 413],
  ];
  const sent = [];
  const send = async url => { sent.push(url); return new Response(''); };
  for (const [request, status] of blocked) {
    const response = await handleMetricaMeasurement(request, config, send);
    assert.equal(response.status, status);
    assert.equal(await response.text(), '');
  }
  assert.equal((await handleMetricaMeasurement(makeRequest(), null, send)).status, 404);
  assert.deepEqual(sent, []);
});

test('provider failures do not expose response payloads, diagnostics or exception text', async () => {
  for (const send of [
    async () => new Response('private remote error', { status: 400 }),
    async () => { throw new Error('private transport diagnostic'); },
  ]) {
    const response = await handleMetricaMeasurement(makeRequest(), config, send);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('collection has bounded concurrency and frees capacity after a transport failure', async () => {
  let release;
  const transport = new Promise(resolve => { release = resolve; });
  const calls = [];
  const send = url => { calls.push(url); return transport; };
  const pending = Array.from({ length: 16 }, () => handleMetricaMeasurement(makeRequest(), config, send));
  try {
    assert.equal((await handleMetricaMeasurement(makeRequest(), config, send)).status, 429);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 16);
  } finally { release(new Response(null, { status: 503 })); }
  assert.ok((await Promise.all(pending)).every(response => response.status === 503));
  assert.equal((await handleMetricaMeasurement(makeRequest(), config, async () => new Response('<!-- OK -->'))).status, 204);
});


test('one ingress peer cannot consume the process budget for other peers', async () => {
  let sent = 0;
  const send = async () => { sent++; return new Response('<!-- OK -->'); };
  const originalClock = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    for (let index = 0; index < 600; index++) {
      assert.equal((await handleMetricaMeasurement(makeRequest(view, { 'x-real-ip': '192.0.2.90' }), config, send)).status, 204);
    }
    assert.equal((await handleMetricaMeasurement(makeRequest(view, { 'x-real-ip': '192.0.2.90',
      cookie: granted + '; __Host-blizhniy_analytics_visit=66772a29c5c85de603c3a97e89b9e8d9' }), config, send)).status, 429);
    assert.equal((await handleMetricaMeasurement(makeRequest(view, { 'x-real-ip': '192.0.2.91' }), config, send)).status, 204);
    assert.equal(sent, 601);
    Date.now = () => 1_800_000_060_000;
    assert.equal((await handleMetricaMeasurement(makeRequest(view, { 'x-real-ip': '192.0.2.90' }), config, send)).status, 204);
  } finally { Date.now = originalClock; }
});
