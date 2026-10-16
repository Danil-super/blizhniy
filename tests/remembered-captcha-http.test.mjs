import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthRateLimiter } from '../src/lib/auth-http.ts';
import { issueBrowserProof, readBrowserProof } from '../src/lib/account-browser-proof.ts';
import * as cookies from '../src/lib/account-cookie.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import { loadProductionAuth } from './production-auth-module.mjs';

const configModule = loadProductionAuth('production-auth-config');
const { createProductionAccountHandler } = loadProductionAuth('production-account-http', {
  './account-cookie': cookies, './trusted-proxy-ip': proxy, './production-auth-config': configModule,
});
const origin = configModule.productionAuthOrigin;
const secret = 's'.repeat(64);
const ip = '192.0.2.1';
const agent = 'SyntheticBrowser/1.0';
const email = 'synthetic@example.invalid';
const humanCookie = response => response.headers.getSetCookie().find(value => value.startsWith('__Host-blizhniy_human='));
const cookiePair = value => value.split(';')[0];

function fixture(options = {}) {
  const counters = new Map();
  const calls = { factories: 0, captchas: [], logins: [], recovery: [], session: 0 };
  let captcha = options.captcha ?? true;
  const db = { query: async (_sql, [key, limit]) => {
    const count = Math.min((counters.get(key) ?? 0) + 1, limit + 1);
    counters.set(key, count);
    return { rows: [{ allowed: count <= limit }] };
  } };
  const runtime = {
    limiter: new AuthRateLimiter(db, secret),
    verifyCaptcha: async (...args) => { calls.captchas.push(args); return captcha; },
    identity: {
      login: async (...args) => { calls.logins.push(args); return options.issued ?? null; },
      resolveSession: async () => { calls.session++; return null; },
    },
    recovery: { requestRecovery: async value => { calls.recovery.push(value); return null; } },
  };
  const handle = createProductionAccountHandler({ origin, rateSecret: secret, mailKeyFile: '/synthetic/key.bin', rememberedCaptcha: true },
    () => { calls.factories++; return runtime; }, () => {});
  const request = (action, data = {}, headers = {}) => new Request(`${origin}/api/account/${action}`, {
    method: 'POST',
    headers: { host: new URL(origin).host, origin, 'x-blizhniy-request': '1', 'content-type': 'application/json',
      'x-real-ip': ip, 'user-agent': agent, ...headers },
    body: JSON.stringify({ ...(action === 'session' ? {} : { email, captchaToken: 'synthetic-proof',
      ...(action === 'login' ? { password: 'Synthetic test passphrase!' } : {}) }), ...data }),
  });
  return { calls, handle, request, setCaptcha: value => { captcha = value; } };
}

test('valid CAPTCHA on a failed login issues human proof and permits recovery without another provider call', async () => {
  const f = fixture();
  const before = Date.now();
  const login = await f.handle(f.request('login'), 'login');
  const after = Date.now();
  assert.equal(login.status, 401);
  assert.deepEqual(await login.json(), { error: { code: 'INVALID_CREDENTIALS' } });
  const cookie = humanCookie(login);
  assert.ok(cookie);
  assert.equal(login.headers.getSetCookie().some(value => value.startsWith('__Host-blizhniy_session=')), false);
  const expires = Number(login.headers.get('X-Blizhniy-Human-Proof'));
  assert.ok(expires >= before + 900000 && expires <= after + 900000);
  assert.equal(readBrowserProof(new Headers({ cookie: cookiePair(cookie), 'user-agent': agent }), secret, ip), expires);

  const recovery = await f.handle(f.request('recover', { captchaToken: '' }, { cookie: cookiePair(cookie) }), 'recover');
  assert.equal(recovery.status, 202);
  assert.deepEqual(await recovery.json(), { status: 'accepted' });
  assert.equal(recovery.headers.get('X-Blizhniy-Human-Proof'), String(expires));
  assert.deepEqual(f.calls.recovery, [email]);
  assert.deepEqual(f.calls.captchas, [['synthetic-proof', ip]]);
});

test('missing, expired, changed-IP, changed-agent and tampered proofs require CAPTCHA and clear the cookie', async () => {
  const valid = cookiePair(issueBrowserProof(secret, ip, agent).cookie);
  const expired = cookiePair(issueBrowserProof(secret, ip, agent, Date.now() - 900001).cookie);
  const tampered = valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a');
  for (const requestHeaders of [{}, { cookie: expired }, { cookie: valid, 'x-real-ip': '192.0.2.2' },
    { cookie: valid, 'user-agent': 'OtherSyntheticBrowser/2.0' }, { cookie: tampered }]) {
    const f = fixture();
    const response = await f.handle(f.request('recover', { captchaToken: '' }, requestHeaders), 'recover');
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'CAPTCHA_REQUIRED' } });
    assert.equal(response.headers.get('X-Blizhniy-Human-Proof'), '0');
    assert.match(humanCookie(response), /^__Host-blizhniy_human=;.*Max-Age=0/);
    assert.equal(f.calls.captchas.length, 0);
    assert.equal(f.calls.recovery.length, 0);
    assert.equal(f.calls.logins.length, 0);
  }
});

test('rejected CAPTCHA attempts do not spend the five verified-attempt email allowance', async () => {
  const f = fixture({ captcha: false });
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await f.handle(f.request('login'), 'login');
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: { code: 'CAPTCHA_REQUIRED' } });
  }
  assert.equal(f.calls.logins.length, 0);
  f.setCaptcha(true);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await f.handle(f.request('login'), 'login')).status, 401);
  }
  assert.equal((await f.handle(f.request('login'), 'login')).status, 429);
  assert.equal(f.calls.logins.length, 5);
});

test('five failed logins preserve a proof until throttling clears it, while recovery retains an independent budget', async () => {
  const f = fixture();
  const first = await f.handle(f.request('login'), 'login');
  assert.equal(first.status, 401);
  const cookie = cookiePair(humanCookie(first));
  for (let attempt = 1; attempt < 5; attempt++) {
    assert.equal((await f.handle(f.request('login', { captchaToken: '' }, { cookie }), 'login')).status, 401);
  }
  const limited = await f.handle(f.request('login', { captchaToken: '' }, { cookie }), 'login');
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: { code: 'RATE_LIMITED' } });
  assert.equal(limited.headers.get('X-Blizhniy-Human-Proof'), '0');
  assert.match(humanCookie(limited), /^__Host-blizhniy_human=;.*Max-Age=0/);
  assert.equal(limited.headers.get('Retry-After'), '900');
  assert.equal(f.calls.captchas.length, 1);
  assert.equal(f.calls.logins.length, 5);

  const recovery = await f.handle(f.request('recover'), 'recover');
  assert.equal(recovery.status, 202);
  assert.deepEqual(await recovery.json(), { status: 'accepted' });
  assert.deepEqual(f.calls.recovery, [email]);
  assert.equal(f.calls.captchas.length, 2);
});

test('a forged proof hint grants neither CAPTCHA acceptance nor an account session', async () => {
  const f = fixture();
  const forged = { 'X-Blizhniy-Human-Proof': String(Date.now() + 900000) };
  const login = await f.handle(f.request('login', { captchaToken: '' }, forged), 'login');
  assert.equal(login.status, 403);
  assert.deepEqual(await login.json(), { error: { code: 'CAPTCHA_REQUIRED' } });
  assert.equal(f.calls.captchas.length, 0);
  assert.equal(f.calls.logins.length, 0);
  assert.equal(login.headers.getSetCookie().some(value => value.startsWith('__Host-blizhniy_session=')), false);
  const proof = cookiePair(issueBrowserProof(secret, ip, agent).cookie);
  const session = await f.handle(f.request('session', {}, { ...forged, cookie: proof }), 'session');
  assert.equal(session.status, 401);
  assert.equal(f.calls.session, 0);
});

test('successful login retains both its account session cookie and the separate human proof cookie', async () => {
  const user = { id: 'synthetic-user', email, role: 'user', isBlocked: false };
  const f = fixture({ issued: { user, token: 'a'.repeat(64), scope: 'app', expiresAt: new Date(Date.now() + 3600000) } });
  const response = await f.handle(f.request('login'), 'login');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'authenticated', user });
  const issuedCookies = response.headers.getSetCookie();
  assert.equal(issuedCookies.length, 2);
  assert.ok(issuedCookies.some(value => value.startsWith('__Host-blizhniy_session=')));
  assert.ok(issuedCookies.some(value => value.startsWith('__Host-blizhniy_human=')));
  for (const value of issuedCookies) assert.match(value, /Secure; HttpOnly|HttpOnly; Secure/);
  assert.ok(Number(response.headers.get('X-Blizhniy-Human-Proof')) > Date.now());
});

test('cross-site requests are rejected before creating runtime, touching proof, or invoking the CAPTCHA provider', async () => {
  const f = fixture();
  const cookie = cookiePair(issueBrowserProof(secret, ip, agent).cookie);
  const response = await f.handle(f.request('recover', { captchaToken: '' }, {
    cookie, origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site',
  }), 'recover');
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('X-Blizhniy-Human-Proof'), null);
  assert.deepEqual(response.headers.getSetCookie(), []);
  assert.equal(f.calls.factories, 0);
  assert.equal(f.calls.captchas.length, 0);
  assert.equal(f.calls.recovery.length, 0);
  assert.equal(f.calls.logins.length, 0);
});
