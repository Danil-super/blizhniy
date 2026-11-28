import { authJson, AuthRequestError } from '@/lib/auth-http';
import { createAdminRefundHandler } from '@/lib/admin-refund-http';
import { readLocalRefundJournalConfig } from '@/lib/local-refund-admin-config';
import { callGuardedHostedRefundOperator, callHostedRefundOperator, callLocalRefundOperator } from '@/lib/local-refund-operator-client';
import { readProductionAuthConfig } from '@/lib/production-auth-config';
import { getProductionAccountDatabase } from '@/lib/production-auth-runtime';

export const runtime = 'nodejs';

async function handle(request: Request) {
 try {
  const operator = readLocalRefundJournalConfig();
  if (!operator) return authJson({ error:{ code:'NOT_FOUND' } }, 404);
  const auth = readProductionAuthConfig();
  if (!auth) return authJson({ error:{ code:'NOT_FOUND' } }, 404);
  return await createAdminRefundHandler({...auth,passkey:operator.passkey}, async () => {
   const { limiter } = await getProductionAccountDatabase(auth);
   return { limiter, command:(token,command,signal,credential) => {
    if (command.action === 'list') throw new AuthRequestError(422,'INVALID_INPUT');
    if (operator.passkey) return callGuardedHostedRefundOperator(token,command,operator.shopId,signal,credential);
    return operator.hosted
      ? callHostedRefundOperator(token,command,operator.shopId,signal)
      : callLocalRefundOperator(operator.socketPath,token,command,signal,operator.shopId);
   } };
  })(request);
 } catch { return authJson({ error:{ code:'REFUND_OPERATOR_UNAVAILABLE' } }, 503); }
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
