const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');

const root = resolve(__dirname, '..');
const paymentId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';
const tariffId = '44444444-4444-4444-8444-444444444444';
const providerId = '55555555-5555-4555-8555-555555555555';
const capturedAt = '2026-10-07T10:20:30.123456Z';
const appliedAt = '2026-10-07T10:21:31.123456Z';
const clone = (value) => structuredClone(value);
const flush = async () => {
  // Native Response body consumption can complete on a host event-loop turn.
  // Yield without advancing the synthetic clock or application deadlines.
  for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < 100; i++) await Promise.resolve();
    await new Promise(setImmediate);
  }
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Execute COMPLETE actual provider/store/queue/REST/outcome modules recursively.
// Only HTTP, framework/auth edges and the monotonic clock/timers are synthetic.
// Slot/window responses below are wire fixtures, NOT a replacement for real PG
// capacity, locking, financial immutability or expiry tests owned by integration.
function harness(options = {}) {
  const row = { id: paymentId, user_id: ownerId, target_type: 'ad_marquee', target_id: targetId,
    tariff_id: tariffId, amount: 199, provider: 'yookassa', provider_payment_id: providerId,
    status: 'pending', created_at: '2026-10-07T10:00:00Z', paid_at: null,
    purchased_duration_days: 9, fulfillment_status: 'pending', fulfillment_reason: null,
    target_applied_at: null, ...options.row };
  const placement = { id: targetId, user_id: ownerId, payment_id: paymentId,
    payment_status: row.fulfillment_status === 'applied' ? 'succeeded' : 'pending',
    status: row.fulfillment_status === 'applied' ? 'paid' : 'pending_payment',
    starts_at: null, ends_at: null, ...options.placement };
  const state = { row, placement, requests: [], providerMethods: [], fulfillmentWrites: 0,
    queueCalls: 0, placementReads: 0, now: 0, activeIds: [], ...options.state };
  const timers = new Map();
  let timerId = 0;
  const clock = {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, due: state.now + delay, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      state.now += ms;
      for (const [id, timer] of [...timers]) if (timer.due <= state.now) { timers.delete(id); timer.fn(); }
    },
  };
  const stall = (signal) => new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('synthetic transport aborted'));
    else signal.addEventListener('abort', () => reject(new Error('synthetic transport aborted')), { once: true });
  });
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
  const fulfillmentResponse = () => [{ payment_id: row.id, financial_status: row.status,
    fulfillment_status: row.fulfillment_status, fulfillment_reason: row.fulfillment_reason,
    paid_at: row.paid_at, target_applied_at: row.target_applied_at,
    applied_now: state.fulfillmentWrites === 1, target_status: row.fulfillment_status === 'applied'
      ? row.target_type === 'ad_marquee' ? 'paid' : 'published' : null }];
  function commitFulfillment() {
    if (row.fulfillment_status === 'pending') {
      state.fulfillmentWrites++;
      row.fulfillment_status = 'applied';
      row.target_applied_at = appliedAt;
      placement.status = 'paid';
      placement.payment_status = 'succeeded';
    }
  }
  const fetch = async (url, request = {}) => {
    const parsed = new URL(url);
    const method = request.method ?? 'GET';
    const body = request.body ? JSON.parse(request.body) : undefined;
    const path = parsed.pathname;
    const currentTimer = [...timers.values()].at(-1);
    state.requests.push({ path, query: parsed.searchParams.toString(), method, body,
      timeout: currentTimer?.delay, at: state.now });
    if (parsed.origin === 'https://api.yookassa.ru') {
      state.providerMethods.push(method);
      assert.equal(method, 'GET', 'This slice must never create another merchant payment');
      return response({ id: providerId, status: options.providerStatus ?? 'succeeded',
        paid: !options.providerStatus || options.providerStatus === 'succeeded', test: false,
        amount: { value: '199.00', currency: 'RUB' }, ...(!options.providerStatus || options.providerStatus === 'succeeded' ? { captured_at: capturedAt } : {}),
        metadata: { localPaymentId: paymentId, targetId, targetType: row.target_type } });
    }
    assert.equal(parsed.origin, 'https://fixture.invalid', 'No outbound network boundary is allowed');
    if (path === '/rest/v1/rpc/authorize_yookassa_checkout_attempt') {
      return response([{ payment_id: paymentId, decision: 'legacy_recover', provider_payment_id: providerId }]);
    }
    if (path === '/rest/v1/payments') {
      if (method === 'PATCH') {
        const status = row.status === 'refunded' ? 'refunded'
          : row.status === 'succeeded' && body.status !== 'refunded' ? 'succeeded' : body.status;
        Object.assign(row, body, { status, paid_at: row.paid_at ?? body.paid_at });
      } else assert.equal(method, 'GET');
      return response([clone(row)]);
    }
    if (path === '/rest/v1/tariffs') return response([{ id: tariffId, action: row.target_type === 'ad_marquee'
      ? 'ad_marquee' : 'listing_publication', name: 'Current offer', price: 999, duration_days: 7, active: true }]);
    if (path === '/rest/v1/rpc/apply_payment_fulfillment') {
      assert.equal(row.status, 'succeeded');
      if (options.beforeFulfillmentCommit) await options.beforeFulfillmentCommit.promise;
      if (options.fulfillmentError) throw new Error('synthetic fulfillment rollback');
      commitFulfillment();
      if (options.lostFulfillmentResponse) throw new Error('synthetic lost committed fulfillment response');
      return response(fulfillmentResponse());
    }
    if (path === '/rest/v1/rpc/reconcile_ad_marquee_queue') {
      state.queueCalls++;
      assert.equal(row.fulfillment_status, 'applied', 'Queue must follow the durable fulfillment COMMIT');
      assert.ok(row.target_applied_at, 'Queue must not run against an invented applied marker');
      if (options.queueStall) return stall(request.signal);
      if (options.queueError) return response({ message: 'synthetic queue outage' }, 503);
      if (options.queueAdvance) clock.advance(options.queueAdvance);
      if ((options.activeCount ?? 0) < 5 && placement.status === 'paid') {
        placement.status = 'active';
        placement.starts_at = '2026-10-08T12:00:00Z';
        placement.ends_at = '2026-10-17T12:00:00Z';
      }
      state.activeIds = placement.status === 'active' ? [{ id: targetId }] : [];
      if (options.lostQueueResponse) throw new Error('synthetic lost committed queue response');
      const ids = options.queueIds ?? state.activeIds;
      if (options.queueBodyStall) return { ok: true, status: 200, text: () => new Promise(() => {}) };
      if (options.queueBodyAdvance) return { ok: true, status: 200, text: async () => {
        clock.advance(options.queueBodyAdvance); return JSON.stringify(ids);
      } };
      return response(ids);
    }
    if (path === '/rest/v1/ad_marquee_placements') {
      state.placementReads++;
      if (parsed.searchParams.has('user_id') && parsed.searchParams.has('payment_id')) {
        assert.equal(parsed.searchParams.get('id'), `eq.${targetId}`);
        assert.equal(parsed.searchParams.get('user_id'), `eq.${ownerId}`);
        assert.equal(parsed.searchParams.get('payment_id'), `eq.${paymentId}`);
        assert.equal(parsed.searchParams.get('limit'), '1');
      }
      if (options.readStall) return stall(request.signal);
      if (options.readError) return response({ message: 'synthetic placement outage' }, 503);
      const result = options.readRows ?? [clone(placement)];
      if (options.readBodyStall) return { ok: true, status: 200, text: () => new Promise(() => {}) };
      if (options.readBodyAdvance) return { ok: true, status: 200, text: async () => {
        clock.advance(options.readBodyAdvance); return JSON.stringify(result);
      } };
      return response(result);
    }
    assert.fail(`Unexpected actual HTTP boundary: ${method} ${path}`);
  };
  const modules = new Map();
  const context = vm.createContext({ console, Promise, Response, Request, URL, Error, AbortController, Buffer, TextDecoder, TextEncoder,
    crypto: webcrypto, performance: { now: () => state.now },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, fetch,
    process: { env: { NODE_ENV: 'production', PAYMENT_PROVIDER: 'yookassa',
      YOOKASSA_SHOP_ID: 'fixture-shop', YOOKASSA_SECRET_KEY: 'live_fixture_only',
      NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-only',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-only', NEXT_PUBLIC_SITE_URL: 'https://example.invalid' } } });
  function load(relative) {
    const filename = resolve(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const js = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInContext(`(function(require,module,exports){${js}\n})`, context, { filename })(
      (id) => {
        if (id === 'next/server') return { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
        if (id === 'next/cache') return { revalidatePath() {} };
        if (id === '@/lib/server-auth') return { isSupabaseServerConfigured: () => true,
          getAuthenticatedRequestUser: async () => ({ user: { id: ownerId } }), isAdminRequest: async () => false };
        if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
        const base = id.startsWith('@/') ? resolve(root, 'src', id.slice(2)) : resolve(dirname(filename), id);
        const dependency = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => /\.(ts|tsx)$/.test(candidate) && existsSync(candidate));
        assert.ok(dependency, `Actual source dependency must exist: ${id}`);
        return load(dependency);
      }, module, module.exports);
    return module.exports;
  }
  const provider = load('src/lib/payment-provider.ts');
  return { state, clock, load, confirm: () => provider.confirmPayment(paymentId),
    webhook: () => load('src/app/api/payments/yookassa/webhook/route.ts').POST(new Request('https://example.invalid/webhook',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        type: 'notification', event: 'payment.succeeded', object: { id: providerId } }) })) };
}

function assertApplied(result, h) {
  assert.equal(result.payment.status, 'succeeded');
  assert.equal(result.payment.fulfillmentStatus, 'applied');
  assert.equal(result.payment.targetAppliedAt, appliedAt);
  assert.equal(result.payment.paidAt, capturedAt);
  assert.equal(h.state.row.amount, 199);
  assert.ok(h.state.providerMethods.every((method) => method === 'GET'));
}

for (const activeCount of [0, 4, 5]) test(`post-commit trigger honors committed ${activeCount}/5 occupied wire response`, async () => {
  const h = harness({ activeCount });
  const result = await h.confirm();
  assertApplied(result, h);
  assert.equal(h.state.queueCalls, 1);
  assert.equal(h.state.placementReads, 1);
  assert.equal(result.nextStatus, activeCount < 5 ? 'active' : 'paid');
  assert.equal(h.state.placement.starts_at, activeCount < 5 ? '2026-10-08T12:00:00Z' : null);
});

test('queue cannot run before the pending fulfillment COMMIT barrier opens', async () => {
  const barrier = deferred();
  const h = harness({ beforeFulfillmentCommit: barrier });
  const running = h.confirm();
  await flush();
  assert.equal(h.state.row.fulfillment_status, 'pending');
  assert.equal(h.state.queueCalls, 0);
  barrier.resolve();
  const result = await running;
  assertApplied(result, h);
  assert.equal(result.nextStatus, 'active');
  assert.equal(h.state.queueCalls, 1);
});

test('lost committed fulfillment response recovers durable applied truth then triggers queue', async () => {
  const h = harness({ lostFulfillmentResponse: true });
  const result = await h.confirm();
  assertApplied(result, h);
  assert.equal(h.state.queueCalls, 1);
  assert.equal(result.nextStatus, 'active');
});

test('applied replay reconciles without a second fulfillment write or restarted window', async () => {
  const h = harness();
  const first = await h.confirm();
  const window = [h.state.placement.starts_at, h.state.placement.ends_at];
  const replay = await h.confirm();
  assertApplied(replay, h);
  assert.equal(first.nextStatus, 'active');
  assert.equal(replay.nextStatus, 'active');
  assert.equal(h.state.fulfillmentWrites, 1);
  assert.equal(h.state.queueCalls, 2);
  assert.deepEqual([h.state.placement.starts_at, h.state.placement.ends_at], window);
});

for (const options of [{ queueError: true }, { lostQueueResponse: true }, { readError: true }]) {
  test(`queue/read unknown ${Object.keys(options)[0]} preserves applied finance without false activation`, async () => {
    const h = harness(options);
    const result = await h.confirm();
    assertApplied(result, h);
    assert.equal(h.state.queueCalls, 1);
    assert.equal(result.nextStatus, undefined);
    assert.equal(h.load('src/lib/payment-confirmation-outcome.ts').getPaymentConfirmationOutcome(result).kind, 'queue_pending');
    assert.doesNotMatch(result.notification.body, /размещение подтверждено|активирована|услуга применена/);
    assert.equal(h.state.requests.filter((r) => r.path.includes('reconcile_ad_marquee_queue')).length, 1);
    assert.ok(h.state.placementReads <= 1, 'No implicit GET retry may extend the shared deadline');
  });
}

for (const [label, options] of [
  ['wrong owner', { readRows: [{ id: targetId, user_id: 'another-owner', payment_id: paymentId, status: 'active', payment_status: 'succeeded' }] }],
  ['wrong payment', { readRows: [{ id: targetId, user_id: ownerId, payment_id: 'another-payment', status: 'active', payment_status: 'succeeded' }] }],
  ['wrong target', { readRows: [{ id: ownerId, user_id: ownerId, payment_id: paymentId, status: 'active', payment_status: 'succeeded' }] }],
  ['refunded current placement', { readRows: [{ id: targetId, user_id: ownerId, payment_id: paymentId, status: 'active', payment_status: 'refunded' }] }],
  ['archived after queue commit', { readRows: [{ id: targetId, user_id: ownerId, payment_id: paymentId, status: 'archived', payment_status: 'succeeded' }] }],
  ['missing row', { readRows: [] }],
  ['active absent from committed queue IDs', { queueIds: [] }],
  ['malformed committed queue IDs', { queueIds: [{ id: 'not-a-uuid' }] }],
]) test(`unconfirmed current placement: ${label} never claims active/paid`, async () => {
  const h = harness(options);
  const result = await h.confirm();
  assertApplied(result, h);
  assert.equal(h.state.queueCalls, 1);
  assert.equal(result.nextStatus, undefined);
});

for (const [label, options] of [
  ['authoritative pending', { providerStatus: 'pending' }],
  ['refunded', { row: { status: 'refunded', paid_at: capturedAt } }],
  ['blocked', { row: { status: 'succeeded', paid_at: capturedAt, fulfillment_status: 'blocked', fulfillment_reason: 'target_owner_mismatch' } }],
  ['non-marquee applied', { row: { target_type: 'listing' } }],
  ['fulfillment rollback', { fulfillmentError: true }],
]) test(`healthy negative control: ${label} does not touch queue`, async () => {
  const h = harness(options);
  await h.confirm();
  assert.equal(h.state.queueCalls, 0);
  assert.equal(h.state.placementReads, 0);
});

test('queue POST uses the 8s deadline and a real transport AbortSignal', async () => {
  const h = harness({ queueStall: true });
  const running = h.confirm();
  await flush();
  assert.equal(h.state.queueCalls, 1);
  const queue = h.state.requests.find((r) => r.path.includes('reconcile_ad_marquee_queue'));
  assert.equal(queue.timeout, 8000);
  h.clock.advance(8000);
  const result = await running;
  assertApplied(result, h);
  assert.equal(result.nextStatus, undefined);
  assert.equal(h.state.placementReads, 0);
});

test('placement GET receives only the unspent monotonic budget and aborts once', async () => {
  const h = harness({ queueAdvance: 6000, readStall: true });
  const running = h.confirm();
  await flush();
  assert.equal(h.state.placementReads, 1);
  const read = h.state.requests.find((r) => r.path === '/rest/v1/ad_marquee_placements');
  assert.equal(read.timeout, 2000);
  h.clock.advance(2000);
  const result = await running;
  assertApplied(result, h);
  assert.equal(result.nextStatus, undefined);
  assert.equal(h.state.placementReads, 1);
  assert.equal(h.state.now, 8000);
});

for (const options of [{ queueBodyAdvance: 8000 }, { readBodyAdvance: 8000 }]) {
  test(`post-body deadline ${Object.keys(options)[0]} rejects even a late successful transport`, async () => {
    const h = harness(options);
    const result = await h.confirm();
    assertApplied(result, h);
    assert.equal(h.state.queueCalls, 1);
    assert.equal(result.nextStatus, undefined);
    if (options.queueBodyAdvance) assert.equal(h.state.placementReads, 0);
  });
}

test('queue outage after applied fulfillment is webhook ACK200, not false financial-pending503', async () => {
  const h = harness({ queueError: true });
  const result = await h.webhook();
  assert.equal(result.status, 200);
  assert.equal(h.state.row.status, 'succeeded');
  assert.equal(h.state.row.fulfillment_status, 'applied');
  assert.equal(h.state.queueCalls, 1);
});

test('public homepage read remains read-only and cannot substitute for the payment trigger', async () => {
  const h = harness({ activeCount: 5 });
  await h.load('src/lib/ad-marquee-store.ts').getActiveAdMarqueeMessages();
  assert.equal(h.state.queueCalls, 0);
  assert.ok(h.state.requests.every((r) => r.method === 'GET'));
});

for (const options of [{ queueBodyStall: true }, { readBodyStall: true }]) {
  test(`shared caller deadline bounds an uncooperative body: ${Object.keys(options)[0]}`, async () => {
    const h = harness(options);
    let settled = false;
    let result;
    const running = h.confirm().then((value) => { settled = true; result = value; });
    await flush();
    assert.equal(h.state.queueCalls, 1);
    h.clock.advance(8000);
    await flush();
    assert.equal(settled, true, 'The caller must settle even when response body ignores transport abort');
    await running;
    assertApplied(result, h);
    assert.equal(result.nextStatus, undefined);
    if (options.queueBodyStall) assert.equal(h.state.placementReads, 0);
  });
}
