import { authJson } from '@/lib/auth-http';
import { IdentityStore } from '@/lib/identity';
import { readProductionAuthConfig } from '@/lib/production-auth-config';
import { getProductionAccountDatabase } from '@/lib/production-auth-runtime';
import { accountExportTrialDirectory, createAccountExportTrial } from '@/lib/production-account-export-trial';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const config = readProductionAuthConfig();
    const ownerId = process.env.BLIZHNIY_PAYMENT_TEST_USER_ID;
    if (!config || !ownerId || process.env.BLIZHNIY_APPLICATION_PAYMENT !== 'account-response-test')
      return authJson({ error: { code: 'NOT_FOUND' } }, 404);
    const state = () => getProductionAccountDatabase(config);
    return createAccountExportTrial({
      origin: config.origin,
      directory: accountExportTrialDirectory,
      authorityUid: 0,
      ownerId,
      async allow(ip) { return (await state()).limiter.allowProduction('session', ip); },
      async resolve(token) { return new IdentityStore((await state()).db).resolveSession(token); },
    })(request);
  } catch {
    return authJson({ error: { code: 'EXPORT_UNAVAILABLE' } }, 503);
  }
}
