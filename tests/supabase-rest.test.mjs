import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { supabaseRest, getSupabaseRestConfig, isSupabaseRestConfigured, isSupabaseServiceRoleConfigured, buildSupabaseRestUrl } from '../src/lib/supabase-rest.ts';

let server;
const calls = new Map();
before(async () => {
  server = http.createServer((req, res) => {
    calls.set(req.url, (calls.get(req.url) ?? 0) + 1);
    if (req.url === '/headers') return; // never returns headers
    if (req.url === '/body') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('['); // never completes the response body
      return;
    }
    if (req.url === '/write') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{"message":"temporarily unavailable"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test('a stalled header response is aborted', async () => {
  const started = Date.now();
  await assert.rejects(supabaseRest('/headers', { attempts: 1, timeoutMs: 50 }), { name: 'AbortError' });
  assert.ok(Date.now() - started < 2000);
});

test('a stalled body response is aborted', async () => {
  const started = Date.now();
  await assert.rejects(supabaseRest('/body', { attempts: 1, timeoutMs: 50 }), { name: 'AbortError' });
  assert.ok(Date.now() - started < 2000);
});

test('mutating requests are not automatically retried after server error', async () => {
  const beforeCalls = calls.get('/write') ?? 0;
  const concurrentRead = supabaseRest('/ok');
  await assert.rejects(supabaseRest('/write', { method: 'POST', body: { x: 1 } }), /temporarily unavailable/);
  assert.deepEqual(await concurrentRead, []);
  assert.equal((calls.get('/write') ?? 0) - beforeCalls, 1);
});

test('successful database read still returns the payload', async () => {
  assert.deepEqual(await supabaseRest('/ok'), []);
});

test('explicit local auth mode preserves the existing isolated legacy test backend', async () => {
  const previousMode = process.env.BLIZHNIY_AUTH_MODE;
  try {
    process.env.BLIZHNIY_AUTH_MODE = 'local';
    assert.equal(isSupabaseServiceRoleConfigured(), true);
    assert.deepEqual(await supabaseRest('/ok'), []);
  } finally {
    if (previousMode === undefined) delete process.env.BLIZHNIY_AUTH_MODE;
    else process.env.BLIZHNIY_AUTH_MODE = previousMode;
  }
});

test('PostgreSQL or invalid auth mode blocks legacy reads and writes before network access even with leftover keys', async () => {
  const previousMode = process.env.BLIZHNIY_AUTH_MODE;
  const count = () => [...calls.values()].reduce((sum, value) => sum + value, 0);
  const beforeCalls = count();
  try {
    for (const mode of ['postgres', 'unknown', ' postgres', 'POSTGRES']) {
      process.env.BLIZHNIY_AUTH_MODE = mode;
      for (const serviceRole of [true, false]) {
        assert.deepEqual(getSupabaseRestConfig(serviceRole), { key: undefined, supabaseUrl: undefined });
        assert.equal(isSupabaseRestConfigured(serviceRole), false);
      }
      assert.equal(isSupabaseServiceRoleConfigured(), false);
      assert.throws(() => buildSupabaseRestUrl('/ok'));
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        await assert.rejects(supabaseRest('/ok', { method }));
      }
    }
    assert.equal(count(), beforeCalls);
  } finally {
    if (previousMode === undefined) delete process.env.BLIZHNIY_AUTH_MODE;
    else process.env.BLIZHNIY_AUTH_MODE = previousMode;
  }
});
