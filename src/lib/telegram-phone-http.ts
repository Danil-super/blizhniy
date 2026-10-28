import { randomUUID } from 'node:crypto';
import { authJson, readAuthJson, AuthRequestError, type AuthRateLimiter } from './auth-http';
import { readAccountSessionToken } from './account-cookie';
import { getTrustedProxyIp } from './trusted-proxy-ip';
import { AppSessionAccessError } from './app-session-transaction';
import { PhoneVerificationError } from './phone-verification-contract.ts';
import { telegramPhoneCallbackPath, type TelegramPhoneConfig } from './telegram-phone-config.ts';
import type { createTelegramPhoneOidc } from './telegram-phone-oidc.ts';
import type { PostgresPhoneVerificationStore } from './postgres-phone-verification.ts';
type Runtime = { store: PostgresPhoneVerificationStore | null; limiter: Pick<AuthRateLimiter, 'allowProduction' | 'allowPhoneVerification'>;
  policy: () => Promise<{ available: boolean; required: boolean }>; oidc: ReturnType<typeof createTelegramPhoneOidc> | null };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const statuses: Record<string, number> = { INVALID_ATTEMPT: 400, INVALID_INPUT: 422, PHONE_CONFLICT: 409, PROFILE_CHANGED: 409,
  REPLACEMENT_REQUIRED: 409, UNAVAILABLE: 503, RATE_LIMITED: 429, CANCELLED: 400, PHONE_REQUIRED: 403 };
export function createTelegramPhoneHandler(auth: { origin: string }, config: TelegramPhoneConfig | null, getRuntime: () => Promise<Runtime>) {
  return async (request: Request, action: 'status' | 'start' | 'review' | 'confirm' | 'unlink' | 'callback'): Promise<Response> => {
    const requestId = randomUUID();
    const reply = (body: unknown, status = 200) => authJson(body, status, { 'X-Request-ID': requestId });
    const redirect = (query: string) => new Response(null, { status: 303, headers: { Location: '/cabinet/phone' + query,
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Request-ID': requestId } });
    try {
      let body: Record<string, unknown> = {};
      const url = new URL(request.url);
      if (action === 'callback') {
        if (request.headers.get('host') !== new URL(auth.origin).host || url.origin !== auth.origin || request.method !== 'GET' || url.pathname !== telegramPhoneCallbackPath || url.href.length > 8192 || url.hash ||
            [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) throw new PhoneVerificationError('INVALID_ATTEMPT');
      } else {
        const raw = await readAuthJson(request, auth, 2000, 'POST', 4096);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PhoneVerificationError('INVALID_INPUT');
        body = raw as Record<string, unknown>;
        const keys = action === 'start' ? ['expectedOwnerId','returnTo'] : action === 'confirm' ? ['expectedOwnerId','attemptId','expectedRevision','acceptReplacement']
          : action === 'review' ? ['expectedOwnerId','attemptId'] : ['expectedOwnerId'];
        if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key)) || typeof body.expectedOwnerId !== 'string' || !uuid.test(body.expectedOwnerId)) throw new PhoneVerificationError('INVALID_INPUT');
      }
      const token = readAccountSessionToken(request), ip = getTrustedProxyIp(request.headers);
      if (!token) throw new AuthRequestError(401, 'UNAUTHENTICATED');
      if (!ip) throw new AuthRequestError(403, 'UNTRUSTED_INGRESS');
      const runtime = await getRuntime();
      if (!await runtime.limiter.allowProduction('session', ip)) throw new PhoneVerificationError('RATE_LIMITED');
      if (action === 'status') {
        const policy = await runtime.policy();
        if (!config || !policy.available || !runtime.store) return reply({ available: false, required: policy.required, verified: false, phone: null, verifiedPhone: null });
        return reply(await runtime.store.status(token, body.expectedOwnerId as string));
      }
      if (!config || !runtime.store || !runtime.oidc) throw new PhoneVerificationError('UNAVAILABLE');
      if (action === 'callback') {
        const state = url.searchParams.get('state') ?? '';
        const attempt = await runtime.store.claim(token, state, config.clientId);
        if (url.searchParams.has('error')) { await runtime.store.finishExchange(token, attempt.id, null); return redirect('?error=cancelled'); }
        try {
          // The local ingress forwards canonical URLs; the registered callback is
          // nevertheless identical in authorization and token exchange.
          const callback = new URL(config.callbackUrl); callback.search = url.search;
          const claims = await runtime.oidc.exchange(callback, attempt);
          await runtime.store.finishExchange(token, attempt.id, claims);
          return redirect('?attempt=' + encodeURIComponent(attempt.id));
        } catch { await runtime.store.finishExchange(token, attempt.id, null).catch(() => undefined); return redirect('?error=invalid'); }
      }
      const owner = body.expectedOwnerId as string;
      if (action === 'start') {
        if (!await runtime.limiter.allowPhoneVerification(ip)) throw new PhoneVerificationError('RATE_LIMITED');
        const attempt = await runtime.store.start(token, owner, config.clientId, body.returnTo);
        return reply({ authorizationUrl: runtime.oidc.authorization(attempt), attemptId: attempt.id });
      }
      if (action === 'review') {
        if (typeof body.attemptId !== 'string') throw new PhoneVerificationError('INVALID_INPUT');
        return reply(await runtime.store.review(token, owner, body.attemptId));
      }
      if (action === 'confirm') {
        if (typeof body.attemptId !== 'string' || body.expectedRevision !== null && typeof body.expectedRevision !== 'string' || typeof body.acceptReplacement !== 'boolean') throw new PhoneVerificationError('INVALID_INPUT');
        return reply(await runtime.store.confirm(token, owner, body.attemptId, body.expectedRevision as string | null, body.acceptReplacement));
      }
      return reply(await runtime.store.unlink(token, owner));
    } catch (error) {
      if (action === 'callback') return redirect('?error=invalid');
      if (error instanceof AppSessionAccessError) return reply({ error: { code: 'UNAUTHENTICATED' } }, 401);
      if (error instanceof AuthRequestError) return reply({ error: { code: error.code } }, error.status);
      if (error instanceof PhoneVerificationError) return reply({ error: { code: error.code } }, statuses[error.code] ?? 503);
      // Never log tokens, query strings, provider responses or complete phone numbers.
      console.warn(JSON.stringify({ event: 'telegram_phone_failed', requestId, operation: action, code: 'UNAVAILABLE' }));
      return reply({ error: { code: 'UNAVAILABLE' } }, 503);
    }
  };
}
