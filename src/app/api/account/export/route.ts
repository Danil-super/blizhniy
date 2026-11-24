import { authJson } from '@/lib/auth-http';
import { IdentityStore } from '@/lib/identity';
import { readProductionAuthConfig } from '@/lib/production-auth-config';
import { getProductionAccountDatabase } from '@/lib/production-auth-runtime';
import { accountExportTrialDirectory, approvedAccountExportDirectory, approvedAccountExportEnabled,
  createAccountExportTrial, createApprovedAccountExport } from '@/lib/production-account-export-trial';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const config = readProductionAuthConfig();
    const ownerId = process.env.BLIZHNIY_PAYMENT_TEST_USER_ID;
    const approved = approvedAccountExportEnabled();
    if (!config || (!approved && (!ownerId || process.env.BLIZHNIY_APPLICATION_PAYMENT !== 'account-response-test')))
      return authJson({ error: { code: 'NOT_FOUND' } }, 404);
    const state = () => getProductionAccountDatabase(config);
    const access = {
      origin: config.origin,
      authorityUid: 0,
      async allow(ip: string) { return (await state()).limiter.allowProduction('session', ip); },
      async resolve(token: string) { return new IdentityStore((await state()).db).resolveSession(token); },
    };
    const download = approved
      ? createApprovedAccountExport({ ...access, directory: approvedAccountExportDirectory })
      : createAccountExportTrial({ ...access, directory: accountExportTrialDirectory, ownerId: ownerId ?? '' });
    return download(request);
  } catch {
    return authJson({ error: { code: 'EXPORT_UNAVAILABLE' } }, 503);
  }
}
