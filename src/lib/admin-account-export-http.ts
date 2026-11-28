import { deletionObject, DeletionInputError } from './account-deletion-contract';
import { parseAdminPasskeyAssertion, parseAdminPasskeyOptions, parseArchivePasskeyCommand } from './admin-passkey-contract';
import { readAccountSessionToken } from './account-cookie';
import { AuthRequestError, authJson, readAuthJson } from './auth-http';
import { getTrustedProxyIp } from './trusted-proxy-ip';

type Runtime = {
  allow: (ip: string) => Promise<boolean>;
  resolve: (token: string) => Promise<{ id: string; role: string } | null>;
};

export function createAdminAccountExportHandler(
  config: { origin: string },
  runtime: () => Runtime | Promise<Runtime>,
  execute: (caseId: string, operatorToken: string, credential?: ReturnType<typeof parseAdminPasskeyAssertion>) => Promise<unknown>,
) {
  return async (request: Request) => {
    try {
      const raw = await readAuthJson(request, config, 2000, 'POST', 32_768);
      const action = raw && typeof raw === 'object' && 'action' in raw ? raw.action : null;
      if (action !== 'options' && action !== 'prepare') throw new DeletionInputError();
      const input = deletionObject(raw, ['action', 'caseId', 'expectedAdminId', ...(action === 'prepare' ? ['credential'] : [])]);
      const { caseId, expectedAdminId } = parseArchivePasskeyCommand({ caseId: input.caseId, expectedAdminId: input.expectedAdminId });
      const ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, 'UNTRUSTED_INGRESS');
      const token = readAccountSessionToken(request);
      if (!token) throw new AuthRequestError(401, 'UNAUTHENTICATED');
      const state = await runtime();
      if (!await state.allow(ip)) throw new AuthRequestError(429, 'RATE_LIMITED');
      const admin = await state.resolve(token);
      if (!admin || admin.role !== 'admin') throw new AuthRequestError(403, 'ADMIN_REQUIRED');
      if (admin.id !== expectedAdminId) throw new AuthRequestError(409, 'ACCOUNT_CHANGED');
      request.signal.throwIfAborted();
      if (action === 'options') return authJson(parseAdminPasskeyOptions(await execute(caseId, token)), 200);
      await execute(caseId, token, parseAdminPasskeyAssertion(input.credential));
      return authJson({ status: 'prepared' }, 200);
    } catch (error) {
      if (error instanceof AuthRequestError) return authJson({ error: { code: error.code } }, error.status);
      if (error instanceof DeletionInputError) return authJson({ error: { code: 'INVALID_INPUT' } }, 422);
      return authJson({ error: { code: 'EXPORT_UNAVAILABLE' } }, 503);
    }
  };
}
