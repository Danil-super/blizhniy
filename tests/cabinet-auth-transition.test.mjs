import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/client-user-profile.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const a = { id: 'a', email: 'a@example.invalid', user_metadata: { display_name: 'A' } };
const b = { id: 'b', email: 'b@example.invalid', user_metadata: { display_name: 'B' } };
const session = (user) => ({ user, access_token: `token-${user.id}` });

function makeIdentityHarness() {
  let authListener;
  let current = session(a);
  let deferred;
  let getSessionCalls = 0;
  const supabase = {
    auth: {
      onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      getSession() {
        getSessionCalls += 1;
        if (deferred) {
          const value = deferred;
          deferred = null;
          return value.promise;
        }
        return Promise.resolve({ data: { session: current } });
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    Date,
    require: (id) => {
      if (id === '@/lib/supabase-browser') return { getSupabaseBrowserClient: () => supabase };
      if (id === '@/lib/cabinet-profile') return { createDefaultCabinetProfile() {} };
      throw new Error(`Unexpected module: ${id}`);
    },
  });
  return {
    resolve: module.exports.resolveClientUserIdentity,
    switchTo(user) { current = session(user); authListener('SIGNED_IN', current); },
    deferNextSession() {
      let settle;
      const promise = new Promise((resolve) => { settle = resolve; });
      deferred = { promise };
      return (user) => settle({ data: { session: session(user) } });
    },
    calls: () => getSessionCalls,
  };
}

test('A session completing after B sign-in cannot overwrite the identity cache or return A to a waiting caller', async () => {
  const h = makeIdentityHarness();
  const settleA = h.deferNextSession();
  const pendingA = h.resolve();
  h.switchTo(b);
  const pendingB = h.resolve();
  settleA(a);

  for (const result of [await pendingA, await pendingB, await h.resolve()]) {
    assert.equal(result.ownerKey, 'b');
    assert.equal(result.accessToken, 'token-b');
    assert.equal(result.email, b.email);
  }
  assert.equal(h.calls(), 2, 'later reads should use B cache, not issue another Auth request');
});

test('a settled A cache is invalidated synchronously when Auth switches to B', async () => {
  const h = makeIdentityHarness();
  assert.equal((await h.resolve()).ownerKey, 'a');
  h.switchTo(b);
  const next = await h.resolve();
  assert.equal(next.ownerKey, 'b');
  assert.equal(next.accessToken, 'token-b');
});
