const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const paymentId = '11111111-1111-4111-8111-111111111111';
const providerPaymentId = '2b3f5e11-000f-5000-8000-123456789abc';

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
  const liveStatus = {
    id: providerPaymentId, status: 'pending', paid: false, test: true,
    ...(providerResponse?.status === 'succeeded' ? { captured_at: '2026-10-07T12:00:00.000Z' } : {}),
    amount: { value: '300.00', currency: 'RUB' }, ...providerResponse,
  };
  const store = {
    canStorePayment: () => configured,
    createStoredPayment: async () => { throw new Error('unexpected payment creation'); },
    authorizeStoredYooKassaCheckoutAttempt: async payment => ({ decision: 'legacy_recover', providerPaymentId: payment.providerPaymentId }),
    findActiveStoredPaymentForTarget: async () => undefined,
    findStoredPaymentByProvider: async (id) => id === storedPayment.providerPaymentId ? storedPayment : undefined,
    getStoredPayment: async (id) => id === storedPayment.id ? storedPayment : undefined,
    listStoredPayments: async () => [],
    applyStoredPaymentFulfillment: async (value) => {
      if (!value.targetAppliedAt) counters.targetUpdates.push(value.id);
      value.targetAppliedAt ??= '2026-10-07T12:01:00.000Z';
      value.fulfillmentStatus = 'applied';
      return { payment: value, nextStatus: 'published' };
    },
    updateStoredPayment: async (value) => {
      counters.storedUpdates.push(value.status);
      return value;
    },
  };
  const stubs = {
    '@/lib/yookassa-payment-contract': require('./yookassa-contract-module.cjs'),
    '@/lib/yookassa-transport': require('./yookassa-transport-module.cjs'),
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
    return new Response(JSON.stringify(liveStatus), { status: 200, headers: { 'Content-Type': 'application/json' } });
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


function loadPaymentCreator(receiptEnv = {}) {
  const counters = { events: [], request: undefined, stored: [] };
  let checkoutBody;
  const tariff = {
    id: '44444444-4444-4444-8444-444444444444',
    action: 'listing_publication',
    name: 'Публикация объявления',
    price: 300,
    active: true,
  };
  const stubs = {
    '@/lib/yookassa-payment-contract': require('./yookassa-contract-module.cjs'),
    '@/lib/yookassa-transport': require('./yookassa-transport-module.cjs'),
    '@/lib/mock-store': {
      listMockPayments: () => [],
      markPaymentTargetSucceeded: () => { throw new Error('mock publication must not run'); },
    },
    '@/lib/payment-store': {
      canStorePayment: () => true,
      prepareStoredYooKassaCheckoutIntent: async (_payment, body) => { checkoutBody = body; return { decision: 'post', requestBody: body, remainingMs: 3_600_000 }; },
      authorizeStoredYooKassaCheckoutAttempt: async () => ({ decision: 'post', requestBody: checkoutBody, remainingMs: 3_600_000 }),
      createStoredPayment: async (input) => {
        counters.events.push('stored');
        counters.stored.push(input);
        return {
          id: input.id,
          userId: input.userId,
          targetType: input.targetType,
          targetId: input.targetId,
          targetTitle: input.targetTitle,
          tariffId: input.tariff.id,
          amount: input.amount,
          status: input.status,
          provider: input.provider,
          createdAt: '2026-10-06',
        };
      },
      findActiveStoredPaymentForTarget: async () => undefined,
      findStoredPaymentByProvider: async () => undefined,
      getStoredPayment: async () => undefined,
      listStoredPayments: async () => [],
      applyStoredPaymentFulfillment: async payment => ({ payment, nextStatus: 'published' }),
      updateStoredPayment: async payment => payment,
    },
    '@/lib/runtime-mode': { shouldAllowMockPayments: () => false },
    '@/lib/site-url': { getPublicSiteUrl: () => 'https://example.test' },
    '@/lib/supabase-rest': { isSupabaseRestConfigured: () => true },
    '@/lib/tariff-store': { getActiveStoredTariffById: async (id) => id === tariff.id ? tariff : undefined },
  };
  const filename = path.join(__dirname, '../src/lib/payment-provider.ts');
  const js = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'process', js)(
    (name) => {
      if (!(name in stubs)) throw new Error(`Unexpected dependency ${name}`);
      return stubs[name];
    },
    module,
    module.exports,
    async (_url, init) => {
      counters.events.push('fetch');
      counters.request = init;
      return new Response(JSON.stringify({
        id: '2b3f5e22-000f-5000-8000-123456789abc', status: 'pending', paid: false, test: false,
        amount: { value: '300.00', currency: 'RUB' },
        confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=synthetic' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    {
      env: {
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'yookassa',
        YOOKASSA_SHOP_ID: 'shop',
        YOOKASSA_SECRET_KEY: 'live_secret',
        ...receiptEnv,
      },
    },
  );
  return { provider: module.exports, counters, tariff };
}

test('a YooKassa checkout is persisted before the provider request and uses its local idempotence key', async () => {
  const { provider, counters, tariff } = loadPaymentCreator();
  const payment = await provider.createPayment({
    tariffId: tariff.id,
    targetType: 'listing',
    targetId: '22222222-2222-4222-8222-222222222222',
    targetTitle: 'Объявление',
    userId: '11111111-1111-4111-8111-111111111111',
  });

  assert.deepEqual(counters.events, ['stored', 'fetch']);
  assert.equal(counters.stored.length, 1);
  assert.equal(counters.request.headers['Idempotence-Key'], counters.stored[0].id);
  assert.equal(payment.id, counters.stored[0].id);
  assert.equal(payment.status, 'pending');
});


test('adds a YooKassa service receipt using the authenticated customer email', async () => {
  const { provider, counters, tariff } = loadPaymentCreator({
    YOOKASSA_RECEIPTS_ENABLED: 'true',
    YOOKASSA_RECEIPT_VAT_CODE: '1',
  });

  await provider.createPayment({
    customerEmail: 'buyer@example.test',
    tariffId: tariff.id,
    targetType: 'listing',
    targetId: '22222222-2222-4222-8222-222222222222',
    targetTitle: 'Продам велосипед',
    userId: '11111111-1111-4111-8111-111111111111',
  });

  const body = JSON.parse(counters.request.body);
  assert.deepEqual(body.receipt, {
    customer: { email: 'buyer@example.test' },
    internet: true,
    items: [
      {
        amount: { currency: 'RUB', value: '300.00' },
        description: 'Услуга размещения: Продам велосипед',
        payment_mode: 'full_payment',
        payment_subject: 'service',
        quantity: 1,
        vat_code: 1,
      },
    ],
  });
});

test('fails closed when a YooKassa receipt is enabled but the customer email is missing', async () => {
  const { provider, counters, tariff } = loadPaymentCreator({
    YOOKASSA_RECEIPTS_ENABLED: 'true',
    YOOKASSA_RECEIPT_VAT_CODE: '1',
  });

  await assert.rejects(
    () =>
      provider.createPayment({
        tariffId: tariff.id,
        targetType: 'listing',
        targetId: '22222222-2222-4222-8222-222222222222',
        targetTitle: 'Объявление',
        userId: '11111111-1111-4111-8111-111111111111',
      }),
    /customer email/,
  );
  assert.deepEqual(counters.events, []);
});
