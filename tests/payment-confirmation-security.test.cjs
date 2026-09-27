const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const paymentId = '11111111-1111-4111-8111-111111111111';
const providerPaymentId = 'yoo-verified-123';

function loadPaymentProvider({ production = true, payment, providerResponse, configured = true } = {}) {
  const counters = { fetches: [], storedUpdates: [], targetUpdates: [] };
  const storedPayment = payment ?? {
    id: paymentId,
    targetType: 'listing',
    targetId: '22222222-2222-4222-8222-222222222222',
    targetTitle: 'Объявление',
    tariffId: 'listing-publication',
    amount: 300,
    status: 'pending',
    provider: 'yookassa',
    providerPaymentId,
    createdAt: '2026-09-27',
  };
  const liveStatus = providerResponse ?? { id: providerPaymentId, status: 'pending', paid: false };
  const store = {
    canStorePayment: () => configured,
    createStoredPayment: async () => { throw new Error('unexpected payment creation'); },
    findActiveStoredPaymentForTarget: async () => undefined,
    findStoredPaymentByProvider: async (id) => id === storedPayment.providerPaymentId ? storedPayment : undefined,
    getStoredPayment: async (id) => id === storedPayment.id ? storedPayment : undefined,
    listStoredPayments: async () => [],
    markStoredPaymentTargetSucceeded: async (value) => {
      counters.targetUpdates.push(value.id);
      return 'published';
    },
    updateStoredPayment: async (value) => {
      counters.storedUpdates.push(value.status);
      return value;
    },
  };
  const stubs = {
    '@/lib/mock-store': {
      listMockPayments: () => [storedPayment],
      markPaymentTargetSucceeded: () => {
        throw new Error('mock publication must not run in production');
      },
    },
    '@/lib/payment-store': store,
    '@/lib/runtime-mode': { shouldAllowMockPayments: () => !production },
    '@/lib/site-url': { getPublicSiteUrl: () => 'https://example.test' },
    '@/lib/supabase-rest': { isSupabaseRestConfigured: () => configured },
    '@/lib/tariff-store': { getActiveStoredTariffById: async () => undefined },
  };
  const filename = path.join(__dirname, '../src/lib/payment-provider.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const js = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'process', js)((name) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency ${name}`);
    return stubs[name];
  }, module, module.exports, async (url) => {
    counters.fetches.push(url);
    return { ok: true, status: 200, json: async () => liveStatus };
  }, {
    env: { NODE_ENV: production ? 'production' : 'test', PAYMENT_PROVIDER: 'yookassa', YOOKASSA_SHOP_ID: 'shop', YOOKASSA_SECRET_KEY: 'test_secret' },
  });
  return { provider: module.exports, counters, payment: storedPayment };
}

function notification(object = {}) {
  return {
    event: 'payment.succeeded',
    object: { id: providerPaymentId, status: 'succeeded', paid: true, ...object },
  };
}

test('production rejects a caller-supplied mock payment even when marked as paid', async () => {
  const { provider, counters, payment } = loadPaymentProvider({ payment: {
    id: paymentId,
    targetType: 'listing',
    targetId: '22222222-2222-4222-8222-222222222222',
    targetTitle: 'Объявление',
    status: 'succeeded',
    provider: 'mock',
  } });

  assert.equal(provider.getPayment(payment.id), undefined);
  await assert.rejects(() => provider.confirmPayment(payment), /Mock payment confirmation is disabled/);
  assert.deepEqual(counters.targetUpdates, []);
  assert.deepEqual(counters.storedUpdates, []);
});

test('forged successful webhook cannot publish while YooKassa reports pending', async () => {
  const { provider, counters, payment } = loadPaymentProvider();
  const result = await provider.processYooKassaNotification(notification({
    metadata: { localPaymentId: payment.id, targetId: payment.targetId, targetType: 'listing' },
  }));

  assert.equal(result.processed, true);
  assert.equal(result.result.payment.status, 'pending');
  assert.equal(payment.status, 'pending');
  assert.deepEqual(counters.targetUpdates, []);
  assert.deepEqual(counters.storedUpdates, ['pending']);
  assert.deepEqual(counters.fetches, [`https://api.yookassa.ru/v3/payments/${providerPaymentId}`]);
});

test('webhook with a mismatched provider ID cannot update a local payment', async () => {
  const { provider, counters, payment } = loadPaymentProvider();
  const result = await provider.processYooKassaNotification(notification({
    id: 'forged-provider-id',
    metadata: { localPaymentId: payment.id },
  }));

  assert.equal(result.processed, false);
  assert.deepEqual(counters.fetches, []);
  assert.deepEqual(counters.storedUpdates, []);
  assert.deepEqual(counters.targetUpdates, []);
});

test('a verified success applies publication once even when the webhook is replayed', async () => {
  const { provider, counters, payment } = loadPaymentProvider({
    providerResponse: { id: providerPaymentId, status: 'succeeded', paid: true },
  });
  const first = await provider.processYooKassaNotification(notification({
    metadata: { localPaymentId: 'spoofed-local-id', targetId: 'spoofed-target-id' },
  }));
  const replay = await provider.processYooKassaNotification(notification());

  assert.equal(first.result.payment.id, payment.id);
  assert.equal(first.result.payment.status, 'succeeded');
  assert.equal(replay.result.payment.status, 'succeeded');
  assert.deepEqual(counters.targetUpdates, [payment.id]);
  assert.equal(counters.fetches.length, 2);
});

test('a production return flag never bypasses the authoritative provider status', async () => {
  const { provider, counters } = loadPaymentProvider();
  assert.equal(provider.canForceSucceedYooKassaReturn(), false);

  const result = await provider.confirmPayment(paymentId, { trustSuccessfulReturn: true });
  assert.equal(result.payment.status, 'pending');
  assert.deepEqual(counters.targetUpdates, []);
  assert.equal(counters.fetches.length, 1);
});
