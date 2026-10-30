import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { loadLocalPrimaryModule } = require('../scripts/local-primary-modules.cjs');
const contract = loadLocalPrimaryModule('account-deletion-contract');
const cookie = loadLocalPrimaryModule('data-subject-cookie');
const accountCookie = loadLocalPrimaryModule('account-cookie');
const { withDataSubjectTransaction } = loadLocalPrimaryModule('data-subject-transaction');
const { withAppSessionTransaction } = loadLocalPrimaryModule('app-session-transaction');
const ownerId = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);
const invalidInput = error => error.name === 'DeletionInputError';
const denied = error => error.name === 'DeletionAccessError';

test('deletion identifiers and revisions accept canonical values and reject overflow and coercion', () => {
  assert.equal(contract.deletionId(ownerId), ownerId);
  for (const value of [null, 1, [], {}, ownerId.toUpperCase().replace('11111111', 'AAAAAAAA'),
    '11111111-1111-0111-8111-111111111111', '11111111-1111-4111-1111-111111111111', `${ownerId}\n`]) {
    assert.throws(() => contract.deletionId(value), invalidInput);
  }
  for (const value of ['1', '9223372036854775807']) {
    assert.equal(contract.deletionRevision(value), value);
  }
  for (const value of ['0', '-1', '01', '1.0', '1e2', '1 ', '9223372036854775808',
    '1000000000000000000000000', 1, null, { toString: () => '1' }]) {
    assert.throws(() => contract.deletionRevision(value), invalidInput);
  }
});

test('deletion payloads reject inherited, extra and symbol fields and accept only explicit credential selection', () => {
  const plain = { access: 'account' };
  assert.equal(contract.deletionObject(plain, ['access']), plain);
  const nullPrototype = Object.assign(Object.create(null), { access: 'data-subject' });
  assert.equal(contract.deletionObject(nullPrototype, ['access']), nullPrototype);
  for (const value of [null, [], 'account', Object.create({ access: 'account' }),
    { access: 'account', role: 'admin' }, { access: 'account', [Symbol('extra')]: true }]) {
    assert.throws(() => contract.deletionObject(value, ['access']), invalidInput);
  }
  assert.equal(contract.deletionAccess('account'), 'account');
  assert.equal(contract.deletionAccess('data-subject'), 'data-subject');
  for (const value of [null, 'admin', '', 'Account', { toString: () => 'account' }]) {
    assert.throws(() => contract.deletionAccess(value), invalidInput);
  }
});

test('manual deletion decisions require a precise resolution, protected case reference and positive confirmation', () => {
  for (const resolution of ['fulfilled', 'partly_retained', 'declined']) {
    assert.deepEqual(contract.deletionDecision({ resolution, caseReference: 'CASE_2026-01', confirmedManualDecision: true }),
      { resolution, caseReference: 'CASE_2026-01' });
  }
  const valid = { resolution: 'declined', caseReference: 'CASE_2026-01', confirmedManualDecision: true };
  for (const mutation of [
    { resolution: 'deleted' }, { resolution: null }, { resolution: 1 },
    { caseReference: 'short' }, { caseReference: 'x'.repeat(81) }, { caseReference: 'CASE/123' },
    { caseReference: 'CASE\n123' }, { confirmedManualDecision: false }, { confirmedManualDecision: 'true' },
  ]) assert.throws(() => contract.deletionDecision({ ...valid, ...mutation }), invalidInput);
  assert.throws(() => contract.deletionDecision({ ...valid, ownerId }), invalidInput);
});

test('manual decision enum never accepts objects by executing their string conversion', () => {
  let coercions = 0;
  const resolution = { toString() { coercions++; return 'fulfilled'; } };
  assert.throws(() => contract.deletionDecision({ resolution, caseReference: 'CASE_2026-01', confirmedManualDecision: true }), invalidInput);
  assert.equal(coercions, 0, 'untrusted enum objects must not execute code during validation');
});

test('data-subject cookie is a separate one-hour host-only HttpOnly credential', () => {
  const value = cookie.createDataSubjectCookie(token, 3600);
  assert.match(value, /^__Host-blizhniy_data_subject=[a-f0-9]{64};/);
  for (const flag of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=3600', 'Expires=']) {
    assert.ok(value.includes(flag));
  }
  assert.ok(!/Domain=/i.test(value));
  assert.notEqual(cookie.dataSubjectCookieName, accountCookie.accountSessionCookieName);
  assert.match(cookie.createDataSubjectCookie('', 0), /Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT$/);
  for (const maxAge of [-1, 3601, 8 * 3600, 0.5, NaN, '3600']) {
    assert.throws(() => cookie.createDataSubjectCookie(token, maxAge));
  }
  for (const value of ['', token.toUpperCase(), token + '\n', 'a'.repeat(63), token + '; Path=/evil']) {
    assert.throws(() => cookie.createDataSubjectCookie(value, 3600));
  }
  assert.throws(() => cookie.createDataSubjectCookie(token, 0));
});

test('restricted and ordinary cookies cannot substitute for each other or for body/query/Bearer credentials', () => {
  const request = headers => new Request('https://example.test/api/account/deletion/session?token=' + token,
    { method: 'POST', headers, body: JSON.stringify({ token }) });
  assert.equal(cookie.readDataSubjectToken(request({ cookie: `${cookie.dataSubjectCookieName}=${token}` })), token);
  assert.equal(cookie.readDataSubjectToken(request({ cookie: `${accountCookie.accountSessionCookieName}=${token}` })), null);
  assert.equal(accountCookie.readAccountSessionToken(request({ cookie: `${cookie.dataSubjectCookieName}=${token}` })), null);
  assert.equal(cookie.readDataSubjectToken(request({ authorization: `Bearer ${token}` })), null);
  assert.equal(cookie.readDataSubjectToken(request({})), null);
  for (const header of [
    `${cookie.dataSubjectCookieName}=${token}; ${cookie.dataSubjectCookieName}=${token}`,
    `${cookie.dataSubjectCookieName}=${token}; ${cookie.dataSubjectCookieName}=bad`,
    `${cookie.dataSubjectCookieName}=${token.toUpperCase()}`,
    `${cookie.dataSubjectCookieName}=${token}x`,
    `other=${'x'.repeat(4096)}; ${cookie.dataSubjectCookieName}=${token}`,
  ]) assert.equal(cookie.readDataSubjectToken(request({ cookie: header })), null);
});

function transactionFixture({ blocked = true, missingUser = false, missingSession = false, expiredAfterWork = false } = {}) {
  const principal = { id: ownerId, email: 'owner@local.invalid', isBlocked: blocked, authVersion: '7', verified: true, role: 'user' };
  const calls = [];
  const state = { commits: 0, rollbacks: 0, persisted: false, staged: false };
  return { principal, calls, state, db: {
    async transaction(work) {
      try {
        const result = await work({ query: async (sql, params) => {
          calls.push({ sql, params });
          if (calls.length === 1) return { rows: missingUser ? [] : [principal], rowCount: missingUser ? 0 : 1 };
          if (calls.length === 2) return { rows: [], rowCount: missingSession ? 0 : 1 };
          return { rows: [], rowCount: expiredAfterWork ? 0 : 1 };
        } });
        state.commits++;
        state.persisted = state.staged;
        return result;
      } catch (error) {
        state.rollbacks++;
        state.staged = false;
        throw error;
      }
    },
  } };
}

test('verified blocked owners retain the dedicated rights-request boundary without ordinary app access', async () => {
  const fixture = transactionFixture();
  assert.equal(await withDataSubjectTransaction(fixture.db, token, async (_tx, user) => {
    assert.equal(user, fixture.principal);
    return user.id;
  }), ownerId);
  assert.equal(fixture.state.commits, 1);
  const appFixture = transactionFixture();
  let appWork = 0;
  await assert.rejects(withAppSessionTransaction(appFixture.db, token, async () => { appWork++; }),
    error => error.name === 'AppSessionAccessError');
  assert.equal(appWork, 0);
  assert.equal(appFixture.state.commits, 0);
});

test('invalid or revoked rights sessions never execute protected work and raw credentials never reach SQL', async () => {
  for (const options of [{ missingUser: true }, { missingSession: true }, {}]) {
    const fixture = transactionFixture(options);
    const chosenToken = Object.keys(options).length ? token : 'not-a-session-token';
    let work = 0;
    await assert.rejects(withDataSubjectTransaction(fixture.db, chosenToken, async () => { work++; }), denied);
    assert.equal(work, 0);
    assert.equal(fixture.state.commits, 0);
    const serialized = JSON.stringify(fixture.calls);
    assert.ok(!serialized.includes(token));
    if (fixture.calls.length) {
      assert.equal(fixture.calls[0].params[0], createHash('sha256').update(token).digest('hex'));
    }
  }
});

test('session expiry while waiting on protected work rolls back instead of committing a request', async () => {
  const fixture = transactionFixture({ expiredAfterWork: true });
  let work = 0;
  await assert.rejects(withDataSubjectTransaction(fixture.db, token, async () => {
    work++;
    fixture.state.staged = true;
    return { id: ownerId };
  }), denied);
  assert.equal(work, 1, 'the post-work validity check is necessary even after authorized entry');
  assert.equal(fixture.state.commits, 0);
  assert.equal(fixture.state.rollbacks, 1);
  assert.equal(fixture.state.persisted, false);
});

test('work exceptions propagate and cannot refresh or commit the restricted session', async () => {
  const fixture = transactionFixture();
  const failure = new Error('simulated protected resource failure');
  await assert.rejects(withDataSubjectTransaction(fixture.db, token, async () => { throw failure; }), error => error === failure);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.state.commits, 0);
  assert.equal(fixture.state.rollbacks, 1);
});
