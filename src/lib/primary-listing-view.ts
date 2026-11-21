import 'server-only';
import {createHmac, randomUUID} from 'node:crypto';
import {authJson, AuthRequestError, readAuthJson} from './auth-http';
import {readAccountSessionToken} from './account-cookie';
import {AppSessionAccessError, withAppSessionTransaction} from './app-session-transaction';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {readProductionAuthConfig} from './production-auth-config';
import {getTrustedProxyIp} from './trusted-proxy-ip';
import {readPostmoderationEnabled} from './listing-workflow-config';
import {PostgresPublicListingStore} from './postgres-public-listings';
import type {PostgresQueries} from './postgres';

const guestCookie = '__Host-blizhniy_listing_viewer';
const guestUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export async function handlePrimaryListingView(request: Request, listingId: string) {
  try {
    if (process.env.BLIZHNIY_LISTING_VIEWS !== 'enabled') throw new AuthRequestError(503, 'VIEWS_UNAVAILABLE');
    const config = readProductionAuthConfig();
    if (!config) throw new AuthRequestError(503, 'VIEWS_UNAVAILABLE');
    const body = await readAuthJson(request, config, 2000, 'POST', 32);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
      throw new AuthRequestError(422, 'INVALID_INPUT');
    }
    const ip = getTrustedProxyIp(request.headers);
    if (!ip) throw new AuthRequestError(403, 'UNTRUSTED_INGRESS');
    const {db, limiter} = await getProductionAccountDatabase(config);
    if (!await limiter.allowListingView(ip)) return authJson({error:{code:'RATE_LIMITED'}}, 429, {'Retry-After':'900'});

    const token = readAccountSessionToken(request);
    const cookies = (request.headers.get('cookie') ?? '').split(';').map(c => c.trim()).filter(c => c.startsWith(guestCookie+'='));
    const guest = cookies.length === 1 ? cookies[0].slice(guestCookie.length+1) : '';
    if (!token && !guestUuid.test(guest)) {
      return authJson({cookieRequired:true}, 202, {'Set-Cookie':`${guestCookie}=${randomUUID()}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000`});
    }
    const postmoderation = readPostmoderationEnabled();
    const record = async (tx: PostgresQueries, viewer: string) => {
      const store = new PostgresPublicListingStore(tx, {postmoderation});
      const digest = createHmac('sha256', config.rateSecret).update(`listing-view:${listingId.toLowerCase()}:${viewer}`).digest();
      const {rows:[row]} = await tx.query<{views:number|null}>('select app_stats.record_listing_view($1,$2,$3) as views', [listingId,digest,postmoderation]);
      if (row?.views == null) throw new AuthRequestError(404, 'NOT_FOUND');
      // Recheck the full public projection after acquiring the listing lock. A rejection rolls back the insertion.
      if (!await store.read(listingId)) throw new AuthRequestError(404, 'NOT_FOUND');
      return row.views;
    };
    const views = token
      ? await withAppSessionTransaction(db, token, (tx,user) => record(tx, 'user:'+user.id))
      : await db.transaction(tx => record(tx, 'guest:'+guest));
    return authJson({views}, 200);
  } catch (error) {
    if (error instanceof AuthRequestError) return authJson({error:{code:error.code}}, error.status);
    if (error instanceof AppSessionAccessError) return authJson({error:{code:'UNAUTHENTICATED'}}, 401);
    return authJson({error:{code:'VIEWS_UNAVAILABLE'}}, 503);
  }
}
