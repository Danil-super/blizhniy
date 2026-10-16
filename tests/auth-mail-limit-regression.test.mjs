import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthRateLimiter } from '../src/lib/auth-http.ts';
import * as cookies from '../src/lib/account-cookie.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import { loadProductionAuth } from './production-auth-module.mjs';

const configModule = loadProductionAuth('production-auth-config');
const { createProductionAccountHandler } = loadProductionAuth('production-account-http', {
  './account-cookie': cookies,
  './trusted-proxy-ip': proxy,
  './production-auth-config': configModule,
});
const origin = configModule.productionAuthOrigin;

function fixture() {
  const counters = new Map();
  const recoveryRequests = [];
  const db = {
    query: async (_sql, [key, limit]) => {
      const count = Math.min((counters.get(key) ?? 0) + 1, limit + 1);
      counters.set(key, count);
      return { rows: [{ allowed: count <= limit }] };
    },
  };
  const runtime = {
    limiter: new AuthRateLimiter(db, 's'.repeat(64)),
    verifyCaptcha: async () => true,
    identity: { login: async () => null },
    recovery: { requestRecovery: async email => { recoveryRequests.push(email); return null; } },
  };
  const handle = createProductionAccountHandler({
    origin,
    rateSecret: 's'.repeat(64),
    mailKeyFile: '/synthetic/key.bin',
    rememberedCaptcha: true,
  }, () => runtime, () => {});
  const request = (action, email) => new Request(`${origin}/api/account/${action}`, {
    method: 'POST',
    headers: {
      host: new URL(origin).host,
      origin,
      'x-blizhniy-request': '1',
      'content-type': 'application/json',
      'x-real-ip': '192.0.2.1',
    },
    body: JSON.stringify({
      email,
      captchaToken: 'synthetic-proof',
      ...(action === 'login' ? { password: 'Synthetic test passphrase!' } : {}),
    }),
  });
  return { handle, request, recoveryRequests };
}

test('recovery remains accessible after the same email exhausts five login attempts', async () => {
  const f = fixture();
  const email = 'synthetic@example.invalid';
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await f.handle(f.request('login', email), 'login')).status, 401);
  }
  const throttled = await f.handle(f.request('login', email), 'login');
  assert.equal(throttled.status, 429);
  assert.deepEqual(await throttled.json(), { error: { code: 'RATE_LIMITED' } });

  const recovery = await f.handle(f.request('recover', email), 'recover');
  assert.equal(recovery.status, 202, 'login email throttling must not consume the recovery email budget');
  assert.deepEqual(await recovery.json(), { status: 'accepted' });
  assert.deepEqual(f.recoveryRequests, [email]);
});

test('recovery remains accessible after an IP exhausts twenty login attempts across emails', async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 20; attempt++) {
    const email = `synthetic-${attempt}@example.invalid`;
    assert.equal((await f.handle(f.request('login', email), 'login')).status, 401);
  }
  const throttled = await f.handle(f.request('login', 'synthetic-overflow@example.invalid'), 'login');
  assert.equal(throttled.status, 429);
  assert.deepEqual(await throttled.json(), { error: { code: 'RATE_LIMITED' } });

  const email = 'synthetic-recovery@example.invalid';
  const recovery = await f.handle(f.request('recover', email), 'recover');
  assert.equal(recovery.status, 202, 'login IP throttling must not consume the recovery IP budget');
  assert.deepEqual(await recovery.json(), { status: 'accepted' });
  assert.deepEqual(f.recoveryRequests, [email]);
});
