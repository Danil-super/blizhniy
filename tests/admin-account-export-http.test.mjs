import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const load = createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const { createAdminAccountExportHandler } = load('admin-account-export-http');
const origin = 'https://example.test';
const admin = 'ad0545ab-36ca-4a21-9921-c8762d47bc3d';
const different = 'ad0545ab-36ca-4a21-9921-c8762d47bc3a';
const token = 'a'.repeat(64);
const input = { expectedAdminId: admin, caseId: 'REVIEW_001' };

function request(body = input, headers = {}) {
  return new Request(origin + '/api/admin/account-export', {
    method: 'POST',
    headers: {
      host: new URL(origin).host, origin, 'x-blizhniy-request': '1',
      'x-real-ip': '127.0.0.1', 'content-type': 'application/json',
      cookie: '__Host-blizhniy_session=' + token, ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('the active administrator can approve only the case and their own session', async () => {
  const calls = [];
  const handle = createAdminAccountExportHandler({ origin }, () => ({
    allow: async () => true,
    resolve: async () => ({ id: admin, role: 'admin' }),
  }), async (caseId, operatorToken) => calls.push({ caseId, operatorToken }));
  const response = await handle(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'prepared' });
  assert.deepEqual(calls, [{ caseId: input.caseId, operatorToken: token }]);
});

test('invalid cases, other roles, old identities and cross-origin requests never reach preparation', async () => {
  let principal = { id: admin, role: 'user' };
  let allowed = true;
  const handle = createAdminAccountExportHandler({ origin }, () => ({
    allow: async () => allowed,
    resolve: async () => principal,
  }), () => assert.fail('The operator was invoked'));

  assert.equal((await handle(request())).status, 403);
  principal = { id: different, role: 'admin' };
  assert.equal((await handle(request())).status, 409);
  assert.equal((await handle(request({ ...input, ownerId: different }))).status, 422);
  assert.equal((await handle(request({ ...input, caseId: 'case/../other' }))).status, 422);
  assert.equal((await handle(request(input, { origin: 'https://outside.test' }))).status, 403);
  assert.equal((await handle(request(input, { cookie: '' }))).status, 401);
  allowed = false;
  assert.equal((await handle(request())).status, 429);
});

test('a preparation error returns no internal metadata or session', async () => {
  const handle = createAdminAccountExportHandler({ origin }, () => ({
    allow: async () => true,
    resolve: async () => ({ id: admin, role: 'admin' }),
  }), async () => { throw Error('Private failure ' + token); });
  const response = await handle(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: 'EXPORT_UNAVAILABLE' } });
});
