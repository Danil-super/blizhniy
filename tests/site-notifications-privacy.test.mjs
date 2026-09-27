import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/site-notifications.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function makeHarness(demoMode) {
  const stored = new Map([['blizhniy-site-notifications:a', '[{"id":"old-a","message":"private A"}]']]);
  const storage = {
    get length() { return stored.size; },
    key(index) { return [...stored.keys()][index] ?? null; },
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { stored.set(key, value); },
    removeItem(key) { stored.delete(key); },
  };
  let authChange;
  const window = { localStorage: storage, dispatchEvent() {}, setTimeout() {} };
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports, window, Event: class Event {},
    CustomEvent: class CustomEvent {},
    require: (id) => {
      if (id === '@/lib/client-user-profile') return {};
      if (id === '@/lib/client-runtime-mode') return { shouldShowClientFallbackContent: () => demoMode };
      if (id === '@/lib/supabase-browser') return { getSupabaseBrowserClient: () => ({ auth: { onAuthStateChange(callback) { authChange = callback; } } }) };
      throw new Error(`Unexpected module: ${id}`);
    },
  });
  return { stored, api: module.exports, authChange: (...args) => authChange?.(...args) };
}

test('production removes legacy persisted personal messages and clears memory on account change', () => {
  const h = makeHarness(false);
  assert.equal(h.stored.size, 0, 'old owner data is removed at module initialization');
  h.api.writeSiteNotifications('a', [{ id: 'current-a', message: 'private A' }]);
  assert.equal(h.stored.size, 0, 'new personal messages never enter localStorage');
  assert.equal(h.api.readSiteNotifications('a').length, 1);
  assert.equal(h.api.readSiteNotifications('b').length, 0);

  h.stored.set('blizhniy-site-notifications:a', 'sensitive legacy value');
  h.authChange('SIGNED_IN');
  assert.equal(h.api.readSiteNotifications('a').length, 0);
  assert.equal(h.stored.size, 0, 'a stale legacy key is removed on Auth transition');
});

test('explicit demo mode retains local browser notifications', () => {
  const h = makeHarness(true);
  assert.equal(h.api.readSiteNotifications('a')[0].id, 'old-a');
  h.api.writeSiteNotifications('a', [{ id: 'demo-a' }]);
  assert.match(h.stored.get('blizhniy-site-notifications:a'), /demo-a/);
});
