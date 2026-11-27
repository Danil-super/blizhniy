import 'server-only';
import { createHmac } from 'node:crypto';
import { readAnalyticsConsent, readMeasurementVisitCookie } from './analytics-consent';
import { AuthRequestError, readAuthJson } from './auth-http';
import { getMetricaCounterId, getMetricaTransport } from './metrica-config';
import { measurementReferrer, metricaPublicPath } from './metrica-page';
import { getPublicSiteUrl } from './site-url';
import { getTrustedProxyIp } from './trusted-proxy-ip';

type MeasurementConfig = { origin: string; counterId: number; token: string };
const endpoint = 'https://mc.yandex.ru/collect';
const responseHeaders = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
};

let inFlight = 0;
let windowStart = 0, sentInWindow = 0;
const byPeer = new Map<string, number>();
const maxConcurrent = 16, maxPerMinute = 2400, maxPerPeer = 600;
const respond = (status: number) => new Response(null, { status, headers: responseHeaders });

export function readMetricaMeasurementConfig(): MeasurementConfig | null {
  if (getMetricaTransport() !== 'measurement-protocol') return null;
  const counterId = getMetricaCounterId();
  const origin = getPublicSiteUrl();
  try {
    const url = new URL(origin);
    if (counterId === null || url.protocol !== 'https:' || url.origin !== origin) return null;
    return { origin, counterId, token: process.env.BLIZHNIY_YANDEX_METRICA_MEASUREMENT_TOKEN! };
  } catch { return null; }
}

export async function handleMetricaMeasurement(request: Request, config: MeasurementConfig | null, send = fetch): Promise<Response> {
  if (!config) return respond(404);
  const cookies = request.headers.get('cookie') ?? '';
  const visit = readMeasurementVisitCookie(cookies);
  const peer = getTrustedProxyIp(request.headers);
  if (!peer || !visit || readAnalyticsConsent(cookies) !== 'granted') return respond(403);
  if (inFlight >= maxConcurrent) return respond(429);
  inFlight++;
  try {
    const input = await readAuthJson(request, config, 1000, 'POST', 320);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return respond(400);
    const { path, referrer } = input as Record<string, unknown>;
    if (Object.keys(input).length !== 2 || typeof path !== 'string' || metricaPublicPath(path) !== path ||
        typeof referrer !== 'string' || (referrer && measurementReferrer(referrer.startsWith('/') ? config.origin + referrer : referrer, config.origin) !== referrer)) {
      return respond(400);
    }
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== windowStart) { windowStart = minute; sentInWindow = 0; byPeer.clear(); }
    const peerKey = createHmac('sha256', config.token).update('blizhniy-metrica-peer:').update(peer).digest('hex');
    const peerCount = byPeer.get(peerKey) ?? 0;
    if (sentInWindow >= maxPerMinute || peerCount >= maxPerPeer) return respond(429);
    byPeer.set(peerKey, peerCount + 1);
    sentInWindow++;

    const cid = createHmac('sha256', config.token)
      .update(`blizhniy-metrica-visit:${config.origin}:${config.counterId}:${visit}`)
      .digest().readBigUInt64BE(0) >> BigInt(1);
    const body = new URLSearchParams({ tid: String(config.counterId), ms: config.token, t: 'pageview',
      cid: String(cid), dl: config.origin + path, dt: 'Ближний' });
    if (referrer && referrer !== path) body.set('dr', referrer.startsWith('/') ? config.origin + referrer : referrer);
    const response = await send(endpoint, { method: 'POST', body, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(2000)]) });
    void response.body?.cancel().catch(() => undefined);
    return respond(response.status === 200 ? 204 : 503);
  } catch (error) {
    return respond(error instanceof AuthRequestError ? error.status : 503);
  } finally { inFlight--; }
}
