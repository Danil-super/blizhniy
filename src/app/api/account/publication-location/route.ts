import { readAccountSessionToken } from "@/lib/account-cookie";
import { AuthRequestError, authJson, readAuthJson } from "@/lib/auth-http";
import { hashSessionToken } from "@/lib/identity";
import { ListingDraftInputError, parseListingDraftId } from "@/lib/listing-draft-contract";
import { parseListingPhotoIds } from "@/lib/listing-photo-contract";
import { publicationTextLabels } from "@/lib/publication-text-selection";
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
    const action = Object.hasOwn(input, "action") ? input.action : undefined;
    const photoList = action === "photos";
    const photoWrite = action === "withdraw-photo";
    const textList = action === "texts";
    const textWrite = action === "withdraw-text";
    const statusOnly = action === "status" || action === "publication-status" || photoList || textList;
    const full = action === "withdraw-publication" || action === "publication-status";
    if (Object.keys(input).length !== (textWrite ? 8 : photoWrite ? 5 : statusOnly || full ? 4 : 3) ||
        (photoWrite && !Object.hasOwn(input, 'photoId')) ||
        (textWrite && !['field','fingerprint','start','end'].every(key => Object.hasOwn(input,key)))) return error(422, "INVALID_INPUT");
    const { kind } = input;
    if (typeof kind !== "string" || !["listing", "vacancy", "workRequest", "specialist", "fair", ...(full || textList || textWrite ? ["marquee"] : [])].includes(kind)) {
      return error(422, "INVALID_INPUT");
    }
    const publicationId = parseListingDraftId(input.publicationId);
    const actor = parseListingDraftId(input.expectedOwnerId);
    let scope = full ? "publication" : photoList ? "photos" : textList ? "texts" : "location";
    if (photoWrite) {
      scope = kind === "specialist" && input.photoId === "avatar" ? "avatar" : "photo:" + parseListingPhotoIds([input.photoId])[0];
    }
    if (textWrite) {
      const {field,fingerprint,start,end}=input;
      if(typeof field!=="string"||!Object.hasOwn(publicationTextLabels,field)||
         typeof fingerprint!=="string"||!/^[0-9a-f]{64}$/.test(fingerprint)||
         typeof start!=="number"||typeof end!=="number"||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
         start<0||end<=start||end>9999)return error(422,"INVALID_INPUT");
      scope=`text:${field}:${fingerprint}:${start}:${end}`;
    }
    const ip = getTrustedProxyIp(request.headers);
    if (!ip) return error(403, "UNTRUSTED_INGRESS");
    const token = readAccountSessionToken(request);
    if (!token) return error(401, "UNAUTHENTICATED");
    const { db, limiter } = await getProductionAccountDatabase(config);
    if (!await hasLocationWithdrawalSchema(db)) return error(404, "NOT_FOUND");
    if (!await limiter.allowProduction("session", ip)) return error(429, "RATE_LIMITED");
    request.signal.throwIfAborted();
    const { rows: [{ result } = {}] } = await db.query<{ result: { withdrawnAt?: string | null; photos?: unknown[]; texts?: unknown[] } }>(
      'select app_publication_privacy.withdraw_location($1,$2,$3,$4,$5,$6) as result',
      [hashSessionToken(token), actor, kind, publicationId, !statusOnly, scope],
    );
    if (photoList && Array.isArray(result?.photos)) return authJson({ kind, publicationId, photos: result.photos }, 200);
    if (textList && Array.isArray(result?.texts)) return authJson({ kind, publicationId, texts: result.texts }, 200);
    if (!result || (result.withdrawnAt === null ? !statusOnly : typeof result.withdrawnAt !== "string")) {
      return error(503, "LOCATION_UNAVAILABLE");
    }
    return authJson({ kind, publicationId, withdrawnAt: result.withdrawnAt, ...(photoWrite ? { photoId: scope === "avatar" ? scope : scope.slice(6) } : {}) }, 200);
  } catch (failure) {
    if (failure instanceof AuthRequestError) return error(failure.status, failure.code);
    if (failure instanceof ListingDraftInputError) return error(422, "INVALID_INPUT");
    if (failure && typeof failure === "object" && "code" in failure) {
      if (failure.code === "PDW01") return error(403, "OWNER_REQUIRED");
      if (failure.code === "PDW02") return error(404, "NOT_FOUND");
      if (failure.code === "PDW03") return error(409, "TEXT_CHANGED");
    }
    return error(503, "LOCATION_UNAVAILABLE");
  }
}
