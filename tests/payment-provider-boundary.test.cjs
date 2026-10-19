const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const localId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const providerId = '2b3f5e11-000f-5000-8000-123456789abc';
const otherProviderId = '2b3f5e22-000f-5000-8000-123456789abc';
const checkoutUrl = `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${providerId}`;
const createInput = { tariffId: 'listing-publication', targetId, userId, targetType: 'listing', targetTitle: 'Синтетическая публикация', customerEmail: 'payer@example.test' };
const clone = value => structuredClone(value);
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

function observeSettlement(promise) {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  return () => settled;
}

function syntheticClock() {
  let now = Date.UTC(2026, 9, 7, 12);
  let nextId = 0;
  const timers = new Map();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  return {
    Date: FixedDate,
    timers,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(milliseconds) {
      const end = now + milliseconds;
      await flush();
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

function localPayment(overrides = {}) {
  return {
    id: localId, userId, targetType: 'listing', targetId, targetTitle: 'Синтетическая публикация',
    tariffId: 'listing-publication', amount: 300, status: 'pending', provider: 'yookassa',
    providerPaymentId: providerId, createdAt: '2026-10-07', ...overrides,
  };
}

function yooPayment(overrides = {}) {
  return {
    id: providerId, status: 'pending', amount: { value: '300.00', currency: 'RUB' }, paid: false, test: true,
    created_at: '2026-10-07T12:00:00.000Z', refundable: false, recipient: { account_id: '999999', gateway_id: '999999' },
    confirmation: { type: 'redirect', confirmation_url: checkoutUrl },
    metadata: { localPaymentId: localId, targetId, targetType: 'listing', tariffId: 'listing-publication' },
    ...(overrides.status === 'succeeded' ? { captured_at: '2026-10-07T12:00:00.000Z' } : {}),
    ...overrides,
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

// Explicit new-intent fixture bytes, not a production reconstruction of old UNKNOWN rows.
function originalCheckoutFixture(amount = '199.99') {
  return JSON.stringify({ amount: { value: amount, currency: 'RUB' }, capture: true,
    confirmation: { type: 'redirect', return_url: `https://example.test/oplata/${localId}` },
    description: createInput.targetTitle,
    receipt: { customer: { email: createInput.customerEmail }, internet: true, items: [{
      description: `Услуга размещения: ${createInput.targetTitle}`, quantity: 1, amount: { value: amount, currency: 'RUB' },
      vat_code: 1, payment_mode: 'full_payment', payment_subject: 'service',
    }] }, metadata: { localPaymentId: localId, targetId, targetType: 'listing', tariffId: createInput.tariffId } });
}

function loadProvider({ payment = localPayment(), active, tariff: tariffChanges, fetched, fetchImplementation, production = true, secret = 'test_synthetic_not_a_credential', receiptEnabled = false, storedSnapshot, createError, findActiveImplementation, snapshotBody } = {}) {
  const clock = syntheticClock();
  const counters = { requests: [], updates: [], targets: [], creations: [], logs: [] };
  const tariff = { id: 'listing-publication', name: 'Синтетический тариф', action: 'listing_publication', price: 300, durationDays: 30, active: true, ...tariffChanges };
  const current = clone(payment);
  const activePayment = active && clone(active);
  let checkoutBody = snapshotBody;
  const stubs = {
    '@/lib/yookassa-payment-contract': require('./yookassa-contract-module.cjs'),
    '@/lib/yookassa-transport': require('./yookassa-transport-module.cjs'),
    '@/lib/mock-store': { listMockPayments: () => [], markPaymentTargetSucceeded: () => { throw new Error('Unexpected mock fulfillment'); } },
    '@/lib/payment-store': {
      canStorePayment: input => Boolean(input.targetId),
      prepareStoredYooKassaCheckoutIntent: async (_payment, body) => { checkoutBody = body; return { decision: 'post', requestBody: body, remainingMs: 3_600_000 }; },
      authorizeStoredYooKassaCheckoutAttempt: async payment => {
        if (payment.providerPaymentId) return { decision: 'legacy_recover', providerPaymentId: payment.providerPaymentId };
        assert.ok(checkoutBody, 'UNKNOWN fixture requires an explicit complete original snapshot');
        return { decision: 'post', requestBody: checkoutBody, remainingMs: 3_600_000 };
      },
      createStoredPayment: async input => {
        counters.creations.push(clone(input));
        if (createError) throw createError;
        return localPayment({ id: input.id, userId: input.userId, targetId: input.targetId, targetType: input.targetType,
          targetTitle: input.targetTitle, tariffId: input.tariff.id, amount: input.amount, status: input.status, providerPaymentId: undefined, ...storedSnapshot });
      },
      findActiveStoredPaymentForTarget: async () => findActiveImplementation ? findActiveImplementation() : activePayment,
      findStoredPaymentByProvider: async id => id === current.providerPaymentId ? current : undefined,
      getStoredPayment: async id => id === current.id ? current : undefined,
      listStoredPayments: async () => [],
      updateStoredPayment: async value => { counters.updates.push(clone(value)); return value; },
      applyStoredPaymentFulfillment: async value => {
        if (!value.targetAppliedAt) counters.targets.push(clone(value));
        value.targetAppliedAt ??= '2026-10-07T12:01:00.000Z';
        value.fulfillmentStatus = 'applied';
        return { payment: value, nextStatus: 'published' };
      },
    },
    '@/lib/runtime-mode': { shouldAllowMockPayments: () => !production },
    '@/lib/site-url': { getPublicSiteUrl: () => 'https://example.test' },
    '@/lib/supabase-rest': { isSupabaseRestConfigured: () => true },
    '@/lib/tariff-store': { getActiveStoredTariffById: async () => tariff },
  };
  const filename = path.join(__dirname, '../src/lib/payment-provider.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const js = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText;
  let validateResponse;
  const module = { exports: {} };
  // Full implementation is executed; only I/O boundaries and time are synthetic.
  // Fetch is a lexical dependency, never a global override or a real API call.
  // The test-only hook captures the actual private validator, without changing its source or production exports.
  new Function('require', 'module', 'exports', 'fetch', 'process', 'Date', 'setTimeout', 'clearTimeout', 'console', 'crypto', 'captureValidator', `${js}\ncaptureValidator(validateYooKassaPayment);`)(
    name => { assert.ok(name in stubs, `Unexpected dependency ${name}`); return stubs[name]; }, module, module.exports,
    async (url, init) => {
      assert.match(url, /^https:\/\/api\.yookassa\.ru\/v3\/payments(?:\/[a-f0-9-]+)?$/i);
      counters.requests.push({ url, init });
      return fetchImplementation ? fetchImplementation(url, init, counters.requests.length) : jsonResponse(fetched ?? yooPayment());
    },
    { env: { NODE_ENV: production ? 'production' : 'test', PAYMENT_PROVIDER: 'yookassa', YOOKASSA_SHOP_ID: '999999', YOOKASSA_SECRET_KEY: secret,
      YOOKASSA_RECEIPTS_ENABLED: String(receiptEnabled), YOOKASSA_RECEIPT_VAT_CODE: '1' } },
    clock.Date, clock.setTimeout, clock.clearTimeout,
    { error: (...args) => counters.logs.push(args) }, { randomUUID: () => localId },
    validator => { validateResponse = payload => validator(payload, current, secret); },
  );
  return { provider: module.exports, counters, clock, payment: current, active: activePayment, tariff, validateResponse };
}

test('a stalled provider fetch is aborted and rejected within one total 35 second budget', async () => {
  const fixture = loadProvider({ fetchImplementation: () => new Promise(() => {}) });
  const outcome = fixture.provider.confirmPayment(localId);
  const settled = observeSettlement(outcome);
  const rejected = assert.rejects(outcome, /YooKassa.*timed out/i);
  await flush();
  assert.ok(fixture.counters.requests[0].init.signal instanceof AbortSignal, 'Every request must have an actual abort signal');
  await fixture.clock.advance(35_000);
  assert.equal(settled(), true, 'The total deadline must settle the operation, not merely schedule an eventual timeout');
  await rejected;
  assert.equal(fixture.counters.requests[0].init.signal.aborted, true);
  assert.equal(fixture.counters.requests.length, 1);
  assert.deepEqual(fixture.counters.updates, []);
  assert.deepEqual(fixture.counters.targets, []);
  assert.equal(fixture.clock.timers.size, 0);
});

test('headers arriving before the deadline do not leave a stalled response body unbounded', async () => {
  let canceled = 0;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"id":')); }, cancel() { canceled++; } });
  const fixture = loadProvider({ fetchImplementation: () => new Response(body, { status: 200 }) });
  const outcome = fixture.provider.confirmPayment(localId);
  const settled = observeSettlement(outcome);
  const rejected = assert.rejects(outcome, /YooKassa.*timed out/i);
  await flush();
  assert.ok(fixture.counters.requests[0].init.signal instanceof AbortSignal);
  await fixture.clock.advance(35_000);
  assert.equal(settled(), true, 'The decoded body must share the fetch deadline');
  await rejected;
  assert.equal(canceled, 1);
  assert.deepEqual(fixture.counters.updates, []);
  assert.deepEqual(fixture.counters.targets, []);
});

test('a decoded response larger than 64 KiB fails closed even when Content-Length lies', async () => {
  const fixture = loadProvider({ fetchImplementation: () => jsonResponse(yooPayment({ unused: 'x'.repeat(65_536) }), 200, { 'Content-Length': '1' }) });
  await assert.rejects(() => fixture.provider.confirmPayment(localId), /YooKassa.*response.*too large/i);
  assert.equal(fixture.counters.requests.length, 1);
  assert.deepEqual(fixture.counters.updates, []);
  assert.deepEqual(fixture.counters.targets, []);
});

test('permanent HTTP failures are not retried and never expose provider descriptions', async () => {
  const fixture = loadProvider({ fetchImplementation: () => jsonResponse({ id: otherProviderId, description: 'Basic test_synthetic_not_a_credential private-provider-detail' }, 401) });
  let failure;
  try { await fixture.provider.confirmPayment(localId); } catch (error) { failure = error; }
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /YooKassa.*401/);
  assert.doesNotMatch(failure.message, /private-provider-detail|test_synthetic/);
  assert.equal(fixture.counters.requests.length, 1);
  assert.deepEqual(fixture.counters.updates, []);
});

const invalidFetchedObjects = [
  ['wrong provider ID', { id: otherProviderId }],
  ['missing provider ID', { id: undefined }],
  ['non-string provider ID', { id: 123 }],
  ['malformed provider ID', { id: 'not-a-payment-id' }],
  ['missing amount', { amount: undefined }],
  ['non-object amount', { amount: '300.00' }],
  ['wrong amount', { amount: { value: '299.99', currency: 'RUB' } }],
  ['wrong currency', { amount: { value: '300.00', currency: 'USD' } }],
  ['numeric amount value', { amount: { value: 300, currency: 'RUB' } }],
  ['exponent amount value', { amount: { value: '3e2', currency: 'RUB' } }],
  ['sub-kopeck amount value', { amount: { value: '300.001', currency: 'RUB' } }],
  ['missing paid flag', { paid: undefined }],
  ['string paid flag', { paid: 'true' }],
  ['pending paid payment', { status: 'pending', paid: true }],
  ['unpaid successful payment', { status: 'succeeded', paid: false }],
  ['paid canceled payment', { status: 'canceled', paid: true }],
  ['unpaid authorized payment', { status: 'waiting_for_capture', paid: false }],
  ['unknown status', { status: 'refunded' }],
  ['missing test flag', { test: undefined }],
  ['string test flag', { test: 'true' }],
  ['merchant mode mismatch', { test: false }],
  ['wrong local binding', { metadata: { localPaymentId: otherProviderId } }],
  ['wrong target binding', { metadata: { targetId: otherProviderId } }],
  ['wrong target type binding', { metadata: { targetType: 'vacancy' } }],
  ['wrong tariff binding', { metadata: { tariffId: 'another-tariff' } }],
  ['null local binding', { metadata: { localPaymentId: null } }],
  ['array metadata', { metadata: [] }],
  ['oversized metadata key', { metadata: { ['x'.repeat(33)]: 'value' } }],
  ['oversized metadata value', { metadata: { note: 'x'.repeat(513) } }],
  ['too many metadata entries', { metadata: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`key${index}`, 'value'])) }],
  ['nested metadata value', { metadata: { note: { injected: true } } }],
  ['null metadata object', { metadata: null }],
  ['untyped confirmation', { confirmation: { confirmation_url: checkoutUrl } }],
  ['wrong confirmation type', { confirmation: { type: 'embedded', confirmation_url: checkoutUrl } }],
  ['non-string confirmation URL', { confirmation: { type: 'redirect', confirmation_url: { url: checkoutUrl } } }],
  ['javascript confirmation URL', { confirmation: { type: 'redirect', confirmation_url: 'javascript:alert(1)' } }],
  ['HTTP confirmation URL', { confirmation: { type: 'redirect', confirmation_url: 'http://yoomoney.ru/checkout' } }],
  ['unapproved confirmation host', { confirmation: { type: 'redirect', confirmation_url: 'https://unapproved.example.test/checkout' } }],
  ['lookalike confirmation host', { confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru.example.test/checkout' } }],
  ['confirmation URL credentials', { confirmation: { type: 'redirect', confirmation_url: 'https://user:password@yoomoney.ru/checkout' } }],
  ['confirmation URL control character', { confirmation: { type: 'redirect', confirmation_url: '\u0001https://yoomoney.ru/checkout' } }],
  ['confirmation URL nondefault port', { confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru:8443/checkout' } }],
  ['oversized confirmation URL', { confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/${'x'.repeat(2048)}` } }],
];

for (const [description, overrides] of invalidFetchedObjects) {
  test(`rejects ${description} before any local payment or target mutation`, async () => {
    const fixture = loadProvider({ fetched: yooPayment(overrides) });
    const before = clone(fixture.payment);
    await assert.rejects(() => fixture.provider.confirmPayment(localId), /YooKassa/i);
    assert.deepEqual(fixture.payment, before);
    assert.deepEqual(fixture.counters.updates, []);
    assert.deepEqual(fixture.counters.targets, []);
    assert.equal(fixture.counters.requests.length, 1);
  });
}

test('valid fractional RUB settlement preserves exact original amount, owner and timestamp precision', async () => {
  const fixture = loadProvider({ payment: localPayment({ amount: 199.99 }), fetched: yooPayment({
    amount: { value: '199.99', currency: 'RUB' }, status: 'succeeded', paid: true, confirmation: undefined,
  }) });
  const result = await fixture.provider.confirmPayment(localId);
  assert.equal(result.payment.amount, 199.99);
  assert.equal(result.payment.userId, userId);
  assert.equal(result.payment.paidAt, '2026-10-07T12:00:00.000Z');
  assert.equal(fixture.counters.targets.length, 1);
  assert.equal(fixture.clock.timers.size, 0);
});

test('waiting-for-capture remains pending even though funds are authorized', async () => {
  const fixture = loadProvider({ fetched: yooPayment({ status: 'waiting_for_capture', paid: true, confirmation: undefined }) });
  const result = await fixture.provider.confirmPayment(localId);
  assert.equal(result.payment.status, 'pending');
  assert.deepEqual(fixture.counters.targets, []);
});

test('test merchant responses remain supported in production but live merchant credentials reject test responses', async () => {
  const testMerchant = loadProvider({ fetched: yooPayment({ status: 'succeeded', paid: true }) });
  assert.equal((await testMerchant.provider.confirmPayment(localId)).payment.status, 'succeeded');
  assert.equal(testMerchant.provider.canForceSucceedYooKassaReturn(), false);
  const liveMerchant = loadProvider({ secret: 'live_synthetic_not_a_credential' });
  await assert.rejects(() => liveMerchant.provider.confirmPayment(localId), /YooKassa/i);
  assert.deepEqual(liveMerchant.counters.updates, []);
  assert.deepEqual(liveMerchant.counters.targets, []);
});

test('official nullable unrelated metadata remains valid while absent binding keys are not invented', async () => {
  const fixture = loadProvider({ fetched: yooPayment({ metadata: { nullableVendorNote: null, note: 'x'.repeat(512) } }) });
  const result = await fixture.provider.confirmPayment(localId);
  assert.equal(result.payment.status, 'pending');
  assert.equal(fixture.counters.updates.length, 1);
});

test('a newly persisted representation owns the provider charge, receipt and returned payment', async () => {
  const fixture = loadProvider({ receiptEnabled: true, storedSnapshot: { amount: 199.99 },
    fetched: yooPayment({ amount: { value: '199.99', currency: 'RUB' } }) });
  const payment = await fixture.provider.createPayment(createInput);
  const body = JSON.parse(fixture.counters.requests[0].init.body);
  assert.equal(body.amount.value, '199.99');
  assert.equal(body.receipt.items[0].amount.value, '199.99');
  assert.equal(body.metadata.localPaymentId, payment.id);
  assert.equal(fixture.counters.requests[0].init.headers['Idempotence-Key'], payment.id);
  assert.equal(payment.amount, 199.99);
  assert.equal(payment.userId, userId);
  assert.equal(fixture.counters.updates[0].userId, userId);
});

test('a retry after a tariff price change uses the existing original amount and owner', async () => {
  const fixture = loadProvider({ active: localPayment({ status: 'created', providerPaymentId: undefined, amount: 199.99 }),
    snapshotBody: originalCheckoutFixture(), tariff: { price: 900 }, receiptEnabled: true, fetched: yooPayment({ amount: { value: '199.99', currency: 'RUB' } }) });
  const payment = await fixture.provider.createPayment(createInput);
  const body = JSON.parse(fixture.counters.requests[0].init.body);
  assert.equal(body.amount.value, '199.99');
  assert.equal(body.receipt.items[0].amount.value, '199.99');
  assert.equal(payment.userId, userId);
  assert.equal(payment.amount, 199.99);
  assert.deepEqual(fixture.counters.creations, []);
});

test('a known provider ID without URL is GET-only even if a hypothetical POST would return another ID', async () => {
  const fixture = loadProvider({ active: localPayment(), fetchImplementation: (_url, init) =>
    jsonResponse(yooPayment(init.method === 'POST' ? { id: otherProviderId } : { confirmation: undefined })) });
  assert.equal((await fixture.provider.createPayment(createInput)).providerPaymentId, providerId);
  assert.equal(fixture.counters.requests.length, 1);
  assert.equal(fixture.counters.requests[0].init.method, undefined);
  assert.equal(fixture.counters.updates.length, 1, 'Only the independently verified GET can be persisted');
  assert.deepEqual(fixture.counters.targets, []);
});

for (const [name, storedSnapshot] of [
  ['owner', { userId: otherProviderId }], ['target', { targetId: otherProviderId }], ['target type', { targetType: 'vacancy' }],
  ['non-positive amount', { amount: 0 }], ['sub-kopeck amount', { amount: 1.001 }],
]) {
  test(`an incompatible stored ${name} fails before the provider charge`, async () => {
    const fixture = loadProvider({ storedSnapshot });
    await assert.rejects(() => fixture.provider.createPayment(createInput), /YooKassa/i);
    assert.deepEqual(fixture.counters.requests, []);
    assert.deepEqual(fixture.counters.updates, []);
    assert.deepEqual(fixture.counters.targets, []);
  });
}

for (const [description, overrides] of invalidFetchedObjects) {
  // New operations have no known remote ID yet; the returned ID must be a valid UUID.
  if (description === 'wrong provider ID') continue;
  test(`created response rejects ${description} before recording provider state or publishing`, async () => {
    const fixture = loadProvider({ fetched: yooPayment(overrides) });
    await assert.rejects(() => fixture.provider.createPayment(createInput), /YooKassa/i);
    assert.equal(fixture.counters.creations.length, 1, 'The local idempotence key must be durable before POST');
    assert.deepEqual(fixture.counters.updates, []);
    assert.deepEqual(fixture.counters.targets, []);
    assert.equal(fixture.counters.requests.length, 1);
  });
}

test('an immediately successful POST retains the persisted owner during fulfillment', async () => {
  const fixture = loadProvider({ fetched: yooPayment({ status: 'succeeded', paid: true, confirmation: undefined }) });
  const payment = await fixture.provider.createPayment(createInput);
  assert.equal(payment.userId, userId);
  assert.equal(fixture.counters.targets[0].userId, userId);
  assert.equal(fixture.counters.updates[0].userId, userId);
});

for (const [name, payload] of [['null', null], ['array', []], ['scalar', 'not-a-payment']]) {
  test(`${name} successful JSON cannot be treated as a payment`, async () => {
    const fixture = loadProvider({ fetchImplementation: () => jsonResponse(payload) });
    await assert.rejects(() => fixture.provider.confirmPayment(localId), /YooKassa/i);
    assert.deepEqual(fixture.counters.updates, []);
  });
}

for (const amount of [NaN, Infinity, '300', 300.001, 0, -1]) {
  test(`invalid local amount ${String(amount)} is rejected before any remote GET`, async () => {
    const fixture = loadProvider({ payment: localPayment({ amount }) });
    await assert.rejects(() => fixture.provider.confirmPayment(localId), /YooKassa/i);
    assert.deepEqual(fixture.counters.requests, []);
  });
}

test('a legacy unsafe checkout URL cannot survive an otherwise valid provider response', async () => {
  const fixture = loadProvider({ payment: localPayment({ confirmationUrl: 'javascript:alert(1)' }), fetched: yooPayment({ confirmation: undefined }) });
  const before = clone(fixture.payment);
  await assert.rejects(() => fixture.provider.confirmPayment(localId), /YooKassa/i);
  assert.deepEqual(fixture.payment, before);
  assert.deepEqual(fixture.counters.updates, []);
});

test('an independently validated new checkout URL can replace an unsafe legacy URL', async () => {
  const fixture = loadProvider({ payment: localPayment({ confirmationUrl: 'javascript:alert(1)' }) });
  const result = await fixture.provider.confirmPayment(localId);
  assert.equal(result.payment.confirmationUrl, checkoutUrl);
  assert.equal(fixture.counters.updates[0].confirmationUrl, checkoutUrl);
});

test('the exact decoded body limit and the alternative approved hosted-checkout domain work', async () => {
  const payload = yooPayment({ confirmation: { type: 'redirect', confirmation_url: 'https://yookassa.ru/checkout' }, padding: '' });
  payload.padding = 'x'.repeat(65_536 - Buffer.byteLength(JSON.stringify(payload)));
  assert.equal(Buffer.byteLength(JSON.stringify(payload)), 65_536);
  const fixture = loadProvider({ fetched: payload });
  assert.equal((await fixture.provider.confirmPayment(localId)).payment.confirmationUrl, 'https://yookassa.ru/checkout');
});

test('an oversized declared body is canceled before consumption', async () => {
  let canceled = 0;
  const fixture = loadProvider({ fetchImplementation: () => new Response(new ReadableStream({ cancel() { canceled++; } }), { headers: { 'Content-Length': '65537' } }) });
  await assert.rejects(() => fixture.provider.confirmPayment(localId), /YooKassa.*too large/i);
  assert.equal(canceled, 1);
  assert.equal(fixture.counters.requests[0].init.signal.aborted, true);
  assert.equal(fixture.clock.timers.size, 0);
});

test('malformed successful JSON fails closed without retry', async () => {
  const fixture = loadProvider({ fetchImplementation: () => new Response('{broken-private-detail', { status: 200 }) });
  await assert.rejects(() => fixture.provider.confirmPayment(localId), /YooKassa returned invalid JSON/);
  assert.equal(fixture.counters.requests.length, 1);
  assert.deepEqual(fixture.counters.updates, []);
});

for (const status of [400, 403, 404, 429]) {
  test(`HTTP ${status} is permanent in this bounded operation and cannot trigger fallback POST`, async () => {
    const fixture = loadProvider({ active: localPayment(), fetchImplementation: () => jsonResponse({ id: otherProviderId, description: 'private-provider-detail' }, status) });
    await assert.rejects(() => fixture.provider.createPayment(createInput), new RegExp(`HTTP ${status}; error id ${otherProviderId}`));
    assert.equal(fixture.counters.requests.length, 1);
    assert.equal(fixture.counters.requests[0].init.method, undefined);
    assert.deepEqual(fixture.counters.updates, []);
    assert.deepEqual(fixture.counters.creations, []);
  });
}

for (const fetched of [yooPayment({ id: otherProviderId }), yooPayment({ amount: { value: '299.99', currency: 'RUB' } })]) {
  test('invalid active GET fails closed instead of starting a fallback POST', async () => {
    const fixture = loadProvider({ active: localPayment(), fetched });
    await assert.rejects(() => fixture.provider.createPayment(createInput), /YooKassa/i);
    assert.equal(fixture.counters.requests.length, 1);
    assert.deepEqual(fixture.counters.updates, []);
    assert.deepEqual(fixture.counters.targets, []);
  });
}

test('a stalled active GET cannot start a second provider operation', async () => {
  const fixture = loadProvider({ active: localPayment(), fetchImplementation: () => new Promise(() => {}) });
  const outcome = fixture.provider.createPayment(createInput);
  const settled = observeSettlement(outcome);
  const rejected = assert.rejects(outcome, /YooKassa.*timed out/);
  await fixture.clock.advance(35_000);
  assert.equal(settled(), true);
  await rejected;
  assert.equal(fixture.counters.requests.length, 1);
  assert.deepEqual(fixture.counters.updates, []);
});

test('an idempotent POST retry uses identical body and key after an uncertain server failure', async () => {
  const fixture = loadProvider({ fetchImplementation: (_url, _init, attempt) => attempt === 1 ? new Response('upstream unavailable', { status: 500 }) : jsonResponse(yooPayment()) });
  const result = fixture.provider.createPayment(createInput);
  await fixture.clock.advance(500);
  const payment = await result;
  assert.equal(payment.userId, userId);
  assert.equal(fixture.counters.requests.length, 2);
  assert.equal(fixture.counters.requests[0].init.body, fixture.counters.requests[1].init.body);
  assert.equal(fixture.counters.requests[0].init.headers['Idempotence-Key'], localId);
  assert.equal(fixture.counters.requests[1].init.headers['Idempotence-Key'], localId);
  assert.equal(fixture.counters.requests[0].init.redirect, 'error');
  assert.equal(fixture.counters.creations.length, 1);
  assert.equal(fixture.clock.timers.size, 0);
});

test('known-ID recovery shares three actual GET attempts and never falls through to POST', async () => {
  const fixture = loadProvider({ active: localPayment(), fetchImplementation: () => jsonResponse({ id: otherProviderId }, 500) });
  const rejected = assert.rejects(fixture.provider.createPayment(createInput), /YooKassa.*HTTP 500/);
  await fixture.clock.advance(1500);
  await rejected;
  assert.equal(fixture.counters.requests.length, 3);
  assert.deepEqual(fixture.counters.requests.map(request => request.init.method ?? 'GET'), ['GET', 'GET', 'GET']);
  assert.equal(fixture.clock.timers.size, 0);
});

test('slow GET headers and its stalled body share the same total deadline without fallback POST', async () => {
  let clock;
  let canceled = 0;
  const fixture = loadProvider({ active: localPayment(), fetchImplementation: () =>
    new Promise(resolve => clock.setTimeout(() => resolve(new Response(new ReadableStream({ cancel() { canceled++; } }))), 25_000)) });
  clock = fixture.clock;
  const outcome = fixture.provider.createPayment(createInput);
  const settled = observeSettlement(outcome);
  const rejected = assert.rejects(outcome, /YooKassa.*timed out/);
  await clock.advance(25_000);
  assert.equal(fixture.counters.requests.length, 1);
  await clock.advance(10_000);
  assert.equal(settled(), true, 'The GET body must not receive a fresh deadline');
  await rejected;
  assert.equal(canceled, 1);
  assert.equal(fixture.counters.requests[0].init.signal.aborted, true);
  assert.equal(clock.timers.size, 0);
});

test('three failed transport attempts sanitize secret-bearing errors and never publish', async () => {
  const fixture = loadProvider({ fetchImplementation: () => { throw new Error('Basic test_synthetic_not_a_credential private-provider-detail'); } });
  const rejected = assert.rejects(fixture.provider.confirmPayment(localId), error => {
    assert.equal(error.message, 'YooKassa request failed');
    return true;
  });
  await fixture.clock.advance(1500);
  await rejected;
  assert.equal(fixture.counters.requests.length, 3);
  assert.deepEqual(fixture.counters.logs, []);
  assert.deepEqual(fixture.counters.targets, []);
  assert.deepEqual(fixture.counters.updates, []);
});

test('in-process concurrent creation shares one durable key and one provider operation', async () => {
  let respond;
  const fixture = loadProvider({ fetchImplementation: () => new Promise(resolve => { respond = resolve; }) });
  const one = fixture.provider.createPayment(createInput);
  const two = fixture.provider.createPayment(createInput);
  await flush();
  assert.equal(fixture.counters.creations.length, 1);
  assert.equal(fixture.counters.requests.length, 1);
  respond(jsonResponse(yooPayment()));
  const [a, b] = await Promise.all([one, two]);
  assert.equal(a, b);
  assert.equal(a.userId, userId);
});

test('a database uniqueness race reuses the winner snapshot and original price', async () => {
  let lookups = 0;
  const fixture = loadProvider({ receiptEnabled: true, createError: new Error('synthetic unique violation'),
    snapshotBody: originalCheckoutFixture(),
    findActiveImplementation: () => ++lookups === 1 ? undefined : localPayment({ status: 'created', providerPaymentId: undefined, amount: 199.99 }),
    fetched: yooPayment({ amount: { value: '199.99', currency: 'RUB' } }) });
  const payment = await fixture.provider.createPayment(createInput);
  assert.equal(payment.id, localId);
  assert.equal(payment.userId, userId);
  assert.equal(payment.amount, 199.99);
  assert.equal(JSON.parse(fixture.counters.requests[0].init.body).receipt.items[0].amount.value, '199.99');
});

test('live merchant responses and development test returns both require actual provider truth', async () => {
  const live = loadProvider({ secret: 'live_synthetic_not_a_credential', fetched: yooPayment({ test: false }) });
  assert.equal((await live.provider.confirmPayment(localId)).payment.status, 'pending');
  const development = loadProvider({ production: false });
  assert.equal((await development.provider.confirmPayment(localId, { trustSuccessfulReturn: true })).payment.status, 'pending');
  assert.equal(development.counters.requests.length, 1);
  assert.deepEqual(development.counters.targets, []);
});

test('notification metadata cannot replace the independently fetched payment bindings', async () => {
  const fixture = loadProvider({ fetched: yooPayment({ status: 'succeeded', paid: true, metadata: { localPaymentId: otherProviderId } }) });
  await assert.rejects(() => fixture.provider.processYooKassaNotification({ event: 'payment.succeeded', object: yooPayment({ metadata: { localPaymentId: localId } }) }), /YooKassa.*metadata/);
  assert.deepEqual(fixture.counters.targets, []);
  assert.deepEqual(fixture.counters.updates, []);
});

for (const [name, value] of [
  ['null', null], ['object', {}], ['number', 123], ['invalid calendar date', '2026-02-30T12:00:00.000Z'],
  ['date only', '2026-10-07'], ['no UTC designator', '2026-10-07T12:00:00.000'],
  ['offset instead of UTC Z', '2026-10-07T12:00:00.000+00:00'], ['invalid hour', '2026-10-07T24:00:00.000Z'],
  ['invalid second', '2026-10-07T12:00:60.000Z'], ['too much fractional precision', '2026-10-07T12:00:00.1234567890Z'],
  ['oversized', 'x'.repeat(1000)], ['beyond bounded future skew', '2026-10-07T12:05:00.001Z'],
  ['nanosecond beyond bounded future skew', '2026-10-07T12:05:00.000000001Z'],
]) {
  test(`GET rejects ${name} captured_at before local mutation`, async () => {
    const fixture = loadProvider({ fetched: yooPayment({ status: 'succeeded', paid: true, captured_at: value }) });
    const before = clone(fixture.payment);
    await assert.rejects(() => fixture.provider.confirmPayment(localId), /YooKassa.*capture.*time/i);
    assert.deepEqual(fixture.payment, before);
    assert.deepEqual(fixture.counters.updates, []);
    assert.deepEqual(fixture.counters.targets, []);
  });
  test(`POST rejects ${name} captured_at before local state or fulfillment`, async () => {
    const fixture = loadProvider({ fetched: yooPayment({ status: 'succeeded', paid: true, captured_at: value }) });
    await assert.rejects(() => fixture.provider.createPayment(createInput), /YooKassa.*capture.*time/i);
    assert.equal(fixture.counters.creations.length, 1);
    assert.deepEqual(fixture.counters.updates, []);
    assert.deepEqual(fixture.counters.targets, []);
  });
}

test('capture time on an uncaptured payment is inconsistent', async () => {
  const fixture = loadProvider({ fetched: yooPayment({ captured_at: '2026-10-07T11:00:00.000Z' }) });
  await assert.rejects(() => fixture.provider.confirmPayment(localId), /YooKassa.*capture.*time/i);
  assert.deepEqual(fixture.counters.updates, []);
});

test('validated capture time retains UTC Z and zero through nine fractional digits', () => {
  const fixture = loadProvider();
  for (const value of ['2026-09-01T12:00:00Z', ...Array.from({ length: 9 }, (_, i) => `2026-09-01T12:00:00.${'123456789'.slice(0, i + 1)}Z`), '2026-10-07T12:05:00.000Z']) {
    assert.equal(fixture.validateResponse(yooPayment({ status: 'succeeded', paid: true, captured_at: value })).capturedAt, value);
  }
});

test('an optional absent capture time is not fabricated from creation time or today', () => {
  const fixture = loadProvider();
  const validated = fixture.validateResponse(yooPayment({ status: 'succeeded', paid: true, captured_at: undefined, created_at: '2026-08-01T12:00:00.000Z' }));
  assert.equal(validated.status, 'succeeded');
  assert.equal(validated.capturedAt, undefined);
});
