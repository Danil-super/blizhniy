import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { loadLocalPrimaryModule } = require('../scripts/local-primary-modules.cjs');
const { AuthRateLimiter } = loadLocalPrimaryModule('auth-http');
const { createProductionAccountHandler } = loadLocalPrimaryModule('production-account-http');
const { createAccountDeletionHandler } = loadLocalPrimaryModule('account-deletion-http');
const origin = 'https://xn----9sbphbgks4a4a.xn--p1ai';
const email = 'shared-budget@local.invalid';
const token = 'a'.repeat(64);
const user = { id: '11111111-1111-4111-8111-111111111111', email, role: 'user', isBlocked: false };

function handlers(rememberedCaptcha) {
  // Model the single fixed-window SQL counter shared by both HTTP runtimes.
  // The actual AuthRateLimiter builds every HMAC key and chooses each limit.
  const counters = new Map();
  const db = { query: async (_sql, [key, limit]) => {
    const attempts = Math.min((counters.get(key) ?? 0) + 1, limit + 1);
    counters.set(key, attempts);
    return { rows: [{ allowed: attempts <= limit }] };
  } };
  const limiter = new AuthRateLimiter(db, 'synthetic_shared_rate_secret_1234567890');
  const passwordChecks = [];
  const login = scope => async (...args) => {
    passwordChecks.push({ scope, args });
    return { token, user, scope, expiresAt: new Date(Date.now() + 3600_000) };
  };
  const runtime = {
    limiter, verifyCaptcha: async () => true,
    store: { register: async () => ({}), resendConfirmation: async () => null, confirmEmail: async () => true },
    recovery: { requestRecovery: async () => null, resetPassword: async () => null },
    identity: { login: login('app'), loginForDataSubject: login('data-subject'),
      resolveSession: async () => user, revokeSession: async () => {} },
  };
  const config = { origin, rateSecret: 'synthetic_shared_rate_secret_1234567890', mailKeyFile: '/unused',
    ...(rememberedCaptcha ? { rememberedCaptcha: true } : {}) };
  return {
    normal: createProductionAccountHandler(config, () => runtime, () => {}),
    rights: createAccountDeletionHandler(config, () => runtime, () => {}),
    passwordChecks,
  };
}

function request(rights, index) {
  return new Request(origin + (rights ? '/api/account/deletion/login' : '/api/account/login'), {
    method: 'POST', headers: { host: new URL(origin).host, origin, 'x-blizhniy-request': '1',
      'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-real-ip': '192.0.2.17' },
    body: JSON.stringify({ email: index % 2 ? email.toUpperCase() : email,
      password: 'Synthetic budget password 2026!', captchaToken: 'valid-synthetic-captcha' }),
  });
}

for (const remembered of [false, true]) {
  for (const startsWithRights of [false, true]) {
    test(`ordinary and rights login share five password checks (remembered=${remembered}, rights first=${startsWithRights})`, async () => {
      const f = handlers(remembered);
      const statuses = [];
      for (let index = 0; index < 6; index++) {
        const rights = Boolean(index % 2) !== startsWithRights;
        const handler = rights ? f.rights : f.normal;
        statuses.push((await handler(request(rights, index), 'login')).status);
      }
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429],
        'changing the endpoint must not create an additional per-email password budget');
      assert.equal(f.passwordChecks.length, 5, 'the sixth combined request must be denied before password verification');
      assert.ok(f.passwordChecks.every(check => check.args[0] === email));
      assert.ok(f.passwordChecks.some(check => check.scope === 'app'));
      assert.ok(f.passwordChecks.some(check => check.scope === 'data-subject'));
    });
  }
}
