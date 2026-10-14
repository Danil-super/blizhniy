import { randomUUID } from "node:crypto";
import { AuthRequestError, authJson, readAuthJson, type AuthRateLimiter } from "./auth-http";
import { readAccountSessionToken } from "./account-cookie";
import { getTrustedProxyIp } from "./trusted-proxy-ip";
import { AppSessionAccessError } from "./app-session-transaction";
import { ListingDraftInputError, parseListingDraft, parseListingDraftId, parseListingDraftRevision } from "./listing-draft-contract";
import { ListingDraftAccessError, ListingDraftConflictError, type PostgresListingDraftStore } from "./postgres-listing-drafts";

type DraftRuntime = { store: Pick<PostgresListingDraftStore, "read" | "update">; limiter: Pick<AuthRateLimiter, "allowProduction"> };
type DraftEvent = { event: "listing_draft_request"; requestId: string; operation: "read" | "update" | "unknown"; status: number; durationMs: number; code?: string };

/** POST reads; PUT replaces the core of an existing draft. No creation or automatic retry. */
export function createProductionListingDraftHandler(config: { origin: string }, getRuntime: () => DraftRuntime | Promise<DraftRuntime>,
  audit: (event: DraftEvent) => void = event => console.info(JSON.stringify(event))) {
  if (typeof window !== "undefined") throw new Error("Listing draft authorization is server-only");
  return async (request: Request): Promise<Response> => {
    const requestId = randomUUID(), start = Date.now();
    let status = 503, code: string | undefined;
    const respond = (body: unknown, nextStatus: number, headers?: Record<string, string>) => {
      status = nextStatus;
      return authJson(body, status, { "X-Request-ID": requestId, ...headers });
    };
    try {
      if (!["POST", "PUT"].includes(request.method)) {
        code = "METHOD_NOT_ALLOWED";
        return respond({ error: { code } }, 405, { Allow: "POST, PUT" });
      }
      const writing = request.method === "PUT";
      const raw = await readAuthJson(request, config, 2000, writing ? "PUT" : "POST", writing ? 65536 : 4096);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AuthRequestError(422, "INVALID_INPUT");
      const body = raw as Record<string, unknown>;
      const keys = writing ? ["expectedOwnerId", "listingId", "expectedRevision", "draft"] : ["expectedOwnerId", "listingId"];
      if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) throw new AuthRequestError(422, "INVALID_INPUT");
      const expectedOwnerId = parseListingDraftId(body.expectedOwnerId), listingId = parseListingDraftId(body.listingId);
      const revision = writing ? parseListingDraftRevision(body.expectedRevision) : null;
      const draft = writing ? parseListingDraft(body.draft) : null;
      const ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, "UNTRUSTED_INGRESS");
      const token = readAccountSessionToken(request);
      if (!token) throw new AuthRequestError(401, "UNAUTHENTICATED");
      const runtime = await getRuntime();
      if (!await runtime.limiter.allowProduction("session", ip)) {
        code = "RATE_LIMITED";
        return respond({ error: { code } }, 429, { "Retry-After": "900" });
      }
      const result = draft ? await runtime.store.update(token, expectedOwnerId, listingId, revision, draft)
        : await runtime.store.read(token, expectedOwnerId, listingId);
      return respond(result, 200);
    } catch (error) {
      if (error instanceof AppSessionAccessError) error = new AuthRequestError(401, "UNAUTHENTICATED");
      if (error instanceof ListingDraftAccessError) error = new AuthRequestError(404, "DRAFT_NOT_FOUND");
      if (error instanceof ListingDraftConflictError) error = new AuthRequestError(409, "DRAFT_CHANGED");
      if (error instanceof ListingDraftInputError) error = new AuthRequestError(422, "INVALID_INPUT");
      code = error instanceof AuthRequestError ? error.code : "DRAFT_UNAVAILABLE";
      return respond({ error: { code } }, error instanceof AuthRequestError ? error.status : 503);
    } finally {
      audit({ event: "listing_draft_request", requestId, operation: request.method === "PUT" ? "update" : request.method === "POST" ? "read" : "unknown",
        status, durationMs: Date.now()-start, code });
    }
  };
}
