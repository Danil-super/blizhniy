const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const owner = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
const payerEmail = 'payer@example.test';
const cases = [
  ['listings', 'listing', 'listing_publication', { title: 'Синтетическое объявление', phone: '+79995550123', tariffId: 'listing-publication' }],
  ['vacancies', 'vacancy', 'vacancy_publication', { title: 'Синтетическая вакансия', organization: 'Работодатель', employerType: 'individual', inn: '123456789012', description: 'Подробное синтетическое описание вакансии для проверки.', phone: '+79995550123', salary: '80000', placementRightConfirmed: true, mediaPaths: ['vacancies/synthetic/photo.jpg'], tariffId: 'vacancy-publication' }],
  ['work-requests', 'workRequest', 'work_request_publication', { title: 'Синтетический заказ', description: 'Подробное синтетическое описание заказа для проверки.', phone: '+79995550123', placementRightConfirmed: true, tariffId: 'work-request-publication' }],
  ['applications', 'application', 'job_response', { vacancyId: target, message: 'Синтетический отклик' }],
  ['fair-applications', 'fair_application', 'fair_participation', { participantName: 'Синтетический участник', city: 'Краснодар', category: 'Рукоделие', description: 'Подробное синтетическое описание участия в ярмарке.', phone: '+79995550123', email: 'contact@example.test', captchaToken: 'synthetic-token' }],
];

function execute(relative, dependencies, lexical = {}) {
  const file = path.join(__dirname, '..', relative);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(lexical), js)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, mod, mod.exports, ...Object.values(lexical));
  return mod.exports;
}

function fixture(entry, { config = {}, email = payerEmail, authenticated = true, admin = false, paid = false, providerFailure = false } = {}) {
  const [routeName, targetType, action, body] = entry;
  const writes = [], payments = [], requests = [], waiver = [];
  let checkoutBody;
  const tariff = { id: body.tariffId || (routeName === 'applications' ? 'job-response' : 'fair-participation'), action, price: 300, durationDays: 30, active: true };
  const env = { NODE_ENV: 'production', PAYMENT_PROVIDER: 'yookassa', YOOKASSA_SHOP_ID: 'synthetic-shop', YOOKASSA_SECRET_KEY: 'test_synthetic_not_a_credential', YOOKASSA_RECEIPTS_ENABLED: 'true', YOOKASSA_RECEIPT_VAT_CODE: '1', ...config };
  const provider = execute('src/lib/payment-provider.ts', {
    '@/lib/mock-store': { listMockPayments: () => [], markPaymentTargetSucceeded: () => { throw new Error('Unexpected demo publication'); } },
    '@/lib/payment-store': {
      canStorePayment: value => Boolean(value.targetId),
      createStoredPayment: async input => { payments.push(input); return { ...input, tariffId: input.tariff.id, createdAt: '2026-10-07T12:00:00.000Z' }; },
      prepareStoredYooKassaCheckoutIntent: async (_payment, body) => { checkoutBody = body; return { decision: 'post', requestBody: body, remainingMs: 3_600_000 }; },
      authorizeStoredYooKassaCheckoutAttempt: async () => ({ decision: 'post', requestBody: checkoutBody, remainingMs: 3_600_000 }),
      findActiveStoredPaymentForTarget: async () => undefined,
      findStoredPaymentByProvider: async () => undefined,
      getStoredPayment: async () => undefined,
      listStoredPayments: async () => [],
      updateStoredPayment: async value => value,
      markStoredPaymentTargetSucceeded: () => { throw new Error('Creation must not publish'); },
      applyStoredPaymentFulfillment: () => { throw new Error('Pending creation must not fulfill'); },
    },
    '@/lib/runtime-mode': { shouldAllowMockPayments: () => false },
    '@/lib/site-url': { getPublicSiteUrl: () => 'https://example.test' },
    '@/lib/supabase-rest': { isSupabaseRestConfigured: () => true },
    '@/lib/tariff-store': { getActiveStoredTariffById: async () => tariff },
  }, {
    process: { env },
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.yookassa.ru/v3/payments');
      requests.push(JSON.parse(init.body));
      if (providerFailure) return new Response(JSON.stringify({ description: 'synthetic-sensitive-provider-description' }), { status: 500 });
      return new Response(JSON.stringify({ id: '2b3f5e11-000f-5000-8000-123456789abc', status: 'pending', paid: false, test: true, amount: { value: '300.00', currency: 'RUB' }, confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=synthetic' } }), { status: 200 });
    },
  });
  const existing = paid ? { id: target, paymentId: 'previous-paid-payment', paymentStatus: 'succeeded', status: 'sent', applicantUserId: owner } : undefined;
  const save = async value => { writes.push(value); return { ...value, id: target, ...(paid ? existing : {}) }; };
  const deps = {
    'next/server': require('next/server'),
    '@/lib/payment-provider': provider,
    '@/lib/server-auth': { getAuthenticatedRequestUser: async () => authenticated ? { user: { id: owner, email } } : undefined, isSupabaseServerConfigured: () => true, isAdminRequest: async () => admin },
    '@/lib/supabase-rest': { isSupabaseServiceRoleConfigured: () => true, isSupabaseRestConfigured: () => true, isUuid: value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value) },
    '@/lib/storage-upload': { validateMediaStoragePathsForUser: value => value },
    '@/lib/booking-details': { formatBookingPrice: () => '300', sanitizeBookingDetails: () => undefined, validateBookingDetailsForPublication: () => [] },
    '@/lib/listing-store': { createStoredListing: save, findReusableStoredListingForPayment: async () => undefined, updateStoredListingForUser: () => { throw new Error('Unexpected listing update'); } },
    '@/lib/vacancy-store': { createStoredVacancy: save, findReusableStoredVacancyForPayment: async () => undefined, updateStoredVacancyForUser: () => { throw new Error('Unexpected vacancy update'); } },
    '@/lib/work-request-store': { createStoredWorkRequest: save, findReusableStoredWorkRequestForPayment: async () => undefined, updateStoredWorkRequestForUser: () => { throw new Error('Unexpected work update'); } },
    '@/lib/vacancy-requisites': { normalizeVacancyRequisites: value => value, validateVacancyRequisites: () => undefined },
    '@/lib/application-store': { createStoredApplication: save, ensureVacancyCanReceiveApplication: async () => ({ title: 'Вакансия' }), ensureWorkRequestCanReceiveApplication: async () => ({ title: 'Заказ' }), findStoredApplicationForApplicant: async () => existing, findStoredWorkRequestApplicationForApplicant: async () => existing },
    '@/lib/specialist-profile-store': { getActiveStoredSpecialistProfileForUser: async () => ({ id: target, name: 'Специалист' }), getSpecialistProfileCompleteness: () => ({ complete: true, missing: [] }) },
    '@/lib/fair-application-store': { createStoredFairApplication: save, listStoredFairApplications: async () => [], markStoredFairApplicationPaid: async id => { waiver.push(id); return true; } },
    '@/lib/mock-store': { createFairApplication: () => { throw new Error('Unexpected demo application'); }, listFairApplications: () => [] },
    '@/lib/runtime-mode': { shouldShowFallbackContent: () => false },
    '@/lib/turnstile': { TURNSTILE_ERROR_MESSAGE: 'CAPTCHA failure', verifyTurnstileToken: async () => true },
    '@/lib/trusted-proxy-ip': { getTrustedProxyIp: () => '127.0.0.1' },
  };
  const route = execute(`src/app/api/${routeName}/route.ts`, deps, { console: { error() {} } });
  return { provider, writes, payments, requests, waiver, send: (changes = {}) => route.POST(new Request(`https://example.test/api/${routeName}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-not-a-credential' }, body: JSON.stringify({ ...body, ...changes }) })) };
}

for (const entry of cases) {
  for (const [name, options] of [
    ['missing verified payer email', { email: null }],
    ['invalid verified payer email', { email: 'invalid' }],
    ['missing VAT code', { config: { YOOKASSA_RECEIPT_VAT_CODE: '' } }],
    ['invalid VAT code', { config: { YOOKASSA_RECEIPT_VAT_CODE: '99' } }],
    ['missing shop', { config: { YOOKASSA_SHOP_ID: '' } }],
    ['missing secret', { config: { YOOKASSA_SECRET_KEY: '' } }],
    ['missing production provider', { config: { PAYMENT_PROVIDER: '' } }],
  ]) {
    test(`${entry[0]} rejects ${name} before target persistence`, async () => {
      const f = fixture(entry, options);
      let response, escaped;
      try { response = await f.send(); } catch (error) { escaped = error; }
      assert.deepEqual(f.writes, [], 'A configuration error must not leave a saved target');
      assert.deepEqual(f.payments, []);
      assert.deepEqual(f.requests, []);
      assert.equal(escaped, undefined, 'The route must return a bounded response, not throw');
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, 'Оплата сейчас недоступна. Данные не сохранены. Попробуйте позже.');
    });
  }
  test(`${entry[0]} preserves configured checkout and original verified receipt`, async () => {
    const f = fixture(entry);
    assert.equal((await f.send()).status, 201);
    assert.equal(f.writes.length, 1);
    assert.equal(f.payments.length, 1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].receipt.customer.email, payerEmail);
    assert.equal(f.requests[0].metadata.targetType, entry[1]);
  });
  test(`${entry[0]} rejects unauthenticated requests before preflight and all writes`, async () => {
    const f = fixture(entry, { authenticated: false, config: { YOOKASSA_SECRET_KEY: '' } });
    assert.equal((await f.send()).status, 401);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.payments, []);
    assert.deepEqual(f.requests, []);
  });
  test(`${entry[0]} disabled receipts require neither payer email nor VAT code`, async () => {
    const f = fixture(entry, { email: null, config: { YOOKASSA_RECEIPTS_ENABLED: 'false', YOOKASSA_RECEIPT_VAT_CODE: '99' } });
    assert.equal((await f.send()).status, 201);
    assert.equal(f.writes.length, 1);
    assert.equal(f.requests.length, 1);
    assert.equal('receipt' in f.requests[0], false);
  });
}

test('draft vacancy and work-request saves do not require merchant or receipt configuration', async () => {
  for (const entry of cases.filter(value => ['vacancies', 'work-requests'].includes(value[0]))) {
    const f = fixture(entry, { email: null, config: { YOOKASSA_SECRET_KEY: '', YOOKASSA_RECEIPT_VAT_CODE: '' } });
    assert.equal((await f.send({ status: 'draft', tariffId: '' })).status, 201);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.requests, []);
  }
});

test('existing paid responses retain their no-checkout path despite unavailable receipt configuration', async () => {
  const f = fixture(cases[3], { paid: true, email: null, config: { YOOKASSA_SECRET_KEY: '' } });
  const response = await f.send();
  assert.equal(response.status, 201);
  assert.equal((await response.json()).application.id, target);
  assert.deepEqual(f.payments, []);
  assert.deepEqual(f.requests, []);
});

test('the separate admin-only fair waiver does not require payment configuration', async () => {
  const f = fixture(cases[4], { admin: true, email: null, config: { YOOKASSA_SECRET_KEY: '' } });
  assert.equal((await f.send({ skipPayment: true })).status, 201);
  assert.deepEqual(f.waiver, [target]);
  assert.deepEqual(f.payments, []);
  assert.deepEqual(f.requests, []);
  const rejected = fixture(cases[4]);
  assert.equal((await rejected.send({ skipPayment: true })).status, 403);
  assert.deepEqual(rejected.writes, []);
});

test('an uncertain provider failure returns the saved pending fair application for recovery without fabricated payment', async () => {
  const f = fixture(cases[4], { providerFailure: true });
  const response = await f.send();
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.application.id, target);
  assert.equal(payload.payment, undefined);
  assert.equal(payload.paymentError, 'Заявка сохранена и ожидает оплаты. Не создавайте её повторно: продолжите оплату сохранённой заявки.');
  assert.equal(f.writes.length, 1);
  assert.equal(f.payments.length, 1);
  assert.equal(f.requests.length, 3);
  assert.equal(JSON.stringify(payload).includes('synthetic-sensitive-provider-description'), false);
});
