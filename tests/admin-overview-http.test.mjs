import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as boundary from '../src/lib/auth-http.ts';
import * as cookie from '../src/lib/account-cookie.ts';
import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import * as identity from '../src/lib/listing-draft-contract.ts';
import {loadAdminModule} from './admin-module.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
function handler() {
  const exports = {}, dependencies = {
    'node:crypto': require('node:crypto'), './auth-http': boundary, './account-cookie': cookie,
    './trusted-proxy-ip': proxy, './admin-authorization': loadAdminModule('admin-authorization'),
    './listing-draft-contract.ts': identity,
  };
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../src/lib/admin-overview-http.ts', import.meta.url), 'utf8'),
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText)(path => {
      if (!Object.hasOwn(dependencies, path)) throw Error(`Unapproved overview HTTP dependency: ${path}`);
      return dependencies[path];
    }, exports);
  return exports.createAdminOverviewHandler;
}
const origin = 'https://overview.example.invalid', actor = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);
const summary = {users: {total: 1, blocked: 0}, publications: {total: 3, awaitingReview: 1}, tariffs: {total: 2, active: 1}, adMarquee: {total: 0, awaitingReview: 0}};
function request(body = {expectedAdminId: actor}, headers = {}, method = 'POST') {
  return new Request(origin + '/api/admin/overview', {method, headers: {
    host: 'overview.example.invalid', origin, 'content-type': 'application/json',
    'x-blizhniy-request': '1', 'x-real-ip': '192.0.2.4', cookie: '__Host-blizhniy_session=' + token, ...headers,
  }, ...(method === 'GET' ? {} : {body: JSON.stringify(body)})});
}
test('primary overview rejects legacy bearer, forged origin, missing ingress and extra client authority before runtime access', async () => {
  let calls = 0;
  const handle = handler()({origin}, () => {calls++; assert.fail('Invalid request accessed runtime');}, () => {});
  for (const [body, headers, method, status] of [
    [{expectedAdminId: actor}, {}, 'GET', 405],
    [{expectedAdminId: actor, role: 'admin'}, {}, 'POST', 422],
    [{expectedAdminId: 'invalid'}, {}, 'POST', 422],
    [{expectedAdminId: actor}, {cookie: '', authorization: 'Bearer legacy'}, 'POST', 401],
    [{expectedAdminId: actor}, {origin: 'https://foreign.example.invalid'}, 'POST', 403],
    [{expectedAdminId: actor}, {'x-blizhniy-request': ''}, 'POST', 403],
    [{expectedAdminId: actor}, {'x-real-ip': ''}, 'POST', 403],
    [{expectedAdminId: actor}, {'content-length': '999999'}, 'POST', 413],
  ]) assert.equal((await handle(request(body, headers, method))).status, status);
  assert.equal(calls, 0);
});
test('overview returns guarded aggregate data, shared-limit failures and generic errors without leaking identity to audit', async () => {
  const events = [], calls = [];
  let allowed = true, failure;
  const handle = handler()({origin}, () => ({limiter: {allowProduction: async (...args) => {
    assert.deepEqual(args, ['session', '192.0.2.4']); return allowed;
  }}, store: {read: async (...args) => {calls.push(args); if (failure) throw failure; return summary;}}}), event => events.push(event));
  const success = await handle(request());
  assert.equal(success.status, 200); assert.deepEqual(await success.json(), summary);
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.equal(success.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(calls, [[token, actor]]);
  allowed = false;
  const limited = await handle(request()); assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '900'); assert.equal(calls.length, 1);
  allowed = true; failure = new (loadAdminModule('admin-authorization').AdminAccessError)();
  assert.equal((await handle(request())).status, 403);
  failure = new Error('private-database-hostname');
  const unavailable = await handle(request()); assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {error: {code: 'OVERVIEW_UNAVAILABLE'}});
  for (const privateValue of [actor, token, 'private-database-hostname']) assert.equal(JSON.stringify(events).includes(privateValue), false);
  assert.equal(calls.length, 3);
});
