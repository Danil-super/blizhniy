import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open as openFile, statfs } from 'node:fs/promises';
import { promisify } from 'node:util';
import { connect } from 'node:tls';
import { pathToFileURL } from 'node:url';

const productionOrigin = 'https://xn----9sbphbgks4a4a.xn--p1ai';
const slowResponseMs = 2000;
const managedTimers = new Set([
  'blizhniy-auth-mail', 'blizhniy-booking-expiry', 'blizhniy-business-email',
  'blizhniy-expiry', 'blizhniy-payment-reconciliation-alert', 'blizhniy-push', 'blizhniy-queue-health-alert',
]);
const execute = promisify(execFile);

async function check(origin, path, transport) {
  try {
    const response = await transport(new URL(path, origin), {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const body = response.body;
    if (!body) return false;
    if (response.status !== 200 || response.redirected || !response.headers.get('content-type')?.startsWith('application/json')) {
      await body.cancel();
      return false;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of body) {
      size += chunk.byteLength;
      if (size > 512) return false;
      chunks.push(chunk);
    }
    const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return json?.ok === true && (path !== '/api/ready' || json.service === 'blizhniy');
  } catch {
    return false;
  }
}

export async function checkSiteHealth(origin = productionOrigin, transport = fetch, now = () => performance.now()) {
  const started = now();
  if (!await check(origin, '/api/health', transport)) return 'site-unavailable';
  const readyStarted = now();
  if (!await check(origin, '/api/ready', transport)) return 'readiness-unavailable';
  if (readyStarted - started > slowResponseMs || now() - readyStarted > slowResponseMs) return 'site-slow';
  return 'healthy';
}

export async function checkSiteCertificate(origin = productionOrigin, open = connect, now = Date.now) {
  try {
    const { protocol, hostname, port } = new URL(origin);
    if (protocol !== 'https:') return 'tls-unavailable';
    const expires = await new Promise((resolve, reject) => {
      const socket = open({ host: hostname, servername: hostname, port: Number(port || 443), rejectUnauthorized: true });
      const deadline = setTimeout(() => socket.destroy(new Error('TLS handshake timed out')), 4000);
      socket.once('error', error => {
        clearTimeout(deadline);
        socket.destroy();
        reject(error);
      });
      socket.once('close', () => {
        clearTimeout(deadline);
        resolve(undefined);
      });
      socket.once('secureConnect', () => {
        clearTimeout(deadline);
        resolve(socket.authorized ? socket.getPeerX509Certificate()?.validToDate?.getTime() : undefined);
        socket.destroy();
      });
    });
    const remaining = expires - now();
    if (!Number.isFinite(remaining) || remaining <= 0) return 'tls-unavailable';
    return remaining <= 14 * 86400000 ? 'tls-expiring' : 'healthy';
  } catch {
    return 'tls-unavailable';
  }
}

export async function checkSiteDisk(path, probe = statfs) {
  try {
    const { blocks, bavail, files, ffree } = await probe(path, { bigint: true });
    if (blocks <= 0n || bavail < 0n || bavail > blocks || files < 0n || ffree < 0n || ffree > files) return 'disk-unavailable';
    const lowSpace = bavail * 100n <= blocks * 15n;
    const lowInodes = files > 0n && ffree * 100n <= files * 15n;
    return lowSpace || lowInodes ? 'disk-low' : 'healthy';
  } catch {
    return 'disk-unavailable';
  }
}

export function parseWorkerTimers(value) {
  const selected = value === undefined ? [] : value.split(',');
  if (new Set(selected).size !== selected.length || selected.some(name => !managedTimers.has(name))) {
    throw new Error('Invalid monitored workers');
  }
  return selected;
}

async function showUnit(name, properties) {
  const { stdout } = await execute('/usr/bin/systemctl',
    ['show', '--no-pager', '--all', '--property=' + properties.join(','), '--', name],
    { timeout: 3000, maxBuffer: 8192, env: { LANG: 'C' } });
  return stdout;
}

async function readUnit(name, properties, read) {
  const rows = (await read(name, properties)).trim().split('\n').map(line => line.split('='));
  if (rows.length !== properties.length || rows.some(row => row.length !== 2) ||
    new Set(rows.map(([key]) => key)).size !== properties.length ||
    rows.some(([key]) => !properties.includes(key))) throw Error('Invalid systemd observation');
  return Object.fromEntries(rows);
}

export async function checkWorkerTimer(name, read = showUnit) {
  if (!managedTimers.has(name)) return 'worker-unavailable';
  try {
    const [timer, service] = await Promise.all([
      readUnit(name + '.timer', ['LoadState', 'ActiveState', 'SubState', 'Triggers'], read),
      readUnit(name + '.service', ['LoadState', 'ActiveState', 'Type', 'Result', 'ConditionResult'], read),
    ]);
    if (timer.LoadState !== 'loaded' || timer.ActiveState !== 'active' ||
      !['waiting', 'running'].includes(timer.SubState) || timer.Triggers !== name + '.service') return 'worker-stopped';
    if (service.LoadState !== 'loaded' || service.Type !== 'oneshot' || service.Result !== 'success' ||
      service.ConditionResult !== 'yes' || !['inactive', 'activating', 'active', 'deactivating'].includes(service.ActiveState)) {
      return 'worker-failed';
    }
    return 'healthy';
  } catch {
    return 'worker-unavailable';
  }
}

function receiptTimestamp(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}

export async function checkBackupReceipt(path, now = Date.now) {
  try {
    const file = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let receipt;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 512 || stat.mode & 0o022) return 'backup-unavailable';
      const buffer = Buffer.alloc(513);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== stat.size) return 'backup-unavailable';
      receipt = JSON.parse(buffer.toString('utf8', 0, bytesRead));
    } finally {
      await file.close();
    }
    const current = now();
    if (receipt?.version !== 1) return 'backup-unavailable';
    if (receipt.status === 'failed' && Object.keys(receipt).length === 3 && receiptTimestamp(receipt.attemptedAt) <= current) {
      return 'backup-failed';
    }
    const snapshot = receiptTimestamp(receipt.snapshotAt), verified = receiptTimestamp(receipt.verifiedAt);
    if (receipt.status !== 'verified' || Object.keys(receipt).length !== 4 || !(snapshot <= verified && verified <= current)) {
      return 'backup-unavailable';
    }
    return current - snapshot > 3600000 ? 'backup-stale' : 'healthy';
  } catch {
    return 'backup-unavailable';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkSiteHealth();
  console.log(JSON.stringify({ event: 'site_health', result }));
  if (result !== 'healthy') process.exitCode = 1;
}
