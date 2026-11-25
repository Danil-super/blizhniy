import { statfs } from 'node:fs/promises';
import { connect } from 'node:tls';
import { pathToFileURL } from 'node:url';

const productionOrigin = 'https://xn----9sbphbgks4a4a.xn--p1ai';
const slowResponseMs = 2000;

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkSiteHealth();
  console.log(JSON.stringify({ event: 'site_health', result }));
  if (result !== 'healthy') process.exitCode = 1;
}
