import { createAdminAccountExportHandler } from '@/lib/admin-account-export-http';
import { requestApprovedAccountExport } from '@/lib/admin-account-export-socket';
import { authJson } from '@/lib/auth-http';
import { hostedAdminPasskeysEnabled } from '@/lib/hosted-user-access-config';
import { IdentityStore } from '@/lib/identity';
import { approvedAccountExportEnabled } from '@/lib/production-account-export-trial';
import { readProductionAuthConfig } from '@/lib/production-auth-config';
import { getProductionAccountDatabase } from '@/lib/production-auth-runtime';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const config = approvedAccountExportEnabled() && hostedAdminPasskeysEnabled() ? readProductionAuthConfig() : null;
    if (!config) return authJson({ error: { code: 'NOT_FOUND' } }, 404);
    return await createAdminAccountExportHandler(config, async () => {
      const { db, limiter } = await getProductionAccountDatabase(config);
      const identity = new IdentityStore(db);
      return {
        allow: (ip) => limiter.allowProduction('session', ip),
        resolve: (token) => identity.resolveSession(token),
      };
    }, requestApprovedAccountExport)(request);
  } catch {
    return authJson({ error: { code: 'EXPORT_UNAVAILABLE' } }, 503);
  }
}
