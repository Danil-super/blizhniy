import { deletionId, deletionObject, DeletionInputError } from './account-deletion-contract';
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
  prepare: (caseId: string, operatorToken: string) => Promise<void>,
) {
  return async (request: Request) => {
    try {
      const input = deletionObject(await readAuthJson(request, config, 2000, 'POST', 512), ['caseId', 'expectedAdminId']);
      const adminId = deletionId(input.expectedAdminId);
      if (typeof input.caseId !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(input.caseId)) throw new DeletionInputError();
      const ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, 'UNTRUSTED_INGRESS');
      const token = readAccountSessionToken(request);
      if (!token) throw new AuthRequestError(401, 'UNAUTHENTICATED');
      const state = await runtime();
      if (!await state.allow(ip)) throw new AuthRequestError(429, 'RATE_LIMITED');
      const admin = await state.resolve(token);
      if (!admin || admin.role !== 'admin') throw new AuthRequestError(403, 'ADMIN_REQUIRED');
      if (admin.id !== adminId) throw new AuthRequestError(409, 'ACCOUNT_CHANGED');
      await prepare(input.caseId, token);
      return authJson({ status: 'prepared' }, 200);
    } catch (error) {
      if (error instanceof AuthRequestError) return authJson({ error: { code: error.code } }, error.status);
      if (error instanceof DeletionInputError) return authJson({ error: { code: 'INVALID_INPUT' } }, 422);
      return authJson({ error: { code: 'EXPORT_UNAVAILABLE' } }, 503);
    }
  };
}
