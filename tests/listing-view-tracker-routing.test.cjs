const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const root = resolve(__dirname, '..');
const uuid = '11111111-1111-4111-8111-111111111111';
function harness({ storedViews = 57, failed = false } = {}) {
  let effect;
  const storage = new Map();
  const calls = [], events = [];
  let authReads = 0;
  const browserWindow = {
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    dispatchEvent: event => events.push({ type: event.type, detail: event.detail }),
  };
  function load(path, dependencies = {}) {
    const module = { exports: {} };
    const source = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, console, Promise, Event, CustomEvent,
      window: browserWindow,
      require: id => { assert.ok(Object.hasOwn(dependencies, id), 'Unexpected dependency: ' + id); return dependencies[id]; },
      fetch: async (url, request) => { calls.push({ url, request }); return { ok: !failed, json: async () => ({ views: storedViews }) }; },
    });
    return module.exports;
  }
  const views = load('src/lib/listing-views.ts');
  const tracker = load('src/components/listings/ListingViewTracker.tsx', {
    react: { useEffect: callback => { effect = callback; } },
    '@/lib/supabase-browser': { getSupabaseBrowserClient: () => ({ auth: { getSession: async () => {
      authReads++; return { data: { session: { access_token: 'synthetic-origin-token' } } };
    } } }) },
    '@/lib/listing-views': views,
  });
  async function mount(listingId) {
    tracker.ListingViewTracker({ listingId, initialViews: 10 });
    const cleanup = effect();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    return cleanup;
  }
  return { mount, calls, events, views, authReads: () => authReads };
}

for (const listingId of [`work-vacancy-${uuid}`, `work-request-${uuid}`, `work-specialist-${uuid}`, 'demo-listing-1']) {
  test(`non-listing identity ${listingId.split('-').slice(0, 2).join('-')} stays local without Auth or invalid API requests`, async () => {
    const h = harness();
    const cleanup = await h.mount(listingId);
    assert.deepEqual(h.calls, []);
    assert.equal(h.authReads(), 0);
    assert.equal(h.views.getListingExtraViews(listingId), 1);
    assert.equal(h.events.at(-1).detail.views, 11);
    cleanup();
    const second = await h.mount(listingId);
    assert.equal(h.views.getListingExtraViews(listingId), 1, 'Browser-local visit remains once per identity');
    second();
  });
}

test('persisted listing UUID retains ordinary server view count and captured bearer', async () => {
  const h = harness();
  const cleanup = await h.mount(uuid);
  assert.equal(h.authReads(), 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, `/api/listings/${uuid}/views`);
  assert.equal(h.calls[0].request.method, 'POST');
  assert.equal(h.calls[0].request.headers.Authorization, 'Bearer synthetic-origin-token');
  assert.equal(h.events.at(-1).detail.views, 57);
  assert.equal(h.views.getListingExtraViews(uuid), 0);
  cleanup();
});

test('unavailable persisted count keeps existing browser-local fallback', async () => {
  const h = harness({ failed: true });
  const cleanup = await h.mount(uuid);
  assert.equal(h.calls.length, 1);
  assert.equal(h.events.at(-1).detail.views, 11);
  cleanup();
});
