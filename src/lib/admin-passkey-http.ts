import { randomUUID } from "node:crypto";
import { readAccountSessionToken } from "./account-cookie.ts";
import { AdminPasskeyError, adminPasskeyRelyingParty } from "./admin-passkey.ts";
import { parseAdminPasskeyRequest, parseAdminPasskeyResult, type AdminPasskeyRequest } from "./admin-passkey-contract.ts";
import type { createAdminArchivePasskey } from "./admin-archive-passkey.ts";
import type { createAdminRefundPasskey } from "./admin-refund-passkey.ts";
import { AdminRefundInputError } from "./admin-refund-contract.ts";
import { DeletionInputError } from "./account-deletion-contract.ts";
import type { createAdminUserAccessPasskey } from "./admin-user-access-passkey.ts";
import { AuthRequestError, authJson, readAuthJson, type AuthRateLimiter } from "./auth-http.ts";
import { ListingDraftInputError } from "./listing-draft-contract.ts";
import type { AdminPasskeyEnrollment } from "./postgres-admin-passkey-enrollment.ts";
import { getTrustedProxyIp } from "./trusted-proxy-ip.ts";

export type AdminPasskeyServices = {
  enrollment?: Pick<AdminPasskeyEnrollment, "begin" | "finish">;
  access?: ReturnType<typeof createAdminUserAccessPasskey>;
  archive?: ReturnType<typeof createAdminArchivePasskey>;
  refund?: ReturnType<typeof createAdminRefundPasskey>;
};
type Runtime = {
  limiter: Pick<AuthRateLimiter, "allowProduction">;
  execute: (token: string, input: AdminPasskeyRequest, signal: AbortSignal) => Promise<unknown>;
};
type AuditEvent = { event: "admin_passkey"; requestId: string; status: number; code?: string };

export async function executeAdminPasskeyRequest(services: AdminPasskeyServices, token: string, input: AdminPasskeyRequest) {
  const { enrollment, access, archive, refund } = services;
  if (input.action === "enroll-options" && enrollment) return { options: await enrollment.begin(token, input.code) };
  if (input.action === "enroll-finish" && enrollment) {
    await enrollment.finish(token, input.code, input.credential);
    return { status: "enrolled" };
  }
  if (input.action === "access-options" && access) return { options: await access.begin(token, input.command) };
  if (input.action === "access-approve" && access) {
    await access.approve(token, input.command, input.credential);
    return { status: "approved" };
  }
  if (input.action === "archive-options" && archive) return { options: await archive.begin(token, input.command) };
  if (input.action === "archive-approve" && archive) {
    await archive.approve(token, input.command, input.credential);
    return { status: "approved" };
  }
  if (input.action === "refund-options" && refund) return { options: await refund.begin(token, input.command) };
  if (input.action === "refund-approve" && refund) {
    await refund.approve(token, input.command, input.credential);
    return { status: "approved" };
  }
  throw new AuthRequestError(404, "NOT_FOUND");
}

export function createAdminPasskeyHandler(config: { origin: string; refundOptions?: () => boolean }, runtime: () => Runtime | Promise<Runtime>,
  audit: (event: AuditEvent) => void = event => console.info(JSON.stringify(event))) {
  adminPasskeyRelyingParty(config.origin);
  return async (request: Request) => {
    const requestId = randomUUID();
    let status = 503, code: string | undefined;
    const reply = (body: unknown, next: number, headers?: Record<string, string>) => {
      status = next;
      return authJson(body, status, { "X-Request-ID": requestId, ...headers });
    };
    try {
      const input = parseAdminPasskeyRequest(await readAuthJson(request, config, 2000, "POST", 32_768));
      if (input.action === "archive-options" || input.action === "archive-approve" || input.action === "refund-approve") {
        throw new AuthRequestError(422, "INVALID_INPUT");
      }
      if (input.action === "refund-options" && config.refundOptions?.() !== true) throw new AuthRequestError(404, "NOT_FOUND");
      const ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, "UNTRUSTED_INGRESS");
      const token = readAccountSessionToken(request);
      if (!token) throw new AuthRequestError(401, "UNAUTHENTICATED");
      const { limiter, execute } = await runtime();
      if (!await limiter.allowProduction("session", ip)) throw new AuthRequestError(429, "RATE_LIMITED");
      request.signal.throwIfAborted();
      return reply(parseAdminPasskeyResult(input, await execute(token, input, request.signal)), 200);
    } catch (error) {
      const failure = error instanceof AuthRequestError ? error
        : error instanceof ListingDraftInputError || error instanceof DeletionInputError || error instanceof AdminRefundInputError
          ? new AuthRequestError(422, "INVALID_INPUT")
        : error instanceof AdminPasskeyError ? new AuthRequestError(403, "PASSKEY_REQUIRED")
        : new AuthRequestError(503, "PASSKEY_UNAVAILABLE");
      code = failure.code;
      return reply({ error: { code } }, failure.status, failure.status === 429 ? { "Retry-After": "900" } : undefined);
    } finally {
      audit({ event: "admin_passkey", requestId, status, code });
    }
  };
}
