import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('queue alarms preserve unrelated incidents and recover after the probe reconnects', async t => {
  const { runQueueHealthAlert } = await import('../scripts/queue-health-alert.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-queue-health-'));
  t.after(() => rm(directory, { recursive: true }));
  let available = true;
  let observed = {
    role: 'blizhniy_queue_monitor', login: 'blizhniy_queue_monitor', database: 'blizhniy_test', read_only: 'on',
    auth_mail: true, business_email: false, push: true, payment_test: false,
  };
  const sent = [];
  const db = { readTransaction: work => work({ query: async (_sql, args) => {
    assert.deepEqual(args, ['test-shop']);
    if (!available) throw new Error('synthetic connection error with private details');
    return { rows: [observed] };
  } }) };
  const tick = () => runQueueHealthAlert({
    db, database: 'blizhniy_test', shop: 'test-shop', directory, recipient: 'operator@example.invalid',
    notify: async message => sent.push(message),
  });
  const alerts = rows => rows.filter(row => row.result !== 'healthy').map(row => row.result);
  assert.deepEqual(alerts(await tick()), ['auth-mail-backlog','push-backlog']);
  assert.equal(sent.length, 2);
  available = false;
  assert.deepEqual(alerts(await tick()), ['queue-probe-unavailable']);
  assert.equal(sent.length, 3);
  assert.doesNotMatch(JSON.stringify(sent), /private details|test-shop/);
  available = true;
  assert.deepEqual(alerts(await tick()), ['auth-mail-backlog','push-backlog']);
  assert.equal(sent.length, 4);
  assert.equal(sent[3].subject, 'БЛИЖНИЙ — очередь восстановлена');
  observed = { ...observed, auth_mail: false, push: false };
  assert.deepEqual(alerts(await tick()), []);
  assert.equal(sent.length, 6);
  observed = { ...observed, read_only: 'off' };
  assert.deepEqual(alerts(await tick()), ['queue-probe-unavailable']);
  assert.equal(sent.length, 7);
});

test('queue alerts run under a restricted systemd oneshot and separate timer', async t => {
  const { execFileSync } = await import('node:child_process');
  const { readFile, writeFile } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-queue-unit-'));
  t.after(() => rm(directory, { recursive: true }));
  const service = 'blizhniy-queue-health-alert.service', timer = 'blizhniy-queue-health-alert.timer';
  const read = name => readFile(new URL('../ops/systemd/'+name,import.meta.url),'utf8');
  const [serviceText,timerText] = await Promise.all([read(service),read(timer)]);
  for(const property of ['Type=oneshot','User=blizhniy-mail','StateDirectory=blizhniy-queue-monitor',
    'StateDirectoryMode=0700','NoNewPrivileges=true','ProtectSystem=strict']){
    assert.ok(serviceText.includes(property));
  }
  assert.match(timerText,/^OnUnitInactiveSec=1min$/m);
  await Promise.all([writeFile(join(directory,service),serviceText.replace('/opt/blizhniy-node22/bin/node',process.execPath)),
    writeFile(join(directory,timer),timerText)]);
  execFileSync('systemd-analyze',['verify','--man=no',join(directory,service),join(directory,timer)],{timeout:5000,maxBuffer:16384});
});
