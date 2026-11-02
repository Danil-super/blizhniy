import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { loadLocalPrimaryModule } = require('../scripts/local-primary-modules.cjs');
const { createAccountDeletionHandler } = loadLocalPrimaryModule('account-deletion-http');
const { issueBrowserProof } = loadLocalPrimaryModule('account-browser-proof');
const { DeletionAccessError, DeletionConflictError } = loadLocalPrimaryModule('account-deletion-contract');
const { AppSessionAccessError } = loadLocalPrimaryModule('app-session-transaction');
const origin = 'https://xn----9sbphbgks4a4a.xn--p1ai';
const owner = '11111111-1111-4111-8111-111111111111';
const caseId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const appToken = 'a'.repeat(64), restrictedToken = 'b'.repeat(64), issuedToken = 'c'.repeat(64);
const appCookie = `__Host-blizhniy_session=${appToken}`;
const limitedCookie = `__Host-blizhniy_data_subject=${restrictedToken}`;
const email = 'owner@local.invalid';
const password = 'Testing-Only-Password-2026';
const config = { origin, rateSecret: 'local_test_only_rate_secret_1234567890', mailKeyFile: '/unused', rememberedCaptcha: true };
const principal = { id: owner, email, isBlocked: true };
const agent = 'Owned local test browser';

function request(body = {}, { method = 'POST', headers = {}, path = '/api/account/deletion/request', raw } = {}) {
  return new Request(origin + path, { method,
    headers: { host: new URL(origin).host, origin, 'content-type': 'application/json',
      'x-blizhniy-request': '1', 'sec-fetch-site': 'same-origin', 'x-real-ip': '192.0.2.31', 'user-agent': agent, ...headers },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: raw ?? JSON.stringify(body) }) });
}

function fixture({ runtimePatch = {}, storePatch = {}, identityPatch = {}, limiterPatch = {}, remembered = true } = {}) {
  const calls = [], events = [];
  let lazy = 0;
  const record = (name, result) => async (...args) => { calls.push([name, ...args]); return result; };
  const runtime = {
    store: {
      session: record('session', principal), read: record('read', null), request: record('request', { id: caseId, status: 'requested' }),
      list: record('list', { items: [], hasMore: false }), begin: record('begin', { id: caseId, status: 'in_review' }),
      resolve: record('resolve', { id: caseId, status: 'resolved' }), ...storePatch,
    },
    identity: {
      loginForDataSubject: record('loginForDataSubject', { token: issuedToken, scope: 'data-subject',
        expiresAt: new Date(Date.now() + 3600_000), user: { ...principal, role: 'user', passwordHash: 'must-not-leak' } }),
      revokeSession: record('revokeSession', undefined), ...identityPatch,
    },
    limiter: { allowProduction: record('allowProduction', true), allowProductionAttempt: record('allowProductionAttempt', true),
      allowProductionEmail: record('allowProductionEmail', true), ...limiterPatch },
    verifyCaptcha: record('verifyCaptcha', true), ...runtimePatch,
  };
  const handler = createAccountDeletionHandler({ ...config, ...(remembered ? {} : { rememberedCaptcha: undefined }) },
    async () => { lazy++; return runtime; }, event => events.push(event));
  return { handler, calls, events, get lazy() { return lazy; } };
}

test('deletion boundary rejects malformed origins, ingress and bodies before creating its runtime', async () => {
  const variants = [
    [{ method: 'GET' }, 405], [{ headers: { origin: 'https://evil.invalid' } }, 403],
    [{ headers: { host: 'evil.invalid' } }, 403], [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403],
    [{ headers: { 'x-blizhniy-request': '0' } }, 403], [{ headers: { 'x-real-ip': '' } }, 403],
    [{ headers: { 'x-real-ip': '192.0.2.1, 192.0.2.2' } }, 403],
    [{ headers: { 'x-real-ip': '', 'x-forwarded-for': '192.0.2.31', 'cf-connecting-ip': '192.0.2.31' } }, 403],
    [{ headers: { 'content-type': 'text/plain' } }, 415], [{ path: '/api/account/deletion/request?token=bad' }, 400],
    [{ raw: '{not-json}' }, 400], [{ raw: ' '.repeat(4097) }, 413],
  ];
  for (const [options, status] of variants) {
    const f = fixture();
    const response = await f.handler(request({ access: 'account', expectedOwnerId: owner }, options), 'request');
    assert.equal(response.status, status, JSON.stringify(options));
    assert.equal(f.lazy, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('unknown deletion operations are rejected lazily and never echo the supplied operation', async () => {
  const f = fixture();
  const malicious = 'private-owner-email@example.invalid';
  const response = await f.handler(request(), malicious);
  assert.equal(response.status, 404);
  assert.equal(f.lazy, 0);
  assert.ok(!JSON.stringify(f.events).includes(malicious));
});

test('strict deletion payloads reject additional authority and malformed identifiers before runtime', async () => {
  for (const [operation, body, admin] of [
    ['request', { access: 'account', expectedOwnerId: owner, userId: owner }, false],
    ['read', { access: 'account', expectedOwnerId: owner, role: 'admin' }, false],
    ['read', { access: 'account', expectedOwnerId: 'another-user' }, false],
    ['session', { access: 'admin' }, false], ['session', { access: 'account', token: appToken }, false],
    ['login', { email, password, captchaToken: 'proof', role: 'admin' }, false],
    ['login', { email: 'not-an-email', password, captchaToken: 'proof' }, false],
    ['login', { email, password: 'x'.repeat(257), captchaToken: 'proof' }, false],
    ['login', { email, password, captchaToken: 'x'.repeat(2049) }, false],
    ['list', { expectedAdminId: adminId, page: -1 }, true],
    ['list', { expectedAdminId: adminId, page: 0.5 }, true],
    ['list', { expectedAdminId: adminId, page: 1001 }, true],
    ['begin', { expectedAdminId: adminId, id: caseId, revision: '0' }, true],
    ['begin', { expectedAdminId: adminId, id: caseId, revision: '9223372036854775808' }, true],
  ]) {
    const f = fixture();
    const response = await f.handler(request(body, { headers: { cookie: appCookie } }), operation, admin);
    assert.equal(response.status, 422, operation + JSON.stringify(body));
    assert.equal(f.lazy, 0);
    assert.equal(f.calls.length, 0);
  }
});

test('body, query and bearer credentials cannot replace the selected HttpOnly cookie', async () => {
  for (const [operation, body, headers, admin] of [
    ['read', { access: 'account', expectedOwnerId: owner }, { authorization: `Bearer ${appToken}` }, false],
    ['session', { access: 'account' }, { cookie: limitedCookie }, false],
    ['session', { access: 'data-subject' }, { cookie: appCookie }, false],
    ['request', { access: 'data-subject', expectedOwnerId: owner }, {}, false],
    ['list', { expectedAdminId: adminId, page: 0 }, { cookie: limitedCookie }, true],
    ['session', { access: 'account' }, { cookie: `${appCookie}; ${appCookie}` }, false],
    ['session', { access: 'data-subject' }, { cookie: `${limitedCookie}; ${limitedCookie}` }, false],
  ]) {
    const f = fixture();
    const response = await f.handler(request(body, { headers }), operation, admin);
    assert.equal(response.status, 401);
    assert.equal(f.lazy, 0);
  }
});

test('explicit credential selection binds the owner operation to exactly one cookie', async () => {
  for (const [access, token] of [['account', appToken], ['data-subject', restrictedToken]]) {
    for (const operation of ['read', 'request']) {
      const f = fixture();
      const response = await f.handler(request({ access, expectedOwnerId: owner },
        { headers: { cookie: `${appCookie}; ${limitedCookie}` } }), operation);
      assert.ok(response.ok);
      assert.deepEqual(f.calls.filter(call => call[0] === operation), [[operation, token, owner]]);
    }
    const f = fixture();
    const response = await f.handler(request({ access }, { headers: { cookie: `${appCookie}; ${limitedCookie}` } }), 'session');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: principal });
    assert.deepEqual(f.calls.filter(call => call[0] === 'session'), [['session', token]]);
  }
});

test('rights login uses the ordinary login budgets for each CAPTCHA configuration', async () => {
  for (const remembered of [true, false]) {
    const f = fixture({ remembered });
    const response = await f.handler(request({ email: ' OWNER@LOCAL.INVALID ', password, captchaToken: 'provider-proof' },
      { headers: { cookie: appCookie } }), 'login');
    assert.equal(response.status, 200);
    assert.deepEqual(f.calls, remembered ? [
      ['allowProductionAttempt', 'login', '192.0.2.31'], ['verifyCaptcha', 'provider-proof', '192.0.2.31'],
      ['allowProductionEmail', 'login', email], ['loginForDataSubject', email, password],
    ] : [
      ['allowProduction', 'credential', '192.0.2.31', email], ['verifyCaptcha', 'provider-proof', '192.0.2.31'],
      ['loginForDataSubject', email, password],
    ]);
    const data = await response.json();
    assert.deepEqual(data.user, principal);
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.some(value => value.startsWith(`__Host-blizhniy_data_subject=${issuedToken};`)));
    assert.ok(cookies.every(value => !value.startsWith('__Host-blizhniy_session=')));
    const issued = cookies.find(value => value.startsWith('__Host-blizhniy_data_subject='));
    const maxAge = Number(/Max-Age=(\d+)/.exec(issued)?.[1]);
    assert.ok(maxAge > 0 && maxAge <= 3600);
    assert.ok(issued.includes('HttpOnly') && issued.includes('Secure') && issued.includes('SameSite=Lax'));
    const serialized = JSON.stringify(data);
    for (const secret of [appToken, issuedToken, password, 'passwordHash', 'must-not-leak', 'role']) {
      assert.ok(!serialized.includes(secret), secret);
    }
  }
});

test('rate denial before CAPTCHA cannot spend the email budget or verify a password', async () => {
  const f = fixture({ limiterPatch: { allowProductionAttempt: async () => false } });
  const response = await f.handler(request({ email, password, captchaToken: 'proof' }), 'login');
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '900');
  assert.equal(f.calls.length, 0);
});

test('invalid CAPTCHA cannot consume email capacity or reach authentication', async () => {
  const f = fixture({ runtimePatch: { verifyCaptcha: async () => false } });
  const response = await f.handler(request({ email, password, captchaToken: 'invalid-proof' }), 'login');
  assert.equal(response.status, 403);
  assert.deepEqual(f.calls, [['allowProductionAttempt', 'login', '192.0.2.31']]);
});

test('only a boolean CAPTCHA success is trusted, unexpected truthy provider values fail closed', async () => {
  for (const providerResult of ['false', 'true', {}, 1]) {
    const f = fixture({ runtimePatch: { verifyCaptcha: async () => providerResult } });
    const response = await f.handler(request({ email, password, captchaToken: 'provider-result-invalid' }), 'login');
    assert.equal(response.status, 403);
    assert.deepEqual(f.calls, [['allowProductionAttempt', 'login', '192.0.2.31']]);
  }
});

test('email rate denial after CAPTCHA cannot run the password verifier', async () => {
  const f = fixture({ limiterPatch: { allowProductionEmail: async () => false } });
  const response = await f.handler(request({ email, password, captchaToken: 'proof' }), 'login');
  assert.equal(response.status, 429);
  assert.deepEqual(f.calls, [['allowProductionAttempt', 'login', '192.0.2.31'], ['verifyCaptcha', 'proof', '192.0.2.31']]);
});

test('forged browser proof hints cannot bypass CAPTCHA, valid signed proof can', async () => {
  const forged = fixture();
  const deniedResponse = await forged.handler(request({ email, password, captchaToken: '' },
    { headers: { 'x-blizhniy-human-proof': String(Date.now() + 60000), cookie: '__Host-blizhniy_human=forged' } }), 'login');
  assert.equal(deniedResponse.status, 403);
  assert.ok(!forged.calls.some(call => call[0] === 'loginForDataSubject'));
  const proofCookie = issueBrowserProof(config.rateSecret, '192.0.2.31', agent).cookie.split(';')[0];
  const valid = fixture();
  const response = await valid.handler(request({ email, password, captchaToken: '' }, { headers: { cookie: proofCookie } }), 'login');
  assert.equal(response.status, 200);
  assert.deepEqual(valid.calls, [
    ['allowProductionAttempt', 'login', '192.0.2.31'], ['allowProductionEmail', 'login', email], ['loginForDataSubject', email, password],
  ]);
});

test('invalid credentials and unexpected issued scopes never establish restricted access', async () => {
  for (const issued of [null, { token: issuedToken, scope: 'app', expiresAt: new Date(Date.now() + 3600_000), user: principal },
    { token: issuedToken, scope: 'data-subject', expiresAt: new Date(Date.now() - 1000), user: principal }]) {
    const f = fixture({ identityPatch: { loginForDataSubject: async () => issued } });
    const response = await f.handler(request({ email, password, captchaToken: 'proof' }), 'login');
    assert.equal(response.status, issued ? 503 : 401);
    assert.ok(!response.headers.getSetCookie().some(value => value.startsWith('__Host-blizhniy_data_subject=')));
  }
});

test('restricted logout revokes and clears only the restricted cookie', async () => {
  const f = fixture();
  const response = await f.handler(request({}, { headers: { cookie: `${appCookie}; ${limitedCookie}` } }), 'logout');
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.filter(call => call[0] === 'revokeSession'), [['revokeSession', restrictedToken]]);
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith('__Host-blizhniy_data_subject=;') && value.includes('Max-Age=0')));
  assert.ok(response.headers.getSetCookie().every(value => !value.startsWith('__Host-blizhniy_session=')));
});

test('admin mutations are bound to the app cookie, captured admin identity and revision', async () => {
  const bodies = [
    ['list', { expectedAdminId: adminId, page: 0 }, [appToken, adminId, 0]],
    ['begin', { expectedAdminId: adminId, id: caseId, revision: '1' }, [appToken, adminId, caseId, '1']],
    ['resolve', { expectedAdminId: adminId, id: caseId, revision: '2', decision: {
      resolution: 'declined', caseReference: 'CASE_2026-01', confirmedManualDecision: true,
    } }, [appToken, adminId, caseId, '2', { resolution: 'declined', caseReference: 'CASE_2026-01', confirmedManualDecision: true }]],
  ];
  for (const [operation, body, args] of bodies) {
    const f = fixture();
    const response = await f.handler(request(body, { headers: { cookie: `${appCookie}; ${limitedCookie}` } }), operation, true);
    assert.ok(response.ok);
    assert.deepEqual(f.calls.filter(call => call[0] === operation), [[operation, ...args]]);
  }
});

test('manual decision input cannot fake completion without explicit confirmation and protected case reference', async () => {
  const decision = { resolution: 'fulfilled', caseReference: 'CASE_2026-01', confirmedManualDecision: true };
  for (const patch of [{ confirmedManualDecision: false }, { confirmedManualDecision: 'true' },
    { caseReference: '' }, { caseReference: 'https://private.invalid/case' }, { resolution: 'deleted' }, { ownerId: owner }]) {
    const f = fixture();
    const response = await f.handler(request({ expectedAdminId: adminId, id: caseId, revision: '2', decision: { ...decision, ...patch } },
      { headers: { cookie: appCookie } }), 'resolve', true);
    assert.equal(response.status, 422);
    assert.equal(f.lazy, 0);
  }
});

test('authorization loss, revision conflict and unexpected database failures map to bounded public errors', async () => {
  for (const [error, status] of [[new DeletionAccessError(), 401], [new AppSessionAccessError(), 401],
    [new DeletionConflictError(), 409], [new Error('secret database detail ' + password), 503]]) {
    const f = fixture({ storePatch: { request: async () => { throw error; } } });
    const response = await f.handler(request({ access: 'account', expectedOwnerId: owner }, { headers: { cookie: appCookie } }), 'request');
    assert.equal(response.status, status);
    const data = await response.json();
    assert.equal(typeof data.error.code, 'string');
    if (status === 409) assert.equal(data.error.code, 'REQUEST_CHANGED');
    assert.ok(!JSON.stringify(data).includes(password));
    assert.ok(!JSON.stringify(f.events).includes(password));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('deletion audit contains correlation metadata and never credentials, contact data or private case content', async () => {
  const f = fixture();
  const response = await f.handler(request({ email, password, captchaToken: 'private-captcha' },
    { headers: { cookie: `${appCookie}; ${limitedCookie}` } }), 'login');
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].status, response.status);
  assert.equal(f.events[0].operation, 'login');
  assert.match(f.events[0].requestId, /^[a-f0-9-]{36}$/);
  assert.equal(response.headers.get('x-request-id'), f.events[0].requestId);
  const serialized = JSON.stringify(f.events);
  for (const privateValue of [email, password, appToken, restrictedToken, issuedToken, 'private-captcha', '192.0.2.31', agent]) {
    assert.ok(!serialized.includes(privateValue), privateValue);
  }
  for (const event of f.events) {
    assert.ok(Object.keys(event).every(key => ['event', 'requestId', 'operation', 'status', 'code', 'durationMs'].includes(key)));
  }
});
