const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const paymentId = '11111111-1111-4111-8111-111111111111';
const originalPaidAt = '2026-09-01T12:34:56.789Z';
const appliedAt = '2026-09-01T12:35:00.123Z';

function loadPaymentStore(storedRow) {
  const requests = [];
  const stubs = {
    '@/lib/ad-marquee-store': {},
    '@/lib/fair-application-store': {},
    '@/lib/application-store': {},
    '@/lib/notification-store': {},
    '@/lib/listing-store': {},
    '@/lib/vacancy-store': {},
    '@/lib/work-request-store': {},
    '@/lib/tariff-store': { getTariffs: () => [] },
    '@/lib/supabase-rest': {
      isSupabaseRestConfigured: () => true,
      isUuid: (id) => id === paymentId,
      supabaseRest: async (requestPath, options) => {
        requests.push({ path: requestPath, ...options });
        return storedRow ? [{ ...storedRow }] : [];
      },
    },
  };
  const filename = path.join(__dirname, '../src/lib/payment-store.ts');
  const js = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency ${name}`);
    return stubs[name];
  }, module, module.exports);
  return { store: module.exports, requests };
}

function row(overrides = {}) {
  return {
    id: paymentId, user_id: paymentId, amount: 199, target_type: 'workRequest', target_id: paymentId,
    provider: 'yookassa', provider_payment_id: 'provider-test-fixture', status: 'succeeded',
    created_at: '2026-09-01T12:00:00.000Z', paid_at: originalPaidAt, target_applied_at: appliedAt,
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    id: paymentId, userId: paymentId, amount: 199, targetType: 'workRequest', targetId: paymentId,
    targetTitle: 'Синтетический заказ', tariffId: 'work-request-publication', provider: 'yookassa',
    providerPaymentId: 'provider-test-fixture', status: 'succeeded', createdAt: '2026-09-01',
    paidAt: originalPaidAt, targetAppliedAt: appliedAt, ...overrides,
  };
}

test('mapping a stored settlement preserves its timestamp precision', async () => {
  const { store } = loadPaymentStore();
  const context = { applicationTitlesById: new Map(), fairApplicationTitlesById: new Map(), tariffActionsById: new Map() };
  assert.equal((await store.mapStoredPayment(row(), context)).paidAt, originalPaidAt);
});

test('replaying a successful payment does not send a new paid_at timestamp', async () => {
  const { store, requests } = loadPaymentStore(row());
  const result = await store.updateStoredPayment(payment());
  assert.equal(requests[0].body.paid_at, originalPaidAt);
  assert.equal(result.paidAt, originalPaidAt);
  assert.equal(requests[0].prefer, 'return=representation');
});

test('a stale updater adopts the committed successful row returned by the database', async () => {
  const { store } = loadPaymentStore(row());
  const stale = payment({ status: 'pending', paidAt: undefined, targetAppliedAt: undefined });
  const result = await store.updateStoredPayment(stale);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.paidAt, originalPaidAt);
  assert.equal(result.targetAppliedAt, appliedAt);
  assert.equal(result.targetTitle, 'Синтетический заказ');
  assert.equal(stale.status, 'succeeded');
});

test('an updater cannot silently report success when the persisted payment has disappeared', async () => {
  const { store } = loadPaymentStore();
  await assert.rejects(() => store.updateStoredPayment(payment()), /payment.*not found/i);
});
