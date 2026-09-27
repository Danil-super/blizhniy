import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { supabaseRest } from '../src/lib/supabase-rest.ts';

let server;
let calls = 0;
before(async () => {
  server = http.createServer((req, res) => {
    calls++;
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
  const beforeCalls = calls;
  await assert.rejects(supabaseRest('/write', { method: 'POST', body: { x: 1 } }), /temporarily unavailable/);
  assert.equal(calls - beforeCalls, 1);
});

test('successful database read still returns the payload', async () => {
  assert.deepEqual(await supabaseRest('/ok'), []);
});
