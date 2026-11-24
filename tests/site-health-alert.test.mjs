import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliverSiteAlert } from '../scripts/site-health-alert.mjs';

function fixture() {
  let state = null;
  const sends = [];
  const dependencies = {
    load: async () => state,
    save: async next => { state = next; },
    send: async (id, reason) => { sends.push({ id, reason }); },
  };
  return { dependencies, sends, get state() { return state; } };
}

test('an outage sends once until recovery and a later outage has a new notification ID', async () => {
  const f = fixture();
  assert.equal(await deliverSiteAlert('healthy', f.dependencies), 'healthy');
  assert.equal(await deliverSiteAlert('site-unavailable', f.dependencies), 'accepted');
  assert.equal(await deliverSiteAlert('site-unavailable', f.dependencies), 'accepted');
  assert.equal(f.sends.length, 1);
  assert.equal(await deliverSiteAlert('healthy', f.dependencies), 'healthy');
  assert.equal(await deliverSiteAlert('site-unavailable', f.dependencies), 'accepted');
  assert.equal(f.sends.length, 2);
  assert.notEqual(f.sends[0].id, f.sends[1].id);
});

test('a known transient SMTP rejection retries the same incident at most three times', async () => {
  const f = fixture();
  let attempts = 0;
  f.dependencies.send = async (id, reason) => {
    f.sends.push({ id, reason });
    attempts++;
    throw Object.assign(new Error('synthetic SMTP rejection'), { code: 'TEMPORARY' });
  };
  for (const expected of ['retry', 'retry', 'blocked', 'blocked']) {
    assert.equal(await deliverSiteAlert('readiness-unavailable', f.dependencies), expected);
  }
  assert.equal(attempts, 3);
  assert.equal(new Set(f.sends.map(message => message.id)).size, 1);
  assert.deepEqual([...new Set(f.sends.map(message => message.reason))], ['readiness-unavailable']);
});

test('an ambiguous acceptance or a crash after reservation cannot resend an alert', async () => {
  for (const interrupted of [false, true]) {
    const f = fixture();
    f.dependencies.send = async (id, reason) => {
      f.sends.push({ id, reason });
      throw Object.assign(new Error('lost acknowledgement'), { code: 'UNKNOWN' });
    };
    if (interrupted) {
      await f.dependencies.save({ result: 'site-unavailable', id: 'e52f3953-4ae9-4b27-8563-98d3b39f24b5', attempts: 1, delivery: 'sending' });
    }
    assert.equal(await deliverSiteAlert('site-unavailable', f.dependencies), 'unknown');
    assert.equal(await deliverSiteAlert('site-unavailable', f.dependencies), 'unknown');
    assert.equal(f.sends.length, interrupted ? 0 : 1);
  }
});
