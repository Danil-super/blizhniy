const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const applicationId = '11111111-1111-4111-8111-111111111111';
const paymentId = '22222222-2222-4222-8222-222222222222';
const externalUrl = 'https://synthetic-checkout.example.test/never-fetched';
const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tokenA = 'synthetic-A-initial-not-a-secret';
const tokenB = 'synthetic-B-not-a-secret';
const payment = confirmationUrl => ({ id: paymentId, confirmationUrl, status: 'pending' });
const savedWithoutPayment = { application: { id: applicationId }, paymentError: 'Заявка сохранена, оплату можно повторить.' };

function deferred() {
  let resolve; const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => typeof payload === 'function' ? payload() : payload };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate); if (found) return found;
  }
  return undefined;
}

// The entire component and actual client libraries execute, not a copied or
// extracted handler. React hooks/JSX, Auth and transport/browser edges are the
// unit boundaries. Future source imports resolve normally from disk, so RED
// never depends on the planned helper being absent.
function harness({ adminMode = false, onFetch, onSession, onFormRead } = {}) {
  let current = { user: { id: accountA, email: 'synthetic-a@example.test' }, access_token: tokenA };
  let hookIndex = 0; let sessionReads = 0;
  const hookSlots = []; const cache = new Map(); const listeners = [];
  const requests = []; const destinations = []; const storageWrites = [];
  const form = {
    entries: [['participantName', 'Синтетическая мастерская А'], ['city', 'Краснодар'], ['category', 'Рукоделие'], ['description', 'Синтетическое описание товаров'], ['videoUrl', ''], ['phone', '+79995550000'], ['email', 'synthetic-a@example.test'], ['comment', 'Только unit fixture'], ['productPhotos', new File(['synthetic-image'], 'fixture.jpg', { type: 'image/jpeg' })]],
    querySelectorAll: () => [{ checked: true }], querySelector: () => ({ checked: true }), reportValidity: () => true,
  };
  class SyntheticFormData {
    constructor(source) { this.values = new Map(source?.entries?.map(([key, value]) => [key, [value]]) || []); }
    get(key) { onFormRead?.(key, api); return this.values.get(key)?.[0] ?? null; }
    getAll(key) { return this.values.get(key) || []; }
    set(key, value) { this.values.set(key, [value]); }
    append(key, value) { this.values.set(key, [...(this.values.get(key) || []), value]); }
    entries() { return [...this.values].flatMap(([key, values]) => values.map(value => [key, value]))[Symbol.iterator](); }
  }
  const auth = {
    getSession: async () => {
      sessionReads += 1;
      const value = onSession ? await onSession(sessionReads, current, api) : current;
      return { data: { session: value }, error: null };
    },
    onAuthStateChange(callback) {
      listeners.push(callback); callback('INITIAL_SESSION', current);
      return { data: { subscription: { unsubscribe() {} } } };
    },
  };
  const react = {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hookSlots)) hookSlots[index] = typeof initial === 'function' ? initial() : initial;
      return [hookSlots[index], value => { hookSlots[index] = typeof value === 'function' ? value(hookSlots[index]) : value; }];
    },
    useRef(initial) { const index = hookIndex++; return hookSlots[index] ||= { current: initial }; },
    useEffect() {}, useMemo: factory => factory(), useCallback: callback => callback,
  };
  const browser = {
    location: { set href(value) { destinations.push({ destination: value, external: true }); } },
    localStorage: { length: 0, key: () => null, getItem: () => null, removeItem() {}, setItem(key, value) { storageWrites.push({ key, value }); } },
    dispatchEvent() {}, setTimeout, clearTimeout,
  };
  async function fakeFetch(url, init = {}) {
    assert.equal(typeof url, 'string');
    assert.ok(url === '/api/uploads/media' || url === '/api/fair-applications' || url === '/api/payments' || /^\/api\/payments\/[^/]+\/confirm$/.test(url), `Unexpected synthetic transport target: ${url}`);
    const entry = { path: url, method: init.method || 'GET', authorization: init.headers?.Authorization, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
    requests.push(entry);
    const custom = onFetch ? await onFetch(entry, api) : undefined;
    if (custom) return custom;
    if (url === '/api/uploads/media') return response({ files: [{ path: 'fair-applications/synthetic-owner/photo.jpg' }] });
    if (url === '/api/fair-applications') return response({ application: { id: applicationId }, payment: payment(externalUrl) }, 201);
    if (url === '/api/payments') return response({ payment: payment(externalUrl) });
    // Original blind confirmation is observable, bounded and never real I/O.
    return response({ error: 'Synthetic confirmation must be left to payment return UI.' }, 503);
  }
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
    }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, process: { env: { NODE_ENV: 'production' } }, Error, Promise, URL, File, Event, FormData: SyntheticFormData,
      AbortController, AbortSignal, setTimeout, clearTimeout, window: browser, fetch: fakeFetch,
      require(id) {
        if (id === 'react') return react;
        if (id === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
        if (id === 'next/navigation') return { useRouter: () => ({ push: destination => destinations.push({ destination, external: false }), refresh() {} }) };
        if (id === '@/lib/supabase-browser') return { getSupabaseBrowserClient: () => ({ auth }), isSupabaseBrowserConfigured: () => true };
        if (id.startsWith('@/') || id.startsWith('.')) {
          const base = id.startsWith('@/') ? path.join(__dirname, '../src', id.slice(2)) : path.resolve(path.dirname(filename), id);
          const actual = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map(suffix => base + suffix).find(fs.existsSync);
          assert.ok(actual, `Actual source dependency exists: ${id}`); return load(actual);
        }
        return require(id);
      },
    }, { filename });
    return module.exports;
  }
  const component = load(path.join(__dirname, '../src/components/FairApplicationForm.tsx')).FairApplicationForm;
  const api = {
    requests, destinations, storageWrites, form,
    change(owner, token = owner === accountA ? tokenA : tokenB, event = 'SIGNED_IN') {
      current = { user: { id: owner, email: 'synthetic@example.test' }, access_token: token };
      for (const callback of [...listeners]) callback(event, current);
    },
    render() { hookIndex = 0; return component({ adminMode }); },
    verifyCaptcha() {
      const widget = find(api.render(), node => typeof node.props?.onVerify === 'function');
      assert.ok(widget, 'actual CAPTCHA callback exists'); widget.props.onVerify('synthetic-unit-captcha');
    },
    async submit() {
      api.verifyCaptcha(); const tree = api.render();
      const submit = find(tree, node => node.type === 'button' && node.props.type === 'submit');
      assert.equal(submit.props.disabled, false, 'ordinary retry has an enabled submit control after CAPTCHA verification');
      await tree.props.onSubmit({ preventDefault() {}, currentTarget: form });
    },
    errorText() { const paragraph = find(api.render(), node => node.type === 'p'); return paragraph?.props.children || ''; },
    count(target) { return requests.filter(entry => entry.path === target).length; },
    confirmations() { return requests.filter(entry => entry.path.endsWith('/confirm')); },
  };
  return api;
}

test('fair saved201 payment failure retries only the same owner-bound application, without re-upload or duplicate creation', async () => {
  const h = harness({ onFetch: entry => entry.path === '/api/fair-applications' ? response(savedWithoutPayment, 201) : undefined });
  await h.submit(); assert.equal(h.count('/api/fair-applications'), 1); assert.equal(h.destinations.length, 0);
  await h.submit();
  assert.equal(h.count('/api/fair-applications'), 1, 'retry must not create another saved application');
  assert.equal(h.count('/api/uploads/media'), 1, 'retry must not upload the same photos again');
  const retry = h.requests.find(entry => entry.path === '/api/payments');
  assert.ok(retry); assert.equal(retry.authorization, `Bearer ${tokenA}`);
  assert.equal(retry.body.targetId, applicationId); assert.equal(retry.body.targetType, 'fair_application');
  assert.equal(retry.body.tariffId, 'fair-participation');
  assert.deepEqual(h.destinations, [{ destination: externalUrl, external: true }]);
});

test('fair repeated payment retry errors retain one saved application and perform no repeated uploads', async () => {
  const h = harness({ onFetch: entry => entry.path === '/api/fair-applications' ? response(savedWithoutPayment, 201) : entry.path === '/api/payments' ? response({ error: 'Synthetic retry failure' }, 503) : undefined });
  await h.submit(); await h.submit(); await h.submit();
  assert.equal(h.count('/api/fair-applications'), 1); assert.equal(h.count('/api/uploads/media'), 1);
  assert.equal(h.count('/api/payments'), 2); assert.equal(h.destinations.length, 0);
  assert.ok(h.requests.filter(entry => entry.path === '/api/payments').every(entry => entry.body.targetId === applicationId && entry.authorization === `Bearer ${tokenA}`));
});

test('fair saved A application cannot be retried under B after an ordinary account event', async () => {
  const h = harness({ onFetch: entry => entry.path === '/api/fair-applications' ? response(savedWithoutPayment, 201) : undefined });
  await h.submit(); h.change(accountB); await h.submit();
  assert.equal(h.count('/api/fair-applications'), 1); assert.equal(h.count('/api/uploads/media'), 1);
  assert.equal(h.count('/api/payments'), 0); assert.equal(h.destinations.length, 0);
});

for (const bounce of [false, true]) test(`fair identity lookup cancels A→B${bounce ? '→A' : ''} before upload, create, payment or navigation`, async () => {
  const entered = deferred(); const lookup = deferred();
  const h = harness({ onSession: (count, current) => { if (count === 1) { entered.resolve(); return lookup.promise; } return current; } });
  const pending = h.submit(); await entered.promise;
  h.change(accountB); if (bounce) h.change(accountA);
  lookup.resolve({ user: { id: accountA, email: 'synthetic-a@example.test' }, access_token: tokenA });
  await pending; assert.equal(h.requests.length, 0); assert.equal(h.destinations.length, 0);
});

for (const phase of ['transport', 'body']) test(`fair account transition during upload ${phase} cancels all later application/payment writes`, async () => {
  const entered = deferred(); const blocked = deferred();
  const h = harness({ onFetch: entry => {
    if (entry.path !== '/api/uploads/media') return undefined;
    if (phase === 'transport') { entered.resolve(); return blocked.promise; }
    return response(() => { entered.resolve(); return blocked.promise; });
  } });
  const pending = h.submit(); await entered.promise; h.change(accountB);
  blocked.resolve(phase === 'transport' ? response({ files: [{ path: 'fair-applications/synthetic-owner/photo.jpg' }] }) : { files: [{ path: 'fair-applications/synthetic-owner/photo.jpg' }] });
  await pending; assert.equal(h.count('/api/uploads/media'), 1, 'upload started before the account switch');
  assert.equal(h.count('/api/fair-applications'), 0); assert.equal(h.count('/api/payments'), 0); assert.equal(h.destinations.length, 0);
});

test('fair A→B→A during upload still cancels the initiating operation', async () => {
  const entered = deferred(); const upload = deferred();
  const h = harness({ onFetch: entry => { if (entry.path === '/api/uploads/media') { entered.resolve(); return upload.promise; } } });
  const pending = h.submit(); await entered.promise; h.change(accountB); h.change(accountA);
  upload.resolve(response({ files: [{ path: 'fair-applications/synthetic-owner/photo.jpg' }] }));
  await pending; assert.equal(h.count('/api/fair-applications'), 0); assert.equal(h.destinations.length, 0);
});

test('fair transition while reading request fields prevents the application POST itself', async () => {
  let changed = false;
  const h = harness({ onFormRead: (key, fixture) => { if (!changed && key === 'comment') { changed = true; fixture.change(accountB); } } });
  await h.submit(); assert.ok(changed); assert.equal(h.count('/api/fair-applications'), 0); assert.equal(h.count('/api/payments'), 0); assert.equal(h.destinations.length, 0);
});

for (const bounce of [false, true]) test(`fair transition A→B${bounce ? '→A' : ''} while saved-response JSON resolves cannot navigate or confirm`, async () => {
  const entered = deferred(); const body = deferred();
  const h = harness({ onFetch: entry => entry.path === '/api/fair-applications' ? response(() => { entered.resolve(); return body.promise; }, 201) : undefined });
  const pending = h.submit(); await entered.promise; h.change(accountB); if (bounce) h.change(accountA);
  body.resolve({ application: { id: applicationId }, payment: payment(externalUrl) });
  await pending; assert.equal(h.count('/api/fair-applications'), 1, 'create started before transition');
  assert.equal(h.count('/api/payments'), 0); assert.equal(h.confirmations().length, 0); assert.equal(h.destinations.length, 0); assert.equal(h.storageWrites.length, 0);
});

test('fair same-owner token refresh during upload preserves the initiating bearer and valid external checkout', async () => {
  const entered = deferred(); const upload = deferred();
  const h = harness({ onFetch: entry => { if (entry.path === '/api/uploads/media') { entered.resolve(); return upload.promise; } } });
  const pending = h.submit(); await entered.promise;
  h.change(accountA, 'synthetic-A-refreshed-not-a-secret', 'TOKEN_REFRESHED');
  upload.resolve(response({ files: [{ path: 'fair-applications/synthetic-owner/photo.jpg' }] })); await pending;
  assert.equal(h.count('/api/fair-applications'), 1);
  assert.ok(h.requests.every(entry => entry.authorization === `Bearer ${tokenA}`));
  assert.deepEqual(h.destinations, [{ destination: externalUrl, external: true }]);
});

test('fair payment without confirmation URL opens truthful /oplata/id and does not blindly confirm or claim cabinet success', async () => {
  const h = harness({ onFetch: entry => entry.path === '/api/fair-applications' ? response({ application: { id: applicationId }, payment: payment(null) }, 201) : undefined });
  await h.submit(); assert.equal(h.confirmations().length, 0);
  assert.deepEqual(h.destinations, [{ destination: `/oplata/${paymentId}`, external: false }]);
});

test('fair saved payment retry without confirmation URL also opens /oplata/id without duplicate create or confirmation', async () => {
  const h = harness({ onFetch: entry => entry.path === '/api/fair-applications' ? response(savedWithoutPayment, 201) : entry.path === '/api/payments' ? response({ payment: payment(null) }) : undefined });
  await h.submit(); await h.submit();
  assert.equal(h.count('/api/fair-applications'), 1); assert.equal(h.confirmations().length, 0);
  assert.deepEqual(h.destinations, [{ destination: `/oplata/${paymentId}`, external: false }]);
});

for (const adminMode of [false, true]) test(`fair ${adminMode ? 'admin' : 'paid'} successful response without application ID cannot invent a local ID or navigate`, async () => {
  const h = harness({ adminMode, onFetch: entry => entry.path === '/api/fair-applications' ? response({ payment: payment(externalUrl) }, 201) : undefined });
  await h.submit(); assert.equal(h.destinations.length, 0); assert.equal(h.count('/api/payments'), 0); assert.equal(h.confirmations().length, 0);
  assert.ok(h.errorText(), 'missing persisted ID is an actual UI error'); assert.equal(h.storageWrites.length, 0);
});

test('fair rejected creation has no saved ID, so a subsequent successful submission can create once anew', async () => {
  let creates = 0;
  const h = harness({ onFetch: entry => { if (entry.path === '/api/fair-applications' && ++creates === 1) return response({ error: 'Synthetic validation rejection' }, 400); } });
  await h.submit(); assert.equal(h.destinations.length, 0); await h.submit();
  assert.equal(h.count('/api/fair-applications'), 2); assert.equal(h.count('/api/payments'), 0);
  assert.deepEqual(h.destinations, [{ destination: externalUrl, external: true }]);
});

test('fair valid admin save retains cabinet navigation without payment creation or confirmation', async () => {
  const h = harness({ adminMode: true, onFetch: entry => entry.path === '/api/fair-applications' ? response({ application: { id: applicationId } }, 201) : undefined });
  await h.submit(); assert.equal(h.count('/api/fair-applications'), 1);
  assert.equal(h.count('/api/payments'), 0); assert.equal(h.confirmations().length, 0);
  assert.deepEqual(h.destinations, [{ destination: '/cabinet/fair-applications', external: false }]);
});
