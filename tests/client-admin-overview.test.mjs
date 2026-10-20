import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAdminOverviewClient} from '../src/lib/client-admin-overview.ts';

const admin = '11111111-1111-4111-8111-111111111111';
const summary = {
  users: {total: 23, blocked: 2},
  publications: {total: 42, awaitingReview: 7},
  tariffs: {total: 8, active: 6},
  adMarquee: {total: 3, awaitingReview: 1},
};

test('primary admin overview reads actual counts through an expected-admin cookie-only request', async () => {
  const requests = [];
  const client = createAdminOverviewClient(async (url, options) => {
    requests.push({url, options});
    return Response.json(summary);
  });
  assert.deepEqual(await client.read(admin), summary);
  assert.equal(requests.length, 1);
  const [{url, options}] = requests;
  assert.equal(url, '/api/admin/overview');
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'error');
  const headers = new Headers(options.headers);
  assert.equal(headers.get('authorization'), null);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('x-blizhniy-request'), '1');
  assert.deepEqual(JSON.parse(options.body), {expectedAdminId: admin});
});

test('overview refuses malformed, extra or contradictory metrics instead of turning unavailable data into zeros', async () => {
  const invalid = [
    {}, {...summary, users: []}, {...summary, users: {total: -1, blocked: 0}},
    {...summary, users: {total: '23', blocked: 2}},
    {...summary, users: {total: 1.5, blocked: 0}},
    {...summary, users: {total: Number.MAX_SAFE_INTEGER + 1, blocked: 0}},
    {...summary, users: {total: 1, blocked: 2}},
    {...summary, publications: {total: 0, awaitingReview: 1}},
    {...summary, tariffs: {total: 1, active: 2}},
    {...summary, adMarquee: {total: 0, awaitingReview: 1}},
    {...summary, users: {...summary.users, emails: ['private@example.invalid']}},
    {...summary, session: 'private-session'},
  ];
  for (const value of invalid) {
    const client = createAdminOverviewClient(async () => Response.json(value));
    await assert.rejects(client.read(admin));
  }
  const zero = {
    users: {total: 0, blocked: 0}, publications: {total: 0, awaitingReview: 0},
    tariffs: {total: 0, active: 0}, adMarquee: {total: 0, awaitingReview: 0},
  };
  assert.deepEqual(await createAdminOverviewClient(async () => Response.json(zero)).read(admin), zero);
});

test('overview transport never leaks upstream errors or silently retries a failed administrative read', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    let calls = 0;
    const client = createAdminOverviewClient(async () => {
      calls++;
      return Response.json({error: {code: 'UNKNOWN', message: 'private upstream detail'}}, {status});
    });
    await assert.rejects(client.read(admin), error => {
      assert.doesNotMatch(error.message, /private upstream detail/);
      return true;
    });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(createAdminOverviewClient(async () => {
    calls++;
    throw new Error('private database hostname');
  }).read(admin), error => {
    assert.doesNotMatch(error.message, /private database hostname/);
    return true;
  });
  assert.equal(calls, 1);
});

test('overview rejects an invalid actor or canceled read without contacting any API', async () => {
  let calls = 0;
  const client = createAdminOverviewClient(async () => {calls++; return Response.json(summary);});
  await assert.rejects(client.read('not-an-admin-id'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.read(admin, {signal: controller.signal}));
  assert.equal(calls, 0);
});

test('overview bounds and cancels oversized response streams, and refuses malformed JSON', async () => {
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) {controller.enqueue(new Uint8Array(1048576));},
    cancel() {canceled = true;},
  });
  await assert.rejects(createAdminOverviewClient(async () => new Response(stream)).read(admin));
  assert.equal(canceled, true);
  for (const content of ['<html>Auth is not configured</html>', '{', '\u0000']) {
    await assert.rejects(createAdminOverviewClient(async () => new Response(content)).read(admin));
  }
});
