import { readAccountSessionToken } from "@/lib/account-cookie";
import { AuthRequestError, authJson, readAuthJson } from "@/lib/auth-http";
import { hashSessionToken } from "@/lib/identity";
import { ListingDraftInputError, parseListingDraftId } from "@/lib/listing-draft-contract";
import { readProductionAuthConfig } from "@/lib/production-auth-config";
import { getProductionAccountDatabase } from "@/lib/production-auth-runtime";
import { hasLocationWithdrawalSchema } from "@/lib/publication-location-withdrawal";
import { getTrustedProxyIp } from "@/lib/trusted-proxy-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const error = (status: number, code: string) =>
    authJson({ error: { code } }, status, status === 429 ? { "Retry-After": "900" } : undefined);
  try {
    const config = readProductionAuthConfig();
    if (!config || process.env.BLIZHNIY_PUBLICATION_LOCATION_WITHDRAWALS !== "required") return error(404, "NOT_FOUND");
    const body = await readAuthJson(request, config);
    if (!body || typeof body !== "object" || Object.getPrototypeOf(body) !== Object.prototype ||
        !["kind", "publicationId", "expectedOwnerId"].every(key => Object.hasOwn(body, key))) {
      return error(422, "INVALID_INPUT");
    }
    const input = body as Record<string, unknown>;
    const statusOnly = Object.hasOwn(input, "action") && input.action === "status";
    if (Object.keys(input).length !== (statusOnly ? 4 : 3)) return error(422, "INVALID_INPUT");
    const { kind } = input;
    if (typeof kind !== "string" || !["listing", "vacancy", "workRequest", "specialist", "fair"].includes(kind)) {
      return error(422, "INVALID_INPUT");
    }
    const publicationId = parseListingDraftId(input.publicationId);
    const actor = parseListingDraftId(input.expectedOwnerId);
    const ip = getTrustedProxyIp(request.headers);
    if (!ip) return error(403, "UNTRUSTED_INGRESS");
    const token = readAccountSessionToken(request);
    if (!token) return error(401, "UNAUTHENTICATED");
    const { db, limiter } = await getProductionAccountDatabase(config);
    if (!await hasLocationWithdrawalSchema(db)) return error(404, "NOT_FOUND");
    if (!await limiter.allowProduction("session", ip)) return error(429, "RATE_LIMITED");
    request.signal.throwIfAborted();
    const { rows: [receipt] } = await db.query<{ withdrawnAt: string | null }>(
      'select app_publication_privacy.withdraw_location($1,$2,$3,$4,$5) as "withdrawnAt"',
      [hashSessionToken(token), actor, kind, publicationId, !statusOnly],
    );
    if (!receipt || (receipt.withdrawnAt === null ? !statusOnly : typeof receipt.withdrawnAt !== "string")) {
      return error(503, "LOCATION_UNAVAILABLE");
    }
    return authJson({ kind, publicationId, withdrawnAt: receipt.withdrawnAt }, 200);
  } catch (failure) {
    if (failure instanceof AuthRequestError) return error(failure.status, failure.code);
    if (failure instanceof ListingDraftInputError) return error(422, "INVALID_INPUT");
    if (failure && typeof failure === "object" && "code" in failure) {
      if (failure.code === "PDW01") return error(403, "OWNER_REQUIRED");
      if (failure.code === "PDW02") return error(404, "NOT_FOUND");
    }
    return error(503, "LOCATION_UNAVAILABLE");
  }
}
