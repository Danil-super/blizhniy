const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const root = resolve(__dirname, '..');
const paymentId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const payload = (status, fulfillmentStatus, targetType = 'listing') => ({
  payment: { id: paymentId, status, fulfillmentStatus, targetId, targetType, targetTitle: 'Synthetic item' },
  nextStatus: targetType === 'application' ? 'sent' : targetType === 'ad_marquee' ? 'paid' : 'published',
});
async function flush() { for (let i = 0; i < 35; i += 1) await Promise.resolve(); }

function harness({ responses = [], componentPayload, createdPayment } = {}) {
  const modules = new Map();
  const requests = [], notifications = [], publicationWrites = [], events = [], redirects = [], timers = [];
  const confirmations = [], creations = [];
  const states = [], effects = [];
  let hookIndex = 0;
  const react = {
    ...React,
    useState(initial) {
      const index = hookIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(effect) { effects.push(effect); },
  };
  const origin = { identity: { accessToken: 'synthetic-token', userId: 'synthetic-owner' }, assertCurrentSession: async () => {} };
  const stubs = {
    react,
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { useRouter: () => ({ replace: (href) => redirects.push(href) }) },
    '@/components/BackLink': { BackLink: ({ fallbackHref, children, ...props }) => React.createElement('a', { href: fallbackHref, ...props }, children) },
    '@/components/BrandName': { BrandName: () => 'Ближний' },
    '@/components/LegalConsentCheckbox': { LegalLink: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/supabase-browser': { isSupabaseBrowserConfigured: () => false, getSupabaseBrowserClient: () => { throw new Error('No real Auth client in fixture'); } },
    '@/lib/client-user-profile': { captureClientUserOperation: async () => origin, readCabinetProfile: async () => ({}) },
    '@/lib/site-notifications': { addCurrentUserNotification: async (input) => notifications.push(input), addSiteNotification: () => { throw new Error('No authenticated return fixture'); } },
    '@/lib/cabinet-data-cache': { markCabinetDataChanged() {} },
    '@/lib/client-media-store': { getStoredMediaFile: async () => undefined },
    '@/lib/client-runtime-mode': { shouldShowClientFallbackContent: () => false },
    '@/lib/demo-publications': {
      demoPublicationsUpdatedEvent: 'synthetic-publications-updated',
      readStoredDemoPublications: () => JSON.stringify([{ id: targetId, type: 'listing', status: 'Черновик' }]),
      writeStoredDemoPublications: (value) => publicationWrites.push(value),
      withPublicationStatusHistory: (item, status) => ({ ...item, status }),
    },
  };
  const context = vm.createContext({
    console, Promise, Error, URL,
    process: { env: { NODE_ENV: 'production' } },
    window: { dispatchEvent: (event) => events.push(event), setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } },
    Event: class Event { constructor(type) { this.type = type; } },
    setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {},
    async fetch(url, options) {
      requests.push({ url, options });
      const next = responses[Math.min(requests.length - 1, responses.length - 1)];
      assert.ok(next, 'Every synthetic confirmation response must be explicit');
      return { ok: true, json: async () => next };
    },
  });
  function load(filename) {
    const absolute = resolve(root, filename);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const js = ts.transpileModule(readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: absolute,
    }).outputText;
    vm.runInContext(`(function(require, module, exports) { ${js}\n})`, context, { filename: absolute })(
      (id) => {
        if (componentPayload && id === '@/lib/client-payment-flow') return {
          confirmClientPayment: async (id) => { confirmations.push(id); return componentPayload; },
          createClientPayment: async (input) => {
            assert.ok(createdPayment, 'Existing payment must be reused');
            creations.push(input);
            return createdPayment;
          },
        };
        if (id in stubs) return stubs[id];
        if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
        const base = id.startsWith('@/') ? resolve(root, 'src', id.slice(2)) : resolve(dirname(absolute), id);
        const path = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => /\.(ts|tsx)$/.test(candidate) && existsSync(candidate));
        assert.ok(path, `Actual dependency ${id} must exist`);
        return load(path);
      }, module, module.exports,
    );
    return module.exports;
  }
  function render(component, props) { hookIndex = 0; return component(props); }
  return {
    load, requests, notifications, publicationWrites, events, redirects, timers, confirmations, creations,
    async mountReturn() {
      const component = load('src/components/payments/PaymentReturnClient.tsx').PaymentReturnClient;
      render(component, { paymentId });
      effects[0]();
      await flush();
      return renderToStaticMarkup(render(component, { paymentId }));
    },
    async clickMock({ withoutPayment = false } = {}) {
      const component = load('src/components/payments/MockPaymentButton.tsx').MockPaymentButton;
      const props = { ...(withoutPayment ? {} : { paymentId }), tariffId: 'synthetic-tariff', returnHref: '/cabinet' };
      const find = (node, type) => {
        if (!node || typeof node !== 'object') return undefined;
        if (node.type === type) return node;
        return React.Children.toArray(node.props?.children).map((child) => find(child, type)).find(Boolean);
      };
      let tree = render(component, props);
      find(tree, 'input').props.onChange({ target: { checked: true } });
      tree = render(component, props);
      await find(tree, 'button').props.onClick();
      return renderToStaticMarkup(render(component, props));
    },
  };
}

for (const [status, fulfillment, heading] of [
  ['failed', undefined, /Оплата не завершена/],
  ['refunded', 'applied', /Платеж возвращен/],
  ['succeeded', 'blocked', /Оплата требует проверки/],
  ['succeeded', 'pending', /Услуга ожидает применения/],
  ['succeeded', undefined, /Услуга ожидает применения/],
]) {
  test(`return renders truthful ${status}/${fulfillment ?? 'unknown'} without activation or redirect`, async () => {
    const h = harness({ componentPayload: payload(status, fulfillment) });
    const html = await h.mountReturn();
    assert.match(html, heading);
    assert.doesNotMatch(html, /публикация активирована|Статус заказа обновлен|animate-spin/);
    assert.equal(h.timers.length, 0);
    assert.deepEqual(h.redirects, []);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, /role="status"/);
    assert.match(html, /Открыть кабинет/);
  });
}

test('return applied control confirms the applied service and only then schedules redirect', async () => {
  const h = harness({ componentPayload: payload('succeeded', 'applied') });
  const html = await h.mountReturn();
  assert.match(html, /Платеж подтвержден/);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 600);
  h.timers[0].fn();
  assert.deepEqual(h.redirects, ['/cabinet/obyavleniya']);
});

test('marquee applied finance with unknown queue has warning/manual retry and no applied redirect', async () => {
  const value = { ...payload('succeeded', 'applied', 'ad_marquee'), nextStatus: undefined };
  const h = harness({ componentPayload: value });
  const outcome = h.load('src/lib/payment-confirmation-outcome.ts').getPaymentConfirmationOutcome(value);
  assert.equal(outcome.kind, 'queue_pending');
  assert.equal(outcome.tone, 'warning');
  assert.equal(outcome.canRetry, true);
  const html = await h.mountReturn();
  assert.match(html, /Проверить статус еще раз/);
  assert.match(html, /повторно оплачивать не нужно/i);
  assert.match(html, /role="status"/);
  assert.equal(h.timers.length, 0);
  assert.deepEqual(h.redirects, []);
  assert.equal(value.payment.fulfillmentStatus, 'applied');
});

for (const nextStatus of ['active', 'paid']) test(`confirmed marquee ${nextStatus} retains ordinary applied result`, async () => {
  const value = { ...payload('succeeded', 'applied', 'ad_marquee'), nextStatus };
  const h = harness({ componentPayload: value });
  const outcome = h.load('src/lib/payment-confirmation-outcome.ts').getPaymentConfirmationOutcome(value);
  assert.equal(outcome.kind, 'applied');
  const html = await h.mountReturn();
  assert.equal(h.timers.length, 1);
  if (nextStatus === 'paid') assert.match(html, /ожидает активации в очереди/);
});

for (const [status, fulfillment] of [['pending', undefined], ['failed', undefined], ['refunded', 'applied'], ['succeeded', 'blocked'], ['succeeded', 'pending']]) {
  test(`pay button does not announce publication for ${status}/${fulfillment ?? 'unknown'}`, async () => {
    const h = harness({ componentPayload: payload(status, fulfillment) });
    const html = await h.clickMock();
    assert.doesNotMatch(html, /Заявка опубликована|Отклик отправлен работодателю|Вернуться в историю/);
  });
}

for (const status of ['failed', 'refunded']) {
  test(`confirmation stops immediately on terminal ${status}, with truthful notification`, async () => {
    const h = harness({ responses: [payload(status, 'pending')] });
    await h.load('src/lib/client-payment-flow.ts').confirmClientPayment(paymentId);
    assert.equal(h.requests.length, 1);
    assert.equal(h.notifications.length, 1);
    assert.doesNotMatch(h.notifications[0].title + h.notifications[0].message, /ожидает подтверждения|публикация активирована/);
    assert.deepEqual(h.publicationWrites, []);
  });
}

test('pending control retries until financial success and applied entitlement', async () => {
  const h = harness({ responses: [payload('pending', 'pending'), payload('succeeded', 'applied')] });
  const result = await h.load('src/lib/client-payment-flow.ts').confirmClientPayment(paymentId);
  assert.equal(h.requests.length, 2);
  assert.equal(result.payment.status, 'succeeded');
  assert.equal(h.publicationWrites.length, 1);
});

test('blocked fulfillment cannot mutate client publications despite a forged published nextStatus', async () => {
  const h = harness({ responses: [payload('succeeded', 'blocked')] });
  await h.load('src/lib/client-payment-flow.ts').confirmClientPayment(paymentId);
  assert.deepEqual(h.publicationWrites, []);
  assert.deepEqual(h.events, []);
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0].message, /не применена|проверка/);
  assert.doesNotMatch(h.notifications[0].message, /публикация активирована/);
});

test('applied control synchronizes the publication exactly once', () => {
  const h = harness();
  h.load('src/lib/client-payment-flow.ts').syncPaidPublication(payload('succeeded', 'applied'));
  assert.equal(h.publicationWrites.length, 1);
  assert.ok(h.events.length > 0);
});

test('a pending newly created checkout is reused when the pay control is clicked again', async () => {
  const h = harness({ componentPayload: payload('pending', 'pending'), createdPayment: { id: paymentId, status: 'created' } });
  assert.match(await h.clickMock({ withoutPayment: true }), /Проверить статус/);
  await h.clickMock({ withoutPayment: true });
  assert.equal(h.creations.length, 1);
  assert.deepEqual(h.confirmations, [paymentId, paymentId]);
});

test('unknown/malformed payment state does not trigger twenty requests or claim activation', async () => {
  const h = harness({ responses: [{ nextStatus: 'published', payment: { id: paymentId, fulfillmentStatus: 'applied' } }] });
  await h.load('src/lib/client-payment-flow.ts').confirmClientPayment(paymentId);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.publicationWrites, []);
  assert.match(h.notifications[0].title, /недоступен/);
});

test('legacy target marker alone does not fabricate applied fulfillment', () => {
  const h = harness();
  const old = payload('succeeded');
  old.payment.targetAppliedAt = '2020-01-01T12:00:00Z';
  h.load('src/lib/client-payment-flow.ts').syncPaidPublication(old);
  assert.deepEqual(h.publicationWrites, []);
});

test('queued paid marquee is not described as already active', async () => {
  const h = harness({ componentPayload: payload('succeeded', 'applied', 'ad_marquee') });
  const html = await h.mountReturn();
  assert.match(html, /ожидает активации в очереди/);
  assert.doesNotMatch(html, /публикация активирована/);
});

test('notification deduplication distinguishes financial success, blocked and applied service', () => {
  const h = harness();
  const { paymentConfirmationNotification } = h.load('src/lib/payment-confirmation-outcome.ts');
  const notices = [payload('pending', 'pending'), payload('succeeded', 'pending'), payload('succeeded', 'blocked'), payload('succeeded', 'applied')]
    .map((body) => paymentConfirmationNotification(body, paymentId));
  assert.equal(new Set(notices.map((notice) => notice.dedupeKey)).size, 4);
  assert.notEqual(notices[2].tone, 'success');
  assert.equal(notices[3].tone, 'success');
});
