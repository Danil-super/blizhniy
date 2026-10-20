import {randomUUID} from 'node:crypto';
import {authJson, readAuthJson, AuthRequestError, type AuthRateLimiter} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {AdminAccessError} from './admin-authorization';
import {ListingDraftInputError, parseListingDraftId} from './listing-draft-contract.ts';
import type {PostgresAdminOverviewStore} from './postgres-admin-overview';
type Runtime = {store: Pick<PostgresAdminOverviewStore, 'read'>; limiter: Pick<AuthRateLimiter, 'allowProduction'>};
type Event = {event: 'admin_overview'; requestId: string; status: number; durationMs: number; code?: string};
export function createAdminOverviewHandler(config: {origin: string}, runtime: () => Promise<Runtime> | Runtime,
  audit: (event: Event) => void = event => console.info(JSON.stringify(event))) {
  return async (request: Request) => {
    const requestId = randomUUID(), started = Date.now(); let status = 503, code: string | undefined;
    const reply = (body: unknown, next: number, headers?: Record<string, string>) => {status = next; return authJson(body, next, {'X-Request-ID': requestId, ...headers});};
    try {
      const raw = await readAuthJson(request, config, 2000, 'POST', 1024);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'expectedAdminId')) throw new AuthRequestError(422, 'INVALID_INPUT');
      const actor = parseListingDraftId((raw as Record<string, unknown>).expectedAdminId), ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, 'UNTRUSTED_INGRESS');
      const token = readAccountSessionToken(request); if (!token) throw new AuthRequestError(401, 'UNAUTHENTICATED');
      const state = await runtime(); if (!await state.limiter.allowProduction('session', ip)) throw new AuthRequestError(429, 'RATE_LIMITED');
      return reply(await state.store.read(token, actor), 200);
    } catch (error) {
      if (error instanceof ListingDraftInputError) error = new AuthRequestError(422, 'INVALID_INPUT');
      if (error instanceof AdminAccessError) error = new AuthRequestError(403, 'ADMIN_REQUIRED');
      code = error instanceof AuthRequestError ? error.code : 'OVERVIEW_UNAVAILABLE';
      const next = error instanceof AuthRequestError ? error.status : 503;
      return reply({error: {code}}, next, next === 429 ? {'Retry-After': '900'} : next === 405 ? {Allow: 'POST'} : undefined);
    } finally {audit({event: 'admin_overview', requestId, status, durationMs: Date.now() - started, code});}
  };
}
