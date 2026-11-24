import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('the reconciliation monitor sends once per blocked period and retains the incident after a database error', async t => {
  const { runPaymentReconciliationAlert } = await import('../scripts/payment-reconciliation-alert.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-reconciliation-alert-'));
  t.after(() => rm(directory, { recursive: true }));
  const messages = [];
  let blocked = true;
  const db = { readTransaction: async read => read({
    query: async (_sql, parameters) => {
      assert.deepEqual(parameters, ['synthetic-shop']);
      if (blocked === undefined) throw new Error('synthetic database failure');
      return { rows: [{ blocked }] };
    },
  }) };
  const run = () => runPaymentReconciliationAlert({
    db, shop: 'synthetic-shop', directory, recipient: 'operator@example.invalid',
    mailer: { send: async message => messages.push(message) },
  });
  assert.deepEqual(await run(), { result: 'reconciliation-blocked', delivery: 'accepted' });
  blocked = undefined;
  await assert.rejects(run(), /synthetic database failure/);
  blocked = true;
  assert.deepEqual(await run(), { result: 'reconciliation-blocked', delivery: 'accepted' });
  assert.equal(messages.length, 1);
  blocked = false;
  assert.deepEqual(await run(), { result: 'healthy', delivery: 'healthy' });
  blocked = true;
  assert.deepEqual(await run(), { result: 'reconciliation-blocked', delivery: 'accepted' });
  assert.equal(messages.length, 2);
  assert.notEqual(messages[0].id, messages[1].id);
});

test('the reconciliation timer uses a separate protected oneshot and valid systemd units', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-reconciliation-unit-'));
  t.after(() => rm(directory, { recursive: true }));
  const serviceName = 'blizhniy-payment-reconciliation-alert.service';
  const timerName = 'blizhniy-payment-reconciliation-alert.timer';
  const service = await readFile(new URL('../ops/systemd/' + serviceName, import.meta.url), 'utf8');
  const timer = await readFile(new URL('../ops/systemd/' + timerName, import.meta.url), 'utf8');
  for (const line of ['Type=oneshot', 'User=blizhniy-mail', 'Group=blizhniy-mail', 'StateDirectory=blizhniy-reconciliation-monitor',
    'StateDirectoryMode=0700', 'LimitCORE=0', 'NoNewPrivileges=true', 'ProtectSystem=strict']) assert.ok(service.includes(line));
  assert.match(service, /ExecStart=\/opt\/blizhniy-node22\/bin\/node .*\/scripts\/payment-reconciliation-alert\.mjs/);
  assert.match(timer, /^OnUnitInactiveSec=5min$/m);
  const serviceFile = join(directory, serviceName), timerFile = join(directory, timerName);
  await writeFile(serviceFile, service.replace('/opt/blizhniy-node22/bin/node', process.execPath));
  await writeFile(timerFile, timer);
  execFileSync('systemd-analyze', ['verify', '--man=no', serviceFile, timerFile], { timeout: 5000, maxBuffer: 16384 });
});
