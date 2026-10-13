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

function route(configured, databaseRead, production = {}) {
  let reads = 0, postgresReads = 0, runtimeReads = 0;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    setTimeout: production.setTimeout ?? setTimeout,
    clearTimeout: production.clearTimeout ?? clearTimeout,
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
      if (id === '@/lib/production-auth-config') return {
        readProductionAuthConfig: () => {
          if (production.configError) throw production.configError;
          return production.config ?? null;
        },
      };
      if (id === '@/lib/production-auth-runtime') return {
        getProductionAccountDatabase: async config => {
          runtimeReads += 1;
          assert.equal(config, production.config);
          if (production.runtime) return production.runtime();
          return { db: { query: async sql => {
            postgresReads += 1;
            assert.match(sql, /^select id from app\.categories limit 1$/i);
            return production.databaseRead();
          } } };
        },
      };
      throw new Error(`Unexpected module ${id}`);
    },
  });
  return { GET: module.exports.GET, reads: () => reads, postgresReads: () => postgresReads, runtimeReads: () => runtimeReads };
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

test('PostgreSQL readiness uses the verified limited pool, including an empty reference table', async () => {
  for (const rows of [[], [{ id: 'reference-only' }]]) {
    const r = route(false, () => assert.fail('no legacy fallback'), {
      config: {}, databaseRead: async () => ({ rows }),
    });
    const result = await r.GET();
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(result.body)), { ok: true, service: 'blizhniy' });
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(r.reads(), 0);
    assert.equal(r.runtimeReads(), 1);
    assert.equal(r.postgresReads(), 1);
  }
});

test('invalid mode/configuration and PostgreSQL failures never probe a configured legacy backend', async () => {
  const secretError = new Error('private-database-password-or-host');
  for (const production of [
    { configError: secretError },
    { config: {}, runtime: async () => { throw secretError; } },
    { config: {}, databaseRead: async () => { throw secretError; } },
    { config: {}, databaseRead: async () => ({ rows: null }) },
  ]) {
    const r = route(true, () => assert.fail('no legacy fallback'), production);
    const result = await r.GET();
    assert.equal(result.status, 503);
    assert.deepEqual(JSON.parse(JSON.stringify(result.body)), { ok: false, service: 'blizhniy' });
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(r.reads(), 0);
  }
});

test('PostgreSQL initialization and reads have a cleared three-second HTTP deadline', async () => {
  for (const blocked of ['runtime', 'query']) {
    let expire, cleared = 0, rejectPending;
    const pending = new Promise((resolve, reject) => { rejectPending = reject; });
    const timer = {};
    const r = route(true, () => assert.fail('no legacy fallback'), {
      config: {}, ...(blocked === 'runtime' ? { runtime: () => pending } : { databaseRead: () => pending }),
      setTimeout: (callback, ms) => { assert.equal(ms, 3000); expire = callback; return timer; },
      clearTimeout: handle => { assert.equal(handle, timer); cleared += 1; },
    });
    const resultPromise = r.GET();
    await Promise.resolve();
    expire();
    const result = await resultPromise;
    assert.equal(result.status, 503);
    assert.equal(cleared, 1);
    assert.equal(r.reads(), 0);
    rejectPending(new Error('late bounded database failure'));
    await new Promise(resolve => setImmediate(resolve));
  }
});

test('successful and failed PostgreSQL probes clear their pending timer', async () => {
  for (const fail of [false, true]) {
    const timer = {}, cleared = [];
    const r = route(false, () => assert.fail('no legacy fallback'), {
      config: {}, databaseRead: async () => { if (fail) throw new Error('bounded failure'); return { rows: [] }; },
      setTimeout: (callback, ms) => { assert.equal(typeof callback, 'function'); assert.equal(ms, 3000); return timer; },
      clearTimeout: handle => cleared.push(handle),
    });
    assert.equal((await r.GET()).status, fail ? 503 : 200);
    assert.deepEqual(cleared, [timer]);
  }
});
