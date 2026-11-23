import { pathToFileURL } from 'node:url';

const productionOrigin = 'https://xn----9sbphbgks4a4a.xn--p1ai';

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

export async function checkSiteHealth(origin = productionOrigin, transport = fetch) {
  if (!await check(origin, '/api/health', transport)) return 'site-unavailable';
  if (!await check(origin, '/api/ready', transport)) return 'readiness-unavailable';
  return 'healthy';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkSiteHealth();
  console.log(JSON.stringify({ event: 'site_health', result }));
  if (result !== 'healthy') process.exitCode = 1;
}
