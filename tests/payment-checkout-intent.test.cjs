const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createHash, webcrypto } = require('node:crypto');
const ts = require('typescript');

const ids = {
  payment: '11111111-1111-4111-8111-111111111111',
  target: '22222222-2222-4222-8222-222222222222',
  owner: '33333333-3333-4333-8333-333333333333',
  tariff: '44444444-4444-4444-8444-444444444444',
  provider: '55555555-5555-4555-8555-555555555555',
};
const root = path.resolve(__dirname, '..');
const cutoffMs = (23 * 60 + 55) * 60_000;
const input = { tariffId: 'listing-publication', targetType: 'listing', targetId: ids.target,
  userId: ids.owner, targetTitle: 'Original synthetic title', customerEmail: 'original@example.invalid' };
const clone = value => structuredClone(value);
const hash = body => createHash('sha256').update(body, 'utf8').digest('hex');
const flush = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };
async function waitUntil(predicate) {
  const deadline = performance.now() + 3000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, 'actual async module graph must reach its explicit boundary');
    await new Promise(setImmediate);
  }
}

function clock() {
  let monotonic = 0;
  let wall = Date.UTC(2026, 9, 8, 7);
  let sequence = 0;
  const timers = new Map();
  class SyntheticDate extends Date {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return wall; }
  }
  return {
    Date: SyntheticDate, performance: { now: () => monotonic },
    now: () => Date.UTC(2026, 9, 8, 7) + monotonic,
    setTimeout(callback, delay = 0) { const id = ++sequence; timers.set(id, { callback, at: monotonic + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    jumpWall(milliseconds) { wall += milliseconds; },
    async advance(milliseconds) {
      const end = monotonic + milliseconds;
      await flush();
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        wall += due[1].at - monotonic;
        monotonic = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
        await flush();
      }
      wall += end - monotonic;
      monotonic = end;
      await flush();
    },
  };
}

function paymentRow(overrides = {}) {
  return { id: ids.payment, user_id: ids.owner, target_type: 'listing', target_id: ids.target,
    tariff_id: ids.tariff, provider: 'yookassa', provider_payment_id: null, amount: '199.99',
    status: 'created', created_at: '2026-10-08T07:00:00.000Z', paid_at: null,
    purchased_duration_days: 9, target_applied_at: null, fulfillment_status: 'pending', fulfillment_reason: null,
    ...overrides };
}

function originalBody(amount = '199.99') {
  return JSON.stringify({ amount: { value: amount, currency: 'RUB' }, capture: true,
    confirmation: { type: 'redirect', return_url: `https://original.example.invalid/oplata/${ids.payment}` },
    description: input.targetTitle,
    receipt: { customer: { email: input.customerEmail }, internet: true, items: [{
      amount: { value: amount, currency: 'RUB' }, description: `Услуга размещения: ${input.targetTitle}`,
      payment_mode: 'full_payment', payment_subject: 'service', quantity: 1, vat_code: 1,
    }] },
    metadata: { localPaymentId: ids.payment, targetId: ids.target, targetType: 'listing', tariffId: input.tariffId } });
}

function intentRow(overrides = {}) {
  const body = overrides.request_body ?? originalBody();
  return { payment_id: ids.payment, user_id: ids.owner, target_type: 'listing', target_id: ids.target,
    tariff_id: ids.tariff, tariff_key: input.tariffId, amount: '199.99', purchased_duration_days: 9,
    merchant_shop_id: '999999', is_test: true, request_body: body, request_sha256: hash(body),
    first_attempt_authorized_at: '2026-10-08T07:00:00.000Z', ...overrides };
}

// Full actual provider, store, tariff, runtime, mock-store and data modules are
// recursively executed in a fresh module graph per server instance. Only REST
// and vendor HTTP/time are lexical adapters. These fake RPC rows are NOT proof
// of SQL controls: the companion PG17 suite executes the real migration/RPCs.
function harness(options = {}) {
  const time = options.clock ?? clock();
  const state = {
    row: options.row === undefined ? null : clone(options.row),
    intent: options.intent ? clone(options.intent) : null,
    requests: [], providerRequests: [], creates: 0, effects: 0,
    tariff: { id: ids.tariff, action: 'listing_publication', name: 'Synthetic offer', price: 199.99,
      duration_days: 9, active: true },
    remote: new Map(),
  };
  function rpcResult(intent, row = state.row) {
    const remaining = cutoffMs - (time.now() - Date.parse(intent.first_attempt_authorized_at));
    return { ...clone(intent), remaining_ms: remaining, provider_payment_id: row.provider_payment_id,
      financial_status: row.status, decision: row.provider_payment_id ? 'recover' : remaining > 0 ? 'post' : 'manual' };
  }
  async function rest(resource, request = {}) {
    const method = request.method ?? 'GET';
    state.requests.push({ resource, method, body: clone(request.body) });
    if (options.rest) return options.rest(resource, request, state);
    const url = new URL(resource, 'http://synthetic.invalid');
    if (url.pathname === '/rest/v1/tariffs') {
      if (options.noTariff) return [];
      const select = url.searchParams.get('select');
      if (select === 'id,action' || select === 'action') return [{ id: ids.tariff, action: state.tariff.action }];
      return [clone(state.tariff)];
    }
    if (url.pathname === '/rest/v1/payments') {
      if (method === 'POST') {
        state.creates++;
        if (state.row && ['created', 'pending'].includes(state.row.status)) throw new Error('synthetic unique active checkout');
        state.row = paymentRow({ ...request.body, created_at: new Date(time.now()).toISOString() });
        return [clone(state.row)];
      }
      if (method === 'PATCH') {
        assert.ok(state.row);
        state.row = { ...state.row, ...request.body };
        return [clone(state.row)];
      }
      if (!state.row) return [];
      if (url.searchParams.has('status') && !['created', 'pending'].includes(state.row.status)) return [];
      return [clone(state.row)];
    }
    if (url.pathname === '/rest/v1/rpc/prepare_yookassa_checkout_intent') {
      if (options.prepareError) throw new Error('synthetic snapshot commit failure');
      assert.equal(request.useServiceRole, true);
      const p = request.body;
      assert.equal(p.p_payment_id, state.row.id);
      assert.equal(p.p_user_id, state.row.user_id);
      assert.equal(p.p_target_id, state.row.target_id);
      assert.equal(p.p_target_type, state.row.target_type);
      assert.equal(Number(p.p_amount), Number(state.row.amount));
      assert.equal(p.p_purchased_duration_days, state.row.purchased_duration_days);
      if (state.intent) {
        assert.equal(p.p_request_body, state.intent.request_body, 'preparer may not replace an existing snapshot');
      } else {
        state.intent = intentRow({ ...state.row, payment_id: state.row.id, merchant_shop_id: p.p_merchant_shop_id,
          is_test: p.p_is_test, request_body: p.p_request_body, request_sha256: hash(p.p_request_body),
          tariff_key: p.p_tariff_key, first_attempt_authorized_at: new Date(time.now()).toISOString() });
      }
      return [rpcResult(state.intent)];
    }
    if (url.pathname === '/rest/v1/rpc/authorize_yookassa_checkout_attempt') {
      if (options.authorizeErrorAfter !== undefined &&
          state.requests.filter(entry => entry.resource === resource).length > options.authorizeErrorAfter) {
        throw new Error('synthetic database authorization no longer permits dispatch');
      }
      if (!state.intent) return [{ payment_id: state.row.id, decision: state.row.provider_payment_id ? 'legacy_recover' : 'manual',
        provider_payment_id: state.row.provider_payment_id, financial_status: state.row.status }];
      const p = request.body;
      if (p.p_merchant_shop_id !== state.intent.merchant_shop_id || p.p_is_test !== state.intent.is_test) {
        throw new Error('Checkout merchant binding mismatch');
      }
      const result = rpcResult(state.intent);
      if (options.rpcDelayMs) await new Promise(resolve => time.setTimeout(resolve, options.rpcDelayMs));
      return [result];
    }
    if (url.pathname === '/rest/v1/rpc/apply_payment_fulfillment') {
      state.effects++;
      state.row.fulfillment_status = 'applied';
      state.row.target_applied_at = new Date(time.now()).toISOString();
      return [{ payment_id: state.row.id, financial_status: state.row.status, fulfillment_status: 'applied',
        fulfillment_reason: null, paid_at: state.row.paid_at, target_applied_at: state.row.target_applied_at,
        applied_now: true, target_status: 'published' }];
    }
    throw new Error(`Unsupported synthetic REST resource: ${method} ${url.pathname}`);
  }
  function server(overrides = {}, serverOptions = {}) {
    const env = { NODE_ENV: 'production', PAYMENT_PROVIDER: 'yookassa', NEXT_PUBLIC_SUPABASE_URL: 'http://synthetic.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-only', NEXT_PUBLIC_SITE_URL: 'https://original.example.invalid',
      YOOKASSA_SHOP_ID: '999999', YOOKASSA_SECRET_KEY: 'test_synthetic_not_a_credential',
      YOOKASSA_RECEIPTS_ENABLED: 'true', YOOKASSA_RECEIPT_VAT_CODE: '1', ...overrides };
    const cache = new Map();
    const globals = { setTimeout: time.setTimeout, clearTimeout: time.clearTimeout };
    const fetch = async (url, request = {}) => {
      assert.match(String(url), /^https:\/\/api\.yookassa\.ru\/v3\/payments(?:\/[a-f0-9-]+)?$/i);
      const entry = { url, method: request.method ?? 'GET', body: request.body,
        key: request.headers?.['Idempotence-Key'] };
      state.providerRequests.push(entry); // Never collect Authorization/credentials.
      if (options.vendor) return options.vendor(entry, request, state, time);
      const body = request.body ? JSON.parse(request.body) : null;
      const raw = { id: ids.provider, status: 'pending', paid: false, test: true,
        amount: { value: String(state.row.amount), currency: 'RUB' },
        metadata: body?.metadata ?? { localPaymentId: state.row.id, targetId: state.row.target_id,
          targetType: state.row.target_type, tariffId: input.tariffId },
        confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout?orderId=${ids.provider}` } };
      return new Response(JSON.stringify(raw));
    };
    function load(relative) {
      const filename = path.resolve(root, relative);
      if (cache.has(filename)) return cache.get(filename).exports;
      const module = { exports: {} };
      cache.set(filename, module);
      const js = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      function dependency(name) {
        if (name === '@/lib/supabase-rest') return { isSupabaseRestConfigured: () => true,
          isSupabaseServiceRoleConfigured: () => true,
          isUuid: value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value),
          supabaseRest: rest };
        if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name.endsWith('.ts') ? name : `${name}.ts`));
        return require(name);
      }
      new Function('require', 'module', 'exports', 'fetch', 'process', 'globalThis', 'crypto', 'Date', 'performance',
        'setTimeout', 'clearTimeout', js)(dependency, module, module.exports, fetch, { env }, globals,
        { ...webcrypto, subtle: webcrypto.subtle, randomUUID: () => serverOptions.paymentId ?? ids.payment }, time.Date, time.performance,
        time.setTimeout, time.clearTimeout);
      return module.exports;
    }
    return { provider: load('src/lib/payment-provider.ts'), store: load('src/lib/payment-store.ts'), load, env };
  }
  return { state, server, time, rpcResult };
}

function registerTests() {
  const test = require('node:test');
  test('stable control: fresh checkout preserves the committed amount/duration and owner', async () => {
    const h = harness();
    const payment = await h.server().provider.createPayment(input);
    assert.equal(payment.amount, 199.99);
    assert.equal(payment.userId, ids.owner);
    assert.equal(payment.purchasedDurationDays, 9);
    const body = JSON.parse(h.state.providerRequests[0].body);
    assert.equal(body.amount.value, '199.99');
    assert.equal(body.receipt.items[0].amount.value, '199.99');
    assert.equal(h.state.creates, 1);
  });
  test('RED: a new server graph must replay the COMPLETE original POST despite input/config drift', async () => {
    const h = harness({ row: paymentRow(), intent: intentRow() });
    h.state.tariff.price = 950;
    h.state.tariff.duration_days = 60;
    await h.server({ YOOKASSA_RECEIPT_VAT_CODE: '2', NEXT_PUBLIC_SITE_URL: 'https://changed.example.invalid' })
      .provider.createPayment({ ...input, targetTitle: 'Changed synthetic title', customerEmail: 'changed@example.invalid' });
    assert.equal(h.state.providerRequests[0].body, originalBody());
    assert.equal(h.state.creates, 0);
    assert.equal(h.state.row.purchased_duration_days, 9);
  });
  test('RED: lost first response then >24h must not produce a second POST/new local intent', async () => {
    let lose = true;
    const h = harness({ vendor: async (entry, request, state) => {
      assert.equal(entry.method, 'POST');
      state.remote.set(entry.key, entry.body); // Synthetic remote object, NOT a real charge.
      if (lose) return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('synthetic lost response')), { once: true }));
      return new Response(JSON.stringify({ id: ids.provider, status: 'pending', paid: false, test: true,
        amount: { value: '199.99', currency: 'RUB' }, metadata: JSON.parse(entry.body).metadata }));
    } });
    const first = assert.rejects(h.server().provider.createPayment(input), /timed out/i);
    await waitUntil(() => h.state.providerRequests.length === 1);
    await h.time.advance(35_000);
    await first;
    assert.equal(h.state.providerRequests.length, 1);
    lose = false;
    await h.time.advance(25 * 60 * 60_000);
    await assert.rejects(h.server().provider.createPayment(input), /manual|verification|reconciliation/i);
    assert.equal(h.state.providerRequests.length, 1);
    assert.equal(h.state.creates, 1);
    assert.equal(h.state.row.status, 'created');
  });
  test('RED: known provider ID without a URL is GET-only, never a blind create fallback', async () => {
    const h = harness({ row: paymentRow({ provider_payment_id: ids.provider, status: 'pending' }), intent: intentRow(),
      vendor: async () => new Response(JSON.stringify({ id: ids.provider, status: 'pending', paid: false, test: true,
        amount: { value: '199.99', currency: 'RUB' }, metadata: JSON.parse(originalBody()).metadata })) });
    const payment = await h.server().provider.createPayment(input);
    assert.equal(payment.providerPaymentId, ids.provider);
    assert.deepEqual(h.state.providerRequests.map(request => request.method), ['GET']);
    assert.equal(h.state.creates, 0);
  });
  test('RED: legacy UNKNOWN with no persisted body remains active and manual-gated', async () => {
    const h = harness({ row: paymentRow() });
    await assert.rejects(h.server().provider.createPayment(input), /manual|verification|reconciliation/i);
    assert.equal(h.state.providerRequests.length, 0);
    assert.equal(h.state.creates, 0);
    assert.equal(h.state.row.status, 'created');
  });
  test('stable control: authoritative pending verification never publishes', async () => {
    const h = harness({ row: paymentRow({ provider_payment_id: ids.provider, status: 'pending' }), intent: intentRow() });
    const result = await h.server().provider.confirmPayment(ids.payment, { trustSuccessfulReturn: true });
    assert.equal(result.payment.status, 'pending');
    assert.equal(h.state.effects, 0);
    assert.deepEqual(h.state.providerRequests.map(request => request.method), ['GET']);
  });
  test('a fresh snapshot and its hash commit before provider dispatch', async () => {
    const h = harness({ vendor: async (entry, _request, state) => {
      state.snapshotVisible = Boolean(state.intent && entry.body === state.intent.request_body && hash(entry.body) === state.intent.request_sha256);
      return new Response(JSON.stringify({ id: ids.provider, status: 'pending', paid: false, test: true,
        amount: { value: '199.99', currency: 'RUB' } }));
    } });
    await h.server().provider.createPayment(input);
    assert.equal(h.state.snapshotVisible, true, 'snapshot/hash must already be committed at dispatch');
  });
  test('within-window transport retries replay identical persisted bytes/key and reauthorize each dispatch', async () => {
    const h = harness({ vendor: async (entry, _request, state) => state.providerRequests.length === 1
      ? new Response('synthetic upstream failure', { status: 500 })
      : new Response(JSON.stringify({ id: ids.provider, status: 'pending', paid: false, test: true,
        amount: { value: '199.99', currency: 'RUB' }, metadata: JSON.parse(entry.body).metadata })) });
    const result = h.server().provider.createPayment(input);
    await waitUntil(() => h.state.providerRequests.length === 1);
    await h.time.advance(500);
    await result;
    assert.equal(h.state.providerRequests.length, 2);
    assert.equal(h.state.providerRequests[0].body, h.state.providerRequests[1].body);
    assert.equal(h.state.providerRequests[1].body, h.state.intent.request_body);
    assert.equal(h.state.providerRequests[0].key, ids.payment);
    assert.equal(h.state.providerRequests[1].key, ids.payment);
    assert.equal(h.state.requests.filter(entry => entry.resource.endsWith('/authorize_yookassa_checkout_attempt')).length, 3,
      'one initial read plus a fresh database authorization for both HTTP attempts');
  });
  test('a transport retry cannot POST when its new database authorization fails', async () => {
    const h = harness({ authorizeErrorAfter: 2, vendor: async () => new Response('synthetic failure', { status: 500 }) });
    const result = assert.rejects(h.server().provider.createPayment(input), /manual|verification/i);
    await waitUntil(() => h.state.providerRequests.length === 1);
    await h.time.advance(500);
    await result;
    assert.equal(h.state.providerRequests.length, 1);
    assert.equal(h.state.row.status, 'created');
  });
  test('snapshot preparation failure leaves the new payment active but never calls the merchant', async () => {
    const h = harness({ prepareError: true });
    await assert.rejects(h.server().provider.createPayment(input), /snapshot|verification|reconciliation/i);
    assert.equal(h.state.providerRequests.length, 0);
    assert.equal(h.state.row.status, 'created');
    assert.equal(h.state.intent, null);
  });
  test('existing complete receipt replays even when current receipt prerequisites are invalid', async () => {
    const h = harness({ row: paymentRow(), intent: intentRow() });
    await h.server({ YOOKASSA_RECEIPT_VAT_CODE: 'invalid' }).provider.createPayment({ ...input, customerEmail: undefined });
    assert.equal(h.state.providerRequests[0].body, originalBody());
  });
  test('changing the receipt-enabled flag cannot remove the original receipt', async () => {
    const h = harness({ row: paymentRow(), intent: intentRow() });
    await h.server({ YOOKASSA_RECEIPTS_ENABLED: 'false' }).provider.createPayment(input);
    assert.equal(h.state.providerRequests[0].body, originalBody());
  });
  for (const [name, env] of [['shop', { YOOKASSA_SHOP_ID: '888888' }], ['mode', { YOOKASSA_SECRET_KEY: 'live_synthetic_not_a_credential' }]]) {
    test(`new-ledger ${name} mismatch rejects BEFORE known-ID GET`, async () => {
      const h = harness({ row: paymentRow({ provider_payment_id: ids.provider, status: 'pending' }), intent: intentRow() });
      await assert.rejects(h.server(env).provider.confirmPayment(ids.payment), /merchant|binding|mode|verification/i);
      assert.equal(h.state.providerRequests.length, 0);
      assert.equal(h.state.row.status, 'pending');
    });
  }
  test('same-shop test-key rotation retains GET recovery', async () => {
    const h = harness({ row: paymentRow({ provider_payment_id: ids.provider, status: 'pending' }), intent: intentRow() });
    await h.server({ YOOKASSA_SECRET_KEY: 'test_rotated_synthetic_not_a_credential' }).provider.confirmPayment(ids.payment);
    assert.deepEqual(h.state.providerRequests.map(request => request.method), ['GET']);
  });
  test('authorized legacy known-ID exception permits GET only without inventing a ledger', async () => {
    const h = harness({ row: paymentRow({ provider_payment_id: ids.provider, status: 'pending' }) });
    await h.server().provider.createPayment(input);
    assert.deepEqual(h.state.providerRequests.map(request => request.method), ['GET']);
    assert.equal(h.state.intent, null);
  });
  test('legacy known-ID wrong merchant/404 cannot change finance or fall through to POST', async () => {
    const h = harness({ row: paymentRow({ provider_payment_id: ids.provider, status: 'pending' }),
      vendor: async () => new Response('{}', { status: 404 }) });
    await assert.rejects(h.server({ YOOKASSA_SHOP_ID: '888888' }).provider.confirmPayment(ids.payment), /YooKassa/i);
    assert.deepEqual(h.state.providerRequests.map(request => request.method), ['GET']);
    assert.equal(h.state.row.status, 'pending');
    assert.equal(h.state.effects, 0);
  });
  test('known canceled checkout updates truth and does not create another payment', async () => {
    const h = harness({ row: paymentRow({ provider_payment_id: ids.provider, status: 'pending' }), intent: intentRow(),
      vendor: async () => new Response(JSON.stringify({ id: ids.provider, status: 'canceled', paid: false, test: true,
        amount: { value: '199.99', currency: 'RUB' } })) });
    const payment = await h.server().provider.createPayment(input);
    assert.equal(payment.status, 'failed');
    assert.deepEqual(h.state.providerRequests.map(request => request.method), ['GET']);
    assert.equal(h.state.creates, 0);
  });
  test('a bad stored request hash fails closed without leaking receipt PII', async () => {
    const h = harness({ row: paymentRow(), intent: intentRow({ request_sha256: '0'.repeat(64) }) });
    await assert.rejects(h.server().provider.createPayment(input), error => {
      assert.match(error.message, /snapshot|verification|reconciliation/i);
      assert.equal(error.message.includes(input.customerEmail), false);
      return true;
    });
    assert.equal(h.state.providerRequests.length, 0);
  });
  test('23h55 exclusive cutoff rejects UNKNOWN exactly at the deadline', async () => {
    const h = harness({ row: paymentRow(), intent: intentRow() });
    await h.time.advance(cutoffMs);
    await assert.rejects(h.server().provider.createPayment(input), /manual|verification|reconciliation/i);
    assert.equal(h.state.providerRequests.length, 0);
  });
  test('RPC round-trip exhaustion rejects a formerly eligible authorization before POST', async () => {
    const h = harness({ row: paymentRow(), intent: intentRow(), rpcDelayMs: 1200 });
    await h.time.advance(cutoffMs - 1000);
    const rejection = assert.rejects(h.server().provider.createPayment(input), /manual|verification|reconciliation|expired/i);
    await h.time.advance(1200);
    await rejection;
    assert.equal(h.state.providerRequests.length, 0);
  });
  test('actual store subtracts the complete monotonic RPC round trip before returning POST permission', async () => {
    const h = harness({ row: paymentRow(), intent: intentRow(), rpcDelayMs: 1200 });
    const store = h.server().store;
    const payment = await store.getStoredPayment(ids.payment);
    await h.time.advance(cutoffMs - 1000);
    const rejected = assert.rejects(store.authorizeStoredYooKassaCheckoutAttempt(payment, { shopId: '999999', isTest: true }), /manual|verification/i);
    await h.time.advance(1200);
    await rejected;
    assert.equal(h.state.providerRequests.length, 0);
  });
  test('application wall-clock jumps cannot redefine the database retry interval', async () => {
    const h = harness({ row: paymentRow(), intent: intentRow() });
    h.time.jumpWall(-10 * 24 * 60 * 60_000);
    await h.server().provider.createPayment(input);
    assert.equal(h.state.providerRequests[0].body, originalBody());
  });
  test('public payment DTO/list reads do not include private request or merchant fields', async () => {
    const h = harness({ row: paymentRow(), intent: intentRow() });
    const values = [await h.server().store.getStoredPayment(ids.payment), await h.server().store.listStoredPaymentsForUser(ids.owner)];
    const json = JSON.stringify(values);
    for (const needle of [input.customerEmail, 'request_body', 'request_sha256', 'merchant_shop_id', 'first_attempt_authorized_at']) {
      assert.equal(json.includes(needle), false);
    }
  });
}

module.exports = { harness, clock, ids, input, cutoffMs, paymentRow, intentRow, originalBody, hash, flush };
if (require.main === module) registerTests();
