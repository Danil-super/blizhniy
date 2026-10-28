import { authJson, AuthRateLimiter } from './auth-http';
import { readProductionAuthConfig } from './production-auth-config';
import { getProductionAccountDatabase } from './production-auth-runtime';
import { readTelegramPhoneConfig } from './telegram-phone-config.ts';
import { createTelegramPhoneOidc } from './telegram-phone-oidc.ts';
import { canonicalTelegramCallback, createTelegramPhoneHandler } from './telegram-phone-http.ts';
import { PostgresPhoneVerificationStore } from './postgres-phone-verification.ts';
export async function handleTelegramPhoneRequest(request: Request, action: 'status' | 'start' | 'review' | 'confirm' | 'unlink' | 'callback') {
  try {
    const auth = readProductionAuthConfig(); if (!auth) return authJson({ error: { code: 'NOT_FOUND' } }, 404);
    if (action === 'callback') request = canonicalTelegramCallback(request, auth.origin);
    const config = readTelegramPhoneConfig();
    return await createTelegramPhoneHandler(auth, config, async () => {
      const { db } = await getProductionAccountDatabase(auth);
      const limiter=new AuthRateLimiter(db,auth.rateSecret);
      return { limiter, store: config ? new PostgresPhoneVerificationStore(db) : null, oidc: config ? createTelegramPhoneOidc(config) : null,
        policy: async () => {
          const exists = (await db.query<{ present: boolean }>("select to_regclass('app.phone_verification_policy') is not null as present")).rows[0]?.present;
          if (!exists) return { available: false, required: false };
          const row = (await db.query<{ available: boolean; required: boolean }>('select available,required from app.phone_verification_policy where singleton')).rows[0];
          if (!row) throw new Error('Phone policy unavailable');
          return row;
        } };
    })(request, action);
  } catch { return authJson({ error: { code: 'UNAVAILABLE' } }, 503); }
}
