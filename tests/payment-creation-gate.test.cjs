const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

function loadPaymentsRoute() {
  const paymentsCreated = [];
  const listingId = '22222222-2222-4222-8222-222222222222';
  const tariffs = {
    'specialist-publication': { id: 'specialist-publication', action: 'specialist_publication', name: 'Анкета специалиста' },
    'listing-publication': { id: 'listing-publication', action: 'listing_publication', name: 'Объявление' },
  };
  const stubs = {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } },
    '@/lib/ad-marquee-store': { getPayableAdMarqueePlacementForUser: async () => undefined },
    '@/lib/application-store': { getStoredApplicationForPayment: async () => undefined },
    '@/lib/listing-store': {
      getStoredListingForUser: async (id) => id === listingId ? { id, title: 'Тестовое объявление', status: 'pending_payment' } : undefined,
      markStoredListingPendingPaymentForUser: async () => { throw new Error('unexpected listing mutation'); },
    },
    '@/lib/payment-provider': {
      createPayment: async (input) => {
        paymentsCreated.push(input);
        return { id: 'new-payment', ...input };
      },
      listPayments: async () => [],
      validatePaymentTargetTypeForTariff: (tariff, requestedType) => {
        const expected = tariff.action === 'specialist_publication' ? 'specialist' : 'listing';
        if (requestedType && requestedType !== expected) throw new Error('Tariff and target type differ');
        return expected;
      },
    },
    '@/lib/server-auth': {
      getAuthenticatedRequestUser: async () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }),
      isAdminRequest: async () => false,
      isSupabaseServerConfigured: () => true,
    },
    '@/lib/supabase-rest': { isUuid: (value) => /^[0-9a-f-]{36}$/.test(value) },
    '@/lib/tariff-store': { getActiveStoredTariffById: async (id) => tariffs[id] },
    '@/lib/vacancy-store': {
      getStoredVacancyForUser: async () => undefined,
      markStoredVacancyPendingPaymentForUser: async () => undefined,
    },
    '@/lib/vacancy-requisites': { normalizeVacancyRequisites: () => ({}), validateVacancyRequisites: () => undefined },
    '@/lib/work-request-store': {
      getStoredWorkRequestForUser: async () => undefined,
      markStoredWorkRequestPendingPaymentForUser: async () => undefined,
    },
  };
  const filename = path.join(__dirname, '../src/app/api/payments/route.ts');
  const js = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency ${name}`);
    return stubs[name];
  }, module, module.exports);
  return { POST: module.exports.POST, listingId, paymentsCreated };
}

function paymentRequest(body) {
  return new Request('https://example.test/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('specialist publication cannot charge for an unavailable service, regardless of target input', async () => {
  const { POST, paymentsCreated } = loadPaymentsRoute();
  for (const body of [
    { tariffId: 'specialist-publication' },
    { tariffId: 'specialist-publication', targetId: '22222222-2222-4222-8222-222222222222', targetType: 'specialist' },
  ]) {
    const response = await POST(paymentRequest(body));
    assert.equal(response.status, 409);
    assert.match(response.body.error, /Платеж не создан/);
  }
  assert.deepEqual(paymentsCreated, []);
});

test('listing publication remains payable, and tariff type forgery cannot reach payment creation', async () => {
  const { POST, listingId, paymentsCreated } = loadPaymentsRoute();
  const mismatched = await POST(paymentRequest({ tariffId: 'specialist-publication', targetType: 'listing', targetId: listingId }));
  assert.equal(mismatched.status, 400);
  assert.deepEqual(paymentsCreated, []);

  const listing = await POST(paymentRequest({ tariffId: 'listing-publication', targetType: 'listing', targetId: listingId }));
  assert.equal(listing.status, 201);
  assert.equal(paymentsCreated.length, 1);
  assert.equal(paymentsCreated[0].targetType, 'listing');
  assert.equal(paymentsCreated[0].targetId, listingId);
});
