import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { loadLocalPrimaryModule } = require('../scripts/local-primary-modules.cjs');
const { createProductionAccountHandler } = loadLocalPrimaryModule('production-account-http');
const { accountSessionCookieName } = loadLocalPrimaryModule('account-cookie');
const { dataSubjectCookieName } = loadLocalPrimaryModule('data-subject-cookie');
const origin = 'https://xn----9sbphbgks4a4a.xn--p1ai';
const appToken = 'a'.repeat(64), limitedToken = 'b'.repeat(64), newAppToken = 'c'.repeat(64);
const appCookie = `${accountSessionCookieName}=${appToken}`;
const limitedCookie = `${dataSubjectCookieName}=${limitedToken}`;
const credentials = { email: 'second-user@local.invalid', password: 'Testing-only-passphrase-2026!', captchaToken: 'synthetic-proof' };
const secondUser = { id: '22222222-2222-4222-8222-222222222222', email: credentials.email, role: 'user', isBlocked: false };

function fixture({ successfulLogin = true, captcha = true, limited = false } = {}) {
  const revoked = [], logins = [];
  let factories = 0;
  const runtime = {
    store: { register: async () => ({}), resendConfirmation: async () => null, confirmEmail: async () => true },
    recovery: { requestRecovery: async () => null, resetPassword: async () => null },
    identity: {
      login: async (...args) => {
        logins.push(args);
        return successfulLogin ? { token: newAppToken, scope: 'app', user: secondUser, expiresAt: new Date(Date.now() + 3600_000) } : null;
      },
      resolveSession: async () => secondUser,
      revokeSession: async token => { revoked.push(token); },
    },
    limiter: { allowProduction: async () => !limited, allowProductionAttempt: async () => !limited, allowProductionEmail: async () => !limited },
    verifyCaptcha: async () => captcha,
  };
  const handler = createProductionAccountHandler({ origin, rateSecret: 'local_only_test_rate_secret_1234567890',
    mailKeyFile: '/unused', rememberedCaptcha: true }, () => { factories++; return runtime; }, () => {});
  const request = (operation, cookies, body = {}) => new Request(`${origin}/api/account/${operation}`, {
    method: 'POST', headers: { host: new URL(origin).host, origin, 'x-blizhniy-request': '1',
      'content-type': 'application/json', 'x-real-ip': '192.0.2.9', 'sec-fetch-site': 'same-origin', cookie: cookies },
    body: JSON.stringify(body),
  });
  return { handler, request, revoked, logins, get factories() { return factories; } };
}

function assertCleared(response, name) {
  const matching = response.headers.getSetCookie().filter(value => value.startsWith(name + '='));
  assert.equal(matching.length, 1, `${name} must be cleared exactly once`);
  assert.match(matching[0], new RegExp(`^${name}=;`));
  assert.ok(matching[0].includes('Max-Age=0'));
  assert.ok(matching[0].includes('Path=/') && matching[0].includes('HttpOnly') && matching[0].includes('Secure'));
}

test('ordinary logout revokes both browser credentials and clears both host cookies', async () => {
  const f = fixture();
  const response = await f.handler(f.request('logout', `${appCookie}; ${limitedCookie}`), 'logout');
  assert.equal(response.status, 200);
  assert.deepEqual(new Set(f.revoked), new Set([appToken, limitedToken]));
  assertCleared(response, accountSessionCookieName);
  assertCleared(response, dataSubjectCookieName);
});

test('ordinary logout still revokes restricted access when the app cookie has already expired', async () => {
  const f = fixture();
  const response = await f.handler(f.request('logout', limitedCookie), 'logout');
  assert.equal(response.status, 200);
  assert.equal(f.factories, 1, 'the cookie-only early return must not leave a server-side rights session live');
  assert.deepEqual(f.revoked, [limitedToken]);
  assertCleared(response, accountSessionCookieName);
  assertCleared(response, dataSubjectCookieName);
});

test('successful normal login discards the prior limited identity before the shared browser changes accounts', async () => {
  const f = fixture();
  const response = await f.handler(f.request('login', `${appCookie}; ${limitedCookie}`, credentials), 'login');
  assert.equal(response.status, 200);
  assert.ok(f.revoked.includes(limitedToken), 'the previous owner rights session cannot survive account switching');
  assertCleared(response, dataSubjectCookieName);
  assert.deepEqual(f.logins, [[credentials.email, credentials.password, appToken]]);
  const appCookies = response.headers.getSetCookie().filter(value => value.startsWith(accountSessionCookieName + '='));
  assert.equal(appCookies.length, 1);
  assert.ok(appCookies[0].startsWith(`${accountSessionCookieName}=${newAppToken};`));
  assert.deepEqual((await response.json()).user, secondUser);
});

test('failed normal login preserves both existing identities instead of silently signing their owner out', async () => {
  for (const [options, status] of [[{ successfulLogin: false }, 401], [{ captcha: false }, 403], [{ limited: true }, 429]]) {
    const f = fixture(options);
    const response = await f.handler(f.request('login', `${appCookie}; ${limitedCookie}`, credentials), 'login');
    assert.equal(response.status, status);
    assert.deepEqual(f.revoked, []);
    for (const name of [accountSessionCookieName, dataSubjectCookieName]) {
      assert.ok(!response.headers.getSetCookie().some(value => value.startsWith(name + '=')), `${name} must remain untouched`);
    }
  }
});
