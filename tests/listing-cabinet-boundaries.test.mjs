import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import * as draft from '../src/lib/listing-draft-contract.ts';
import * as cabinet from '../src/lib/listing-cabinet-contract.ts';
import * as auth from '../src/lib/auth-http.ts';
import * as cookie from '../src/lib/account-cookie.ts';
import * as ingress from '../src/lib/trusted-proxy-ip.ts';
import {loadAdminModule} from './admin-module.mjs';

const ts = createRequire(import.meta.url)('typescript');
const session = loadAdminModule('app-session-transaction');
function module(name, dependencies) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Real approved dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const {createListingCabinetClient} = module('client-listing-cabinet', {'./listing-draft-contract.ts': draft, './listing-cabinet-contract.ts': cabinet});
const {createListingCabinetHandler} = module('listing-cabinet-http', {'./auth-http': auth, './account-cookie': cookie,
  './trusted-proxy-ip': ingress, './app-session-transaction': session, './listing-draft-contract.ts': draft,
  './listing-cabinet-contract.ts': cabinet});
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64), origin = 'https://cabinet.example.invalid';
const summary = {id, revision: '9007199254740993', kind: 'prodam', title: 'Комод', price: '3500.00',
  card: {city: 'Сочи', district: null, coverPhotoId: null, status: 'draft', blockReason: null}};
const page = {items: [summary], nextCursor: null, workflow: 'postmoderation'};
const errorCode = code => error => error.code === code && !error.message.includes('synthetic-private');

test('cabinet client carries only same-origin cookie authority, strict identity and exact cursor without retry', async () => {
  const calls = [], client = createListingCabinetClient(async (...args) => {calls.push(args); return Response.json(page);});
  const cursor = {id, updatedAt: '2026-10-20T12:00:00.123456Z'};
  assert.deepEqual(await client.list(owner, cursor), page);
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, '/api/account/listings'); assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
  assert.deepEqual(options.headers, {'Content-Type': 'application/json', 'X-Blizhniy-Request': '1'});
  assert.deepEqual(JSON.parse(options.body), {expectedOwnerId: owner, cursor});
  assert.ok(options.signal instanceof AbortSignal);
});
test('cabinet client refuses invalid identity, invalid microsecond cursor or pre-aborted call before transport', async () => {
  let calls = 0; const client = createListingCabinetClient(async () => {calls++; return Response.json(page);});
  const controller = new AbortController(); controller.abort();
  for (const work of [() => client.list('invalid'), () => client.list(owner, {id, updatedAt: '2026-10-20T12:00:00.123Z'}),
    () => client.list(owner, null, {signal: controller.signal})]) await assert.rejects(work(), errorCode('UNKNOWN'));
  assert.equal(calls, 0);
});
for (const [status, code] of [[401, 'UNAUTHENTICATED'], [409, 'SESSION_CHANGED'], [422, 'INVALID_INPUT'], [429, 'RATE_LIMITED']]) {
  test(`cabinet client accepts only matching ${status}/${code} and never retries`, async () => {
    let calls = 0;
    const client = createListingCabinetClient(async () => {calls++; return Response.json({error: {code}}, {status});});
    await assert.rejects(client.list(owner), errorCode(code)); assert.equal(calls, 1);
    const mismatch = createListingCabinetClient(async () => Response.json({error: {code}}, {status: status === 401 ? 409 : 401}));
    await assert.rejects(mismatch.list(owner), errorCode('UNKNOWN'));
  });
}
test('cabinet client denies malformed or privileged shapes rather than silently inventing a status', async () => {
  for (const payload of [null, {...page, workflow: 'live'}, {...page, secret: 'synthetic-private'}, {...page, items: [summary, summary]},
    {...page, items: Array(21).fill(summary)}, {...page, nextCursor: {id, updatedAt: '2026-10-20T12:00:00.123456Z'}},
    {...page, items: [{...summary, revision: 2}]}, {...page, items: [{...summary, isPaid: true}]},
    {...page, items: [{...summary, card: {...summary.card, status: 'approved'}}]},
    {...page, items: [{...summary, card: {...summary.card, status: 'blocked'}}]},
    {...page, items: [{...summary, card: {...summary.card, blockReason: 'Not blocked'}}]},
    {...page, items: [{...summary, card: {...summary.card, coverPhotoId: 'https://external.invalid/photo'}}]},
    {...page, items: [{...summary, card: {...summary.card, city: ' bad '}}]}]) {
    let calls = 0;
    const client = createListingCabinetClient(async () => {calls++; return Response.json(payload);});
    await assert.rejects(client.list(owner), errorCode('UNKNOWN')); assert.equal(calls, 1);
  }
});
test('cabinet client rejects and cancels a streamed body above 128 KiB, invalid UTF-8, redirects and missing body', async () => {
  let cancelled = false;
  const body = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(131073));}, cancel() {cancelled = true;}});
  await assert.rejects(createListingCabinetClient(async () => new Response(body)).list(owner), errorCode('UNKNOWN'));
  assert.equal(cancelled, true);
  for (const response of [new Response(new Uint8Array([0xc3, 0x28])), new Response(null, {status: 204}),
    Response.json(page, {status: 302, headers: {Location: 'https://external.invalid/'}})]) {
    await assert.rejects(createListingCabinetClient(async () => response).list(owner), errorCode('UNKNOWN'));
  }
  let calls = 0;
  await assert.rejects(createListingCabinetClient(async () => {calls++; throw Error('synthetic-private network detail');}).list(owner), errorCode('UNKNOWN'));
  assert.equal(calls, 1);
});

function server({allow = true, failure = null, payload = page} = {}) {
  const calls = []; let runtimes = 0;
  const handle = createListingCabinetHandler({origin}, async () => {
    runtimes++;
    return {limiter: {allowProduction: async (...args) => {calls.push(['limit', ...args]); return allow;}},
      store: {list: async (...args) => {calls.push(['list', ...args]); if (failure) throw failure; return payload;}}};
  });
  const request = ({headers = {}, body = {expectedOwnerId: owner, cursor: null}, query = '', method = 'POST'} = {}) => new Request(origin + '/api/account/listings' + query, {
    method, headers: {host: new URL(origin).host, origin, 'content-type': 'application/json', 'x-blizhniy-request': '1',
      'x-real-ip': '192.0.2.3', cookie: `__Host-blizhniy_session=${token}`, ...headers},
    ...(method === 'GET' ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)}),
  });
  return {handle, request, calls, runtimes: () => runtimes};
}
test('cabinet HTTP reads the owner-scoped page with canonical cookie and session budget, returning private headers', async () => {
  const f = server(), cursor = {id, updatedAt: '2026-10-20T12:00:00.123456Z'};
  const response = await f.handle(f.request({body: {expectedOwnerId: owner, cursor}}));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), page);
  assert.deepEqual(f.calls, [['limit', 'session', '192.0.2.3'], ['list', token, owner, cursor]]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('set-cookie'), null);
});
test('clients request listing placement dates explicitly and the previous cabinet shape stays readable',async()=>{
 const payload={...page,items:[{...summary,card:{...summary.card,
  placement:{expiresAt:'2026-11-25T21:00:00.000001Z',active:false},
 }}]};
 const f=server({payload});
 assert.deepEqual(await (await f.handle(f.request())).json(),page);
 const updated=createListingCabinetClient((_url,options)=>f.handle(f.request({
  headers:Object.fromEntries(new Headers(options.headers)),body:options.body,
 })),{includePlacement:true});
 assert.deepEqual(await updated.list(owner),payload);
});
for (const [description, input, status] of [
  ['missing cookie cannot use Bearer authority', {headers: {cookie: '', authorization: `Bearer ${token}`}}, 401],
  ['duplicate cookies', {headers: {cookie: `__Host-blizhniy_session=${token}; __Host-blizhniy_session=${token}`}}, 401],
  ['wrong origin', {headers: {origin: 'https://external.invalid'}}, 403],
  ['missing origin', {headers: {origin: ''}}, 403],
  ['wrong target host', {headers: {host: 'external.invalid'}}, 403],
  ['missing request marker', {headers: {'x-blizhniy-request': ''}}, 403],
  ['cross-site fetch', {headers: {'sec-fetch-site': 'cross-site'}}, 403],
  ['missing ingress cannot use Cloudflare or XFF', {headers: {'x-real-ip': '', 'cf-connecting-ip': '192.0.2.3', 'x-forwarded-for': '192.0.2.3'}}, 403],
  ['ingress list', {headers: {'x-real-ip': '192.0.2.3, 192.0.2.4'}}, 403],
  ['query authority', {query: '?token=forbidden'}, 400],
  ['non-JSON body', {headers: {'content-type': 'text/plain'}}, 415],
  ['announced body limit', {headers: {'content-length': '4097'}}, 413],
  ['streamed body limit', {body: ' '.repeat(4097)}, 413],
  ['malformed JSON', {body: '{'}, 400],
  ['wrong method', {method: 'GET'}, 405],
  ['extra privileged input', {body: {expectedOwnerId: owner, cursor: null, isPaid: true}}, 422],
  ['extra identity input', {body: {expectedOwnerId: owner, cursor: null, token}}, 422],
  ['missing cursor', {body: {expectedOwnerId: owner}}, 422],
  ['invalid owner', {body: {expectedOwnerId: 'invalid', cursor: null}}, 422],
  ['invalid cursor', {body: {expectedOwnerId: owner, cursor: {id, updatedAt: '2026-02-30T12:00:00.000000Z'}}}, 422],
]) {
  test(`cabinet HTTP denies ${description} before runtime`, async () => {
    const f = server(), response = await f.handle(f.request(input));
    assert.equal(response.status, status); assert.equal(f.runtimes(), 0); assert.deepEqual(f.calls, []);
  });
}
test('cabinet HTTP rate limit stops storage; wrong/expired session is generic 401; unknown SQL failures do not leak', async () => {
  const limited = server({allow: false}), response = await limited.handle(limited.request());
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '900');
  assert.deepEqual(limited.calls, [['limit', 'session', '192.0.2.3']]);
  const denied = server({failure: new session.AppSessionAccessError()});
  const deniedResponse = await denied.handle(denied.request());
  assert.equal(deniedResponse.status, 401); assert.deepEqual(await deniedResponse.json(), {error: {code: 'UNAUTHENTICATED'}});
  const failed = server({failure: Error('synthetic-private SQL detail')}), failedResponse = await failed.handle(failed.request());
  assert.equal(failedResponse.status, 503); assert.deepEqual(await failedResponse.json(), {error: {code: 'LISTINGS_UNAVAILABLE'}});
});
