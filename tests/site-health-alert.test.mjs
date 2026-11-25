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

test('a recovered site sends one recovery message and retains a retry after a known rejection', async () => {
  const f = fixture();
  const resolved = [];
  f.dependencies.sendResolved = async (id, reason) => {
    resolved.push({ id, reason });
    if (resolved.length === 1) throw Object.assign(new Error('synthetic SMTP rejection'), { code: 'TEMPORARY' });
  };
  assert.equal(await deliverSiteAlert('site-unavailable', f.dependencies), 'accepted');
  assert.equal(await deliverSiteAlert('healthy', f.dependencies), 'retry');
  assert.equal(await deliverSiteAlert('healthy', f.dependencies), 'healthy');
  assert.equal(await deliverSiteAlert('healthy', f.dependencies), 'healthy');
  assert.equal(f.sends.length, 1);
  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved[0], resolved[1]);
  assert.notEqual(resolved[0].id, f.sends[0].id);
  assert.equal(resolved[0].reason, 'site-unavailable');
});

test('a lost recovery acknowledgement cannot resend and cannot suppress the next outage', async () => {
  const f = fixture();
  let resolutions = 0;
  f.dependencies.sendResolved = async () => {
    resolutions++;
    throw Object.assign(new Error('lost acknowledgement'), { code: 'UNKNOWN' });
  };
  assert.equal(await deliverSiteAlert('readiness-unavailable', f.dependencies), 'accepted');
  assert.equal(await deliverSiteAlert('healthy', f.dependencies), 'unknown');
  assert.equal(await deliverSiteAlert('healthy', f.dependencies), 'unknown');
  assert.equal(resolutions, 1);
  assert.equal(await deliverSiteAlert('readiness-unavailable', f.dependencies), 'accepted');
  assert.equal(f.sends.length, 2);
  assert.notEqual(f.sends[0].id, f.sends[1].id);
});

test('restart with a saved recovery attempt does not send or clear the ambiguous delivery', async t => {
  const { alertStateFile } = await import('../scripts/site-health-alert.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-site-recovery-'));
  t.after(() => rm(directory, { recursive: true }));
  const statePath = join(directory, 'site-health.json');
  const stateFile = alertStateFile(statePath, { 'site-slow': 'slow' });
  const outage = { id: '2a642a21-f4bf-457e-9a88-fb276181accd', result: 'site-slow', attempts: 1, delivery: 'accepted' };
  const state = { ...outage, resolution: { id: '2b70a455-bdd2-411a-8cfd-e5da0f283e44', attempts: 1, delivery: 'sending' } };
  await stateFile.save(state);
  const dependencies = { ...stateFile, sendResolved: async () => assert.fail('already reserved') };
  assert.equal(await deliverSiteAlert('healthy', dependencies), 'unknown');
  assert.deepEqual(await stateFile.load(), state);
  await stateFile.save({ ...state, resolution: { ...state.resolution, id: outage.id } });
  await assert.rejects(stateFile.load(), /Invalid alert state/);
});

test('independent probes persist their own incidents and send recovery even with another alarm active', async t => {
  const { runSiteHealthAlert } = await import('../scripts/site-health-alert.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-independent-probes-'));
  t.after(() => rm(directory, { recursive: true }));
  let site = 'site-slow', tls = 'tls-expiring', disk = 'disk-low';
  let confirms = 0;
  const messages = [];
  const run = () => runSiteHealthAlert({
    directory, recipient: 'monitor@example.invalid',
    notify: async message => { messages.push(message); },
    waitForConfirm: async () => { confirms++; },
    site: async () => site, certificate: async () => tls, storage: async () => disk,
  });
  const first = await run();
  assert.equal(confirms, 3);
  assert.deepEqual(first.map(row => [row.probe,row.delivery]), [
    ['site-health','healthy'], ['site-latency','accepted'], ['site-tls','accepted'], ['site-disk','accepted'],
  ]);
  assert.equal(messages.length, 3);
  assert.equal(new Set(messages.map(message => message.id)).size, 3);
  assert.equal((await run()).every(row => ['healthy','accepted'].includes(row.delivery)), true);
  assert.equal(messages.length, 3);
  site = 'readiness-unavailable'; tls = 'healthy';
  assert.deepEqual((await run()).map(row => [row.probe,row.result]), [
    ['site-health','readiness-unavailable'], ['site-tls','healthy'], ['site-disk','disk-low'],
  ]);
  assert.equal(messages.filter(message => message.subject.endsWith('работа восстановлена')).length, 1);
  assert.equal((await readFile(join(directory, 'site-latency.json'), 'utf8')).includes('site-slow'), true);
  assert.equal(messages.length, 5);
});

test('worker and backup failures notify independently and distinguish operators by worker name', async t => {
  const { runSiteHealthAlert } = await import('../scripts/site-health-alert.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-worker-backup-alert-'));
  t.after(() => rm(directory, { recursive: true }));
  const messages = [];
  let backupResult = 'backup-failed', timerResult = 'worker-stopped';
  const unit = 'blizhniy-auth-mail';
  const healthy = async () => 'healthy';
  const run = () => runSiteHealthAlert({
    directory, recipient:'monitor@example.invalid', notify:async message => messages.push(message),
    waitForConfirm: async () => {}, site:healthy, certificate:healthy, backup:async () => backupResult,
    workerTimers:[unit], worker:async name => name === unit ? timerResult : 'worker-unavailable',
  });
  const recorded = await run();
  assert.deepEqual(recorded.filter(row => row.result !== 'healthy').map(({probe,result}) => [probe,result]), [
    ['site-backup','backup-failed'], [unit,'worker-stopped'],
  ]);
  assert.equal(messages.length, 2);
  assert.ok(messages.some(message => message.text.includes(unit)));
  timerResult = 'healthy';
  await run();
  assert.equal(messages.length,3);
  assert.ok(messages[2].subject.endsWith('работа восстановлена'));
  assert.ok(messages[2].text.includes(unit));
  backupResult = 'healthy';
  await run();
  assert.equal(messages.length,4);
  assert.ok(messages[3].subject.endsWith('работа восстановлена'));
});
