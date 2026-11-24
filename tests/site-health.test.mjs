import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSiteHealth } from '../scripts/check-site-health.mjs';

const origin = 'https://site.example.invalid';
const json = (value, status = 200) => Response.json(value, { status });

test('the outside probe verifies both health and database readiness through bounded HTTPS GETs', async () => {
  const calls = [];
  const result = await checkSiteHealth(origin, async (url, options) => {
    calls.push(url.pathname);
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return url.pathname === '/api/health' ? json({ ok: true }) : json({ ok: true, service: 'blizhniy' });
  });
  assert.deepEqual(calls, ['/api/health', '/api/ready']);
  assert.equal(result, 'healthy');
});

test('site outages and database readiness failures produce distinct notifications', async () => {
  assert.equal(await checkSiteHealth(origin, async () => { throw new Error('connection failed'); }), 'site-unavailable');
  assert.equal(await checkSiteHealth(origin, async url =>
    url.pathname === '/api/health' ? json({ ok: true }) : json({ ok: false, service: 'blizhniy' }, 503)
  ), 'readiness-unavailable');
});

test('redirects, non-JSON, schemaless and oversized replies cannot report a healthy site', async () => {
  for (const reply of [
    new Response(null, { status: 302 }),
    new Response('<html>active proxy</html>'),
    json({ okay: true }),
    json({ ok: true, payload: 'a'.repeat(4096) }),
  ]) {
    assert.equal(await checkSiteHealth(origin, async () => reply), 'site-unavailable');
  }
  assert.equal(await checkSiteHealth(origin, async url =>
    url.pathname === '/api/health' ? json({ ok: true }) : json({ ok: true, service: 'foreign' })
  ), 'readiness-unavailable');
});
