import { randomUUID } from "node:crypto";
import { AuthRequestError, authJson, readAuthJson, type AuthRateLimiter } from "./auth-http";
import { readAccountSessionToken } from "./account-cookie";
import { getTrustedProxyIp } from "./trusted-proxy-ip";
import { AppSessionAccessError } from "./app-session-transaction";
import { parseProductionProfile, ProfileInputError, ProfileOwnerChangedError, type PostgresProfileStore } from "./postgres-profile";

type ProfileRuntime = { store: Pick<PostgresProfileStore, "read" | "write">; limiter: Pick<AuthRateLimiter, "allowProduction"> };
type ProfileEvent = { event: "profile_request"; requestId: string; operation: string; status: number; durationMs: number; code?: string };

/** POST reads, PUT replaces. Cookie is authority; expectedOwnerId only prevents stale account writes. */
export function createProductionProfileHandler(config: { origin: string }, getRuntime: () => ProfileRuntime | Promise<ProfileRuntime>,
  audit: (event: ProfileEvent) => void = event => console.info(JSON.stringify(event))) {
  if (typeof window !== "undefined") throw new Error("Profile authorization is server-only");
  return async (request: Request): Promise<Response> => {
    const requestId = randomUUID(), start = Date.now();
    let status = 503, code: string | undefined;
    const respond = (body: unknown, nextStatus: number, headers?: Record<string, string>) => {
      status = nextStatus;
      return authJson(body, status, { "X-Request-ID": requestId, ...headers });
    };
    try {
      if (!["POST", "PUT"].includes(request.method)) throw new AuthRequestError(405, "METHOD_NOT_ALLOWED");
      const writing = request.method === "PUT";
      const raw = await readAuthJson(request, config, 2000, writing ? "PUT" : "POST", writing ? 500000 : 4096);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AuthRequestError(422, "INVALID_INPUT");
      const body = raw as Record<string, unknown>, keys = writing ? ["expectedOwnerId", "profile"] : ["expectedOwnerId"];
      if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key)) ||
          typeof body.expectedOwnerId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.expectedOwnerId)) {
        throw new AuthRequestError(422, "INVALID_INPUT");
      }
      const profile = writing ? parseProductionProfile(body.profile) : null;
      const ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, "UNTRUSTED_INGRESS");
      const token = readAccountSessionToken(request);
      if (!token) throw new AuthRequestError(401, "UNAUTHENTICATED");
      const runtime = await getRuntime();
      if (!await runtime.limiter.allowProduction("session", ip)) {
        code = "RATE_LIMITED";
        return respond({ error: { code } }, 429, { "Retry-After": "900" });
      }
      const result = profile ? await runtime.store.write(token, body.expectedOwnerId, profile)
        : await runtime.store.read(token, body.expectedOwnerId);
      return respond(result, 200);
    } catch (error) {
      if (error instanceof AppSessionAccessError) error = new AuthRequestError(401, "UNAUTHENTICATED");
      if (error instanceof ProfileOwnerChangedError) error = new AuthRequestError(409, "SESSION_CHANGED");
      if (error instanceof ProfileInputError) error = new AuthRequestError(422, "INVALID_INPUT");
      if (error instanceof AuthRequestError) { code = error.code; return respond({ error: { code } }, error.status); }
      code = "PROFILE_UNAVAILABLE";
      return respond({ error: { code } }, 503);
    } finally {
      audit({ event: "profile_request", requestId, operation: request.method === "PUT" ? "write" : request.method === "POST" ? "read" : "unknown",
        status, durationMs: Date.now()-start, code });
    }
  };
}
