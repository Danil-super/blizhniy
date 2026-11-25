import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSiteHealth } from '../scripts/check-site-health.mjs';

const origin = 'https://site.example.invalid';
const json = (value, status = 200) => Response.json(value, { status });

test('the outside probe verifies both health and database readiness through bounded HTTPS GETs', async () => {
  const calls = [];
  const result = await checkSiteHealth(origin, async (url, options) => {
    calls.push(url.pathname);
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return url.pathname === '/api/health' ? json({ ok: true }) : json({ ok: true, service: 'blizhniy' });
  });
  assert.deepEqual(calls, ['/api/health', '/api/ready']);
  assert.equal(result, 'healthy');
});

test('site outages and database readiness failures produce distinct notifications', async () => {
  assert.equal(await checkSiteHealth(origin, async () => { throw new Error('connection failed'); }), 'site-unavailable');
  assert.equal(await checkSiteHealth(origin, async url =>
    url.pathname === '/api/health' ? json({ ok: true }) : json({ ok: false, service: 'blizhniy' }, 503)
  ), 'readiness-unavailable');
});

test('redirects, non-JSON, schemaless and oversized replies cannot report a healthy site', async () => {
  for (const reply of [
    new Response(null, { status: 302 }),
    new Response('<html>active proxy</html>'),
    json({ okay: true }),
    json({ ok: true, payload: 'a'.repeat(4096) }),
  ]) {
    assert.equal(await checkSiteHealth(origin, async () => reply), 'site-unavailable');
  }
  assert.equal(await checkSiteHealth(origin, async url =>
    url.pathname === '/api/health' ? json({ ok: true }) : json({ ok: true, service: 'foreign' })
  ), 'readiness-unavailable');
});

test('slow successful responses alert after both checks, while 503 remains a readiness error', async () => {
  let now = 0;
  const slow = async url => {
    now += url.pathname === '/api/health' ? 2001 : 1;
    return json({ ok: true, service: 'blizhniy' });
  };
  assert.equal(await checkSiteHealth(origin, slow, () => now), 'site-slow');
  const failure = async url => url.pathname === '/api/health' ? slow(url) : json({ ok: false }, 503);
  assert.equal(await checkSiteHealth(origin, failure, () => now), 'readiness-unavailable');
  const withinBudget = async () => {
    now += 2000;
    return json({ ok: true, service: 'blizhniy' });
  };
  assert.equal(await checkSiteHealth(origin, withinBudget, () => now), 'healthy');
});

test('TLS alert requires a verified peer and gives fourteen days of notice', async () => {
  const { EventEmitter } = await import('node:events');
  const { checkSiteCertificate } = await import('../scripts/check-site-health.mjs');
  const now = 1795610000000;
  const day = 86400000;
  for (const [authorized, days, expected] of [
    [true, 15, 'healthy'],
    [true, 14, 'tls-expiring'],
    [true, 0, 'tls-unavailable'],
    [false, 20, 'tls-unavailable'],
  ]) {
    const socket = new EventEmitter();
    Object.assign(socket, {
      authorized,
      getPeerX509Certificate: () => ({ validToDate: new Date(now + days * day) }),
      destroy: () => { socket.destroyed = true; },
    });
    const open = options => {
      assert.deepEqual(options, { host: 'site.example.invalid', servername: 'site.example.invalid', port: 443, rejectUnauthorized: true });
      queueMicrotask(() => socket.emit('secureConnect'));
      return socket;
    };
    assert.equal(await checkSiteCertificate(origin, open, () => now), expected);
    assert.equal(socket.destroyed, true);
  }
});

test('disk alert uses space available to the runtime and also checks inode exhaustion', async () => {
  const { checkSiteDisk } = await import('../scripts/check-site-health.mjs');
  const base = { blocks: 100n, bavail: 16n, files: 100n, ffree: 16n };
  assert.equal(await checkSiteDisk('/var/app', async (path, options) => {
    assert.equal(path, '/var/app');
    assert.deepEqual(options, { bigint: true });
    return base;
  }), 'healthy');
  assert.equal(await checkSiteDisk('/var/app', async () => ({ ...base, bavail: 15n })), 'disk-low');
  assert.equal(await checkSiteDisk('/var/app', async () => ({ ...base, ffree: 15n })), 'disk-low');
  assert.equal(await checkSiteDisk('/var/app', async () => ({ ...base, files: 0n, ffree: 0n })), 'healthy');
  assert.equal(await checkSiteDisk('/var/app', async () => { throw new Error('synthetic mount failure'); }), 'disk-unavailable');
});

test('the TLS probe accepts the local trusted CA and refuses an untrusted peer and wrong name', async t => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { connect, createServer } = await import('node:tls');
  const { checkSiteCertificate } = await import('../scripts/check-site-health.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-site-tls-'));
  t.after(() => rm(directory, { recursive: true }));
  const keyFile = join(directory, 'localhost.key'), certFile = join(directory, 'localhost.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    '-days', '2', '-keyout', keyFile, '-out', certFile], { timeout: 5000, stdio: 'ignore' });
  const [key,cert] = await Promise.all([readFile(keyFile),readFile(certFile)]);
  const server = createServer({ key, cert });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const trusted = options => connect({ ...options, host: '127.0.0.1', ca: cert });
  const untrusted = options => connect({ ...options, host: '127.0.0.1', ca: [] });
  assert.equal(await checkSiteCertificate('https://localhost:'+port, trusted), 'tls-expiring');
  assert.equal(await checkSiteCertificate('https://localhost:'+port, untrusted), 'tls-unavailable');
  assert.equal(await checkSiteCertificate('https://wrong.example.invalid:'+port, trusted), 'tls-unavailable');
});

test('a scheduled worker must have an active repeating timer and a successful configured service', async () => {
  const { checkWorkerTimer, parseWorkerTimers } = await import('../scripts/check-site-health.mjs');
  const timer = 'blizhniy-auth-mail';
  const timerState = 'LoadState=loaded\nActiveState=active\nSubState=waiting\nTriggers=blizhniy-auth-mail.service\n';
  const serviceState = 'LoadState=loaded\nActiveState=inactive\nType=oneshot\nResult=success\nConditionResult=yes\n';
  const check = (timerText,serviceText) => checkWorkerTimer(timer, async unit => {
    assert.ok([timer+'.timer',timer+'.service'].includes(unit));
    return unit.endsWith('.timer') ? timerText : serviceText;
  });
  assert.deepEqual(parseWorkerTimers(undefined), []);
  assert.deepEqual(parseWorkerTimers(timer+',blizhniy-booking-expiry'), [timer,'blizhniy-booking-expiry']);
  assert.throws(() => parseWorkerTimers(timer+','+timer));
  assert.throws(() => parseWorkerTimers('ssh'));
  assert.equal(await check(timerState,serviceState), 'healthy');
  assert.equal(await check(timerState,serviceState.replace('inactive','activating')), 'healthy');
  assert.equal(await check(timerState.replace('active','inactive'),serviceState), 'worker-stopped');
  assert.equal(await check(timerState.replace('waiting','elapsed'),serviceState), 'worker-stopped');
  assert.equal(await check(timerState,serviceState.replace('Result=success','Result=exit-code')), 'worker-failed');
  assert.equal(await check(timerState,serviceState.replace('ConditionResult=yes','ConditionResult=no')), 'worker-failed');
  assert.equal(await check(timerState+'LoadState=loaded\n',serviceState), 'worker-unavailable');
});

test('backup monitoring uses a bounded receipt and ages the snapshot rather than its verification', async t => {
  const { mkdtemp, writeFile, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { checkBackupReceipt } = await import('../scripts/check-site-health.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-backup-receipt-'));
  t.after(() => rm(directory, { recursive: true }));
  const path = join(directory,'current.json'), alternate = join(directory,'alias.json');
  const now = 1795610000000, at = offset => new Date(now + offset).toISOString();
  const receipt = { version:1, status:'verified', snapshotAt:at(-3600000), verifiedAt:at(-200) };
  const write = object => writeFile(path,JSON.stringify(object),{ mode:0o640 });
  const check = (file = path) => checkBackupReceipt(file,() => now);
  assert.equal(await check(), 'backup-unavailable');
  await write(receipt);
  assert.equal(await check(), 'healthy');
  await symlink(path,alternate);
  assert.equal(await check(alternate), 'backup-unavailable');
  await write({ ...receipt, snapshotAt:at(-3600001) });
  assert.equal(await check(), 'backup-stale');
  await write({ version:1, status:'failed', attemptedAt:at(-100) });
  assert.equal(await check(), 'backup-failed');
  await write({ ...receipt, verifiedAt:at(1) });
  assert.equal(await check(), 'backup-unavailable');
  await write({ ...receipt, extra:'a'.repeat(600) });
  assert.equal(await check(), 'backup-unavailable');
});
