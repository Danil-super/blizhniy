import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/app/api/ready/route.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function route(configured, databaseRead) {
  let reads = 0;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id === 'next/server') return {
        NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200, headers: options.headers }) },
      };
      if (id === '@/lib/supabase-rest') return {
        isSupabaseRestConfigured: () => configured,
        supabaseRest: (url, options) => {
          reads += 1;
          assert.equal(url, '/rest/v1/categories?select=id&limit=1');
          assert.equal(options.attempts, 1);
          assert.ok(options.timeoutMs <= 3000);
          return databaseRead();
        },
      };
      throw new Error(`Unexpected module ${id}`);
    },
  });
  return { GET: module.exports.GET, reads: () => reads };
}

test('missing database credentials return 503 without querying', async () => {
  const r = route(false, () => { throw new Error('should not run'); });
  const result = await r.GET();
  assert.equal(result.status, 503);
  assert.equal(result.body.ok, false);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(r.reads(), 0);
});

test('a live read-only database response makes the release ready', async () => {
  const r = route(true, () => [{ id: 'nonpersonal-category-id' }]);
  const result = await r.GET();
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(r.reads(), 1);
});

test('database failure, timeout and malformed response refuse readiness', async () => {
  for (const databaseRead of [
    () => Promise.reject(new Error('database unavailable')),
    () => Promise.reject(new Error('aborted')),
    () => ({ ok: true }),
  ]) {
    const result = await route(true, databaseRead).GET();
    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
  }
});
