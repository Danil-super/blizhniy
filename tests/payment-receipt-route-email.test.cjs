const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const userId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const payerEmail = 'Verified.Payer@example.test';
const formEmail = 'not-the-payer@example.test';
const routeCases = [
  { route: 'listings', targetType: 'listing', action: 'listing_publication', body: { title: 'Тестовое объявление', phone: '+79995550123', tariffId: 'listing-publication', email: formEmail } },
  { route: 'vacancies', targetType: 'vacancy', action: 'vacancy_publication', body: { title: 'Тестовая вакансия', organization: 'Тестовый работодатель', employerType: 'individual', inn: '123456789012', description: 'Синтетическое подробное описание вакансии для проверки чека.', phone: '+79995550123', email: formEmail, salary: '80000', placementRightConfirmed: true, mediaPaths: ['vacancies/synthetic/photo.jpg'], tariffId: 'vacancy-publication' } },
  { route: 'work-requests', targetType: 'workRequest', action: 'work_request_publication', body: { title: 'Тестовый заказ', description: 'Синтетическое подробное описание заказа для проверки чека.', phone: '+79995550123', placementRightConfirmed: true, tariffId: 'work-request-publication', email: formEmail } },
  { route: 'applications', targetType: 'application', action: 'job_response', body: { vacancyId: targetId, message: 'Синтетический отклик', email: formEmail } },
  { route: 'fair-applications', targetType: 'fair_application', action: 'fair_participation', body: { participantName: 'Тестовый участник', city: 'Краснодар', category: 'Рукоделие', description: 'Синтетическое подробное описание участия в ярмарке.', phone: '+79995550123', email: formEmail, captchaToken: 'synthetic-token' } },
];

function loadSource(relative, dependencies, injected = {}) {
  const filename = path.resolve(relative);
  const js = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(injected), js)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name} in ${relative}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(injected));
  return module.exports;
}

function fixture(entry, { receipts = true, authenticated = true, email = payerEmail, alreadyPaidApplication = false } = {}) {
  const providerRequests = [];
  const targetWrites = [];
  const storedPayments = [];
  const tariff = { id: entry.body.tariffId || (entry.route === 'applications' ? 'job-response' : 'fair-participation'), name: 'Синтетический тариф', action: entry.action, price: 300, durationDays: 30, active: true };
  const provider = loadSource('src/lib/payment-provider.ts', {
    '@/lib/mock-store': { listMockPayments: () => [], markPaymentTargetSucceeded: () => { throw new Error('Unexpected mock payment'); } },
    '@/lib/payment-store': {
      canStorePayment: input => Boolean(input.targetId),
      createStoredPayment: async input => { storedPayments.push(input); return { ...input, tariffId: input.tariff.id, createdAt: '2026-10-07' }; },
      findActiveStoredPaymentForTarget: async () => undefined,
      findStoredPaymentByProvider: async () => undefined,
      getStoredPayment: async () => undefined,
      listStoredPayments: async () => [],
      updateStoredPayment: async payment => payment,
      markStoredPaymentTargetSucceeded: () => { throw new Error('Receipt creation must not publish a target'); },
    },
    '@/lib/runtime-mode': { shouldAllowMockPayments: () => false },
    '@/lib/site-url': { getPublicSiteUrl: () => 'https://example.test' },
    '@/lib/supabase-rest': { isSupabaseRestConfigured: () => true },
    '@/lib/tariff-store': { getActiveStoredTariffById: async () => tariff },
  }, {
    process: { env: { NODE_ENV: 'production', PAYMENT_PROVIDER: 'yookassa', YOOKASSA_SHOP_ID: 'synthetic-shop', YOOKASSA_SECRET_KEY: 'test_synthetic_not_a_credential', YOOKASSA_RECEIPTS_ENABLED: String(receipts), YOOKASSA_RECEIPT_VAT_CODE: '1' } },
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.yookassa.ru/v3/payments');
      providerRequests.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        id: '2b3f5e11-000f-5000-8000-123456789abc', status: 'pending', paid: false, test: true,
        amount: { value: '300.00', currency: 'RUB' },
        confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=synthetic' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const createTarget = async input => {
    targetWrites.push(input);
    return { ...input, id: targetId, participantName: input.participantName, ...(alreadyPaidApplication ? { paymentId: 'previous-paid-payment', paymentStatus: 'succeeded' } : {}) };
  };
  const dependencies = {
    'next/server': require('next/server'),
    '@/lib/payment-provider': provider,
    '@/lib/server-auth': { getAuthenticatedRequestUser: async () => authenticated ? { user: { id: userId, email } } : undefined, isSupabaseServerConfigured: () => true, isAdminRequest: async () => false },
    '@/lib/supabase-rest': { isSupabaseServiceRoleConfigured: () => true, isSupabaseRestConfigured: () => true, isUuid: value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value) },
    '@/lib/storage-upload': { validateMediaStoragePathsForUser: paths => paths },
    '@/lib/booking-details': { formatBookingPrice: () => '300', sanitizeBookingDetails: () => undefined, validateBookingDetailsForPublication: () => [] },
    '@/lib/listing-store': { createStoredListing: createTarget, findReusableStoredListingForPayment: async () => undefined, updateStoredListingForUser: () => { throw new Error('Unexpected listing reuse'); } },
    '@/lib/vacancy-store': { createStoredVacancy: createTarget, findReusableStoredVacancyForPayment: async () => undefined, updateStoredVacancyForUser: () => { throw new Error('Unexpected vacancy reuse'); } },
    '@/lib/work-request-store': { createStoredWorkRequest: createTarget, findReusableStoredWorkRequestForPayment: async () => undefined, updateStoredWorkRequestForUser: () => { throw new Error('Unexpected request reuse'); } },
    '@/lib/vacancy-requisites': { normalizeVacancyRequisites: input => input, validateVacancyRequisites: () => undefined },
    '@/lib/application-store': { createStoredApplication: createTarget, ensureVacancyCanReceiveApplication: async () => ({ title: 'Синтетическая вакансия' }), ensureWorkRequestCanReceiveApplication: async () => ({ title: 'Синтетический заказ' }) },
    '@/lib/specialist-profile-store': { getActiveStoredSpecialistProfileForUser: async () => ({ id: targetId, name: 'Тестовый специалист', email: 'specialist-contact@example.test' }), getSpecialistProfileCompleteness: () => ({ complete: true, missing: [] }) },
    '@/lib/fair-application-store': { createStoredFairApplication: createTarget, listStoredFairApplications: async () => [], markStoredFairApplicationPaid: () => { throw new Error('Unexpected admin publication'); } },
    '@/lib/mock-store': { createFairApplication: () => { throw new Error('Unexpected fallback'); }, listFairApplications: () => [] },
    '@/lib/runtime-mode': { shouldShowFallbackContent: () => false },
    '@/lib/turnstile': { TURNSTILE_ERROR_MESSAGE: 'Synthetic CAPTCHA failure', verifyTurnstileToken: async () => true },
    '@/lib/trusted-proxy-ip': { getTrustedProxyIp: () => '127.0.0.1' },
  };
  const route = loadSource(`src/app/api/${entry.route}/route.ts`, dependencies);
  const send = body => route.POST(new Request(`https://example.test/api/${entry.route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-session-not-a-credential' }, body: JSON.stringify(body || entry.body) }));
  return { send, providerRequests, targetWrites, storedPayments, provider, tariff };
}

for (const entry of routeCases) {
  test(`${entry.route}: receipt-enabled checkout uses verified payer email, never contact/form email`, async () => {
    const current = fixture(entry);
    const response = await current.send();
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(current.providerRequests.length, 1);
    const request = current.providerRequests[0];
    assert.equal(request.receipt.customer.email, payerEmail.toLowerCase());
    assert.notEqual(request.receipt.customer.email, formEmail);
    assert.deepEqual(request.amount, { value: '300.00', currency: 'RUB' });
    assert.equal(request.receipt.items[0].vat_code, 1);
    assert.equal(request.metadata.targetType, entry.targetType);
    assert.equal(current.storedPayments[0].userId, userId);
  });
  test(`${entry.route}: disabled receipts preserve ordinary checkout`, async () => {
    const current = fixture(entry, { receipts: false, email: null });
    const response = await current.send();
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(current.providerRequests.length, 1);
    assert.equal('receipt' in current.providerRequests[0], false);
  });
}

test('all publication and response routes reject unauthenticated receipt requests before target or provider writes', async () => {
  for (const entry of routeCases) {
    const current = fixture(entry, { authenticated: false });
    assert.equal((await current.send()).status, 401, entry.route);
    assert.deepEqual(current.targetWrites, []);
    assert.deepEqual(current.providerRequests, []);
  }
});

test('saving a draft or reusing an already-paid response does not create a receipt/payment', async () => {
  for (const entry of routeCases.filter(value => ['vacancies', 'work-requests'].includes(value.route))) {
    const current = fixture(entry);
    const response = await current.send({ ...entry.body, status: 'draft', tariffId: '' });
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(current.targetWrites.length, 1);
    assert.deepEqual(current.providerRequests, []);
  }
  const entry = routeCases.find(value => value.route === 'applications');
  const current = fixture(entry, { alreadyPaidApplication: true });
  assert.equal((await current.send()).status, 201);
  assert.deepEqual(current.providerRequests, []);
});

test('receipt validation fails before local payment persistence and provider request when payer email is invalid', async () => {
  const entry = routeCases[0];
  const current = fixture(entry);
  await assert.rejects(() => current.provider.createPayment({ tariffId: current.tariff.id, targetId, targetType: entry.targetType, userId, customerEmail: 'invalid' }), /customer email is required/);
  assert.deepEqual(current.storedPayments, []);
  assert.deepEqual(current.providerRequests, []);
});
