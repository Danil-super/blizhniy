import { randomUUID } from 'node:crypto';
import { authJson, AuthRequestError, readAuthJson, type AuthRateLimiter } from './auth-http';
import { readAccountSessionToken } from './account-cookie';
import { AppSessionAccessError } from './app-session-transaction';
import { getTrustedProxyIp } from './trusted-proxy-ip';
import { parseAdminPaymentJournalPage, parseAdminPaymentJournalQuery, type AdminPaymentJournalQuery } from './admin-payment-journal-contract.ts';

type Runtime = { limiter: Pick<AuthRateLimiter,'allowProduction'>; read(token: string, command: AdminPaymentJournalQuery): Promise<unknown> };
type Audit = { event: 'admin_payment_journal'; requestId: string; status: number; durationMs: number; code?: string };

export function createAdminPaymentJournalHandler(config: { origin: string }, runtime: () => Runtime | Promise<Runtime>,
 audit: (event: Audit) => void = event => console.info(JSON.stringify(event))) {
 return async (request: Request) => {
  const requestId = randomUUID(), start = Date.now();
  let status = 503, code: string | undefined;
  const reply = (body: unknown, next: number, headers?: Record<string,string>) => {
   status = next;
   return authJson(body, next, { 'X-Request-ID': requestId, ...headers });
  };
  try {
   const raw = await readAuthJson(request, config, 2000, 'POST', 4096);
   let query: AdminPaymentJournalQuery;
   try { query = parseAdminPaymentJournalQuery(raw); }
   catch { throw new AuthRequestError(422, 'INVALID_INPUT'); }
   const ip = getTrustedProxyIp(request.headers);
   if (!ip) throw new AuthRequestError(403, 'UNTRUSTED_INGRESS');
   const token = readAccountSessionToken(request);
   if (!token) throw new AuthRequestError(401, 'UNAUTHENTICATED');
   request.signal.throwIfAborted();
   const boundary = await runtime();
   if (!await boundary.limiter.allowProduction('session', ip)) throw new AuthRequestError(429, 'RATE_LIMITED');
   request.signal.throwIfAborted();
   const page = parseAdminPaymentJournalPage(query, await boundary.read(token, query));
   return reply(page, 200);
  } catch (error) {
   if (error instanceof AppSessionAccessError) error = new AuthRequestError(403, 'ADMIN_REQUIRED');
   code = error instanceof AuthRequestError ? error.code : 'PAYMENT_JOURNAL_UNAVAILABLE';
   const next = error instanceof AuthRequestError ? error.status : 503;
   return reply({ error: { code } }, next, next === 429 ? { 'Retry-After': '900' } : next === 405 ? { Allow: 'POST' } : undefined);
  } finally { audit({ event: 'admin_payment_journal', requestId, status, durationMs: Date.now()-start, code }); }
 };
}
