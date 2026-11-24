import { authJson, AuthRequestError } from '@/lib/auth-http';
import { createAdminRefundHandler } from '@/lib/admin-refund-http';
import { readLocalRefundJournalConfig } from '@/lib/local-refund-admin-config';
import { callLocalRefundOperator } from '@/lib/local-refund-operator-client';
import { readProductionAuthConfig } from '@/lib/production-auth-config';
import { getProductionAccountDatabase } from '@/lib/production-auth-runtime';

export const runtime = 'nodejs';

async function handle(request: Request) {
 try {
  const operator = readLocalRefundJournalConfig();
  if (!operator) return authJson({ error:{ code:'NOT_FOUND' } }, 404);
  const auth = readProductionAuthConfig();
  if (!auth) return authJson({ error:{ code:'NOT_FOUND' } }, 404);
  return await createAdminRefundHandler(auth, async () => {
   const { limiter } = await getProductionAccountDatabase(auth);
   return { limiter, command:(token,command,signal) => {
    if (command.action === 'list') throw new AuthRequestError(422,'INVALID_INPUT');
    return callLocalRefundOperator(operator.socketPath,token,command,signal,operator.shopId);
   } };
  })(request);
 } catch { return authJson({ error:{ code:'REFUND_OPERATOR_UNAVAILABLE' } }, 503); }
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
