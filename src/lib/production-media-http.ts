import { randomUUID } from "node:crypto";
import { AuthRequestError, authJson, readAuthJson } from "./auth-http.ts";
import type { AuthRateLimiter } from "./auth-http";
import { readAccountSessionToken } from "./account-cookie.ts";
import { getTrustedProxyIp } from "./trusted-proxy-ip.ts";
import { parseListingDraftId, ListingDraftInputError } from "./listing-draft-contract.ts";
import { parseMediaId, parseUploadedImage, mediaUploadTypes, normalizedImageByteLimit, MediaInputError } from "./media-upload-contract.ts";
import { maxListingImageFileSize } from "./media-limits.ts";
import type { IdentityStore } from "./identity";
import type { LocalMediaUpload } from "./media-upload";
import type { MediaMetadataRepository } from "./media-metadata";

type Runtime = { identity: Pick<IdentityStore, "resolveSession">; limiter: Pick<AuthRateLimiter, "allowProduction">;
  upload: Pick<LocalMediaUpload, "upload">; repository: Pick<MediaMetadataRepository, "readOwned"> };
type Event = { event: "media_request"; requestId: string; operation: string; status: number; durationMs: number; code?: string };
const shared = globalThis as typeof globalThis & { blizhniyMediaAdmission?: { upload: boolean; reads: number } };
const admission = shared.blizhniyMediaAdmission ??= { upload: false, reads: 0 };

function uploadBoundary(request: Request, origin: string) {
  if (request.method !== "POST") throw new AuthRequestError(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("host") !== new URL(origin).host) throw new AuthRequestError(403, "FORBIDDEN_TARGET");
  if (request.headers.get("origin") !== origin || request.headers.get("x-blizhniy-request") !== "1" ||
      (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) throw new AuthRequestError(403, "FORBIDDEN_ORIGIN");
  if (new URL(request.url).search) throw new AuthRequestError(400, "QUERY_NOT_ALLOWED");
  const mimeType = request.headers.get("content-type");
  if (!mediaUploadTypes.some(type => type === mimeType)) throw new AuthRequestError(415, "UNSUPPORTED_IMAGE");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxListingImageFileSize)) throw new AuthRequestError(413, "IMAGE_TOO_LARGE");
  return { owner: parseListingDraftId(request.headers.get("x-blizhniy-owner")), intent: parseMediaId(request.headers.get("x-blizhniy-intent")), mimeType: mimeType! };
}

async function readUpload(request: Request): Promise<Buffer> {
  if (!request.body) throw new AuthRequestError(400, "INVALID_IMAGE");
  const reader = request.body.getReader();let timer: ReturnType<typeof setTimeout> | undefined, complete = false;
  try {
    return await Promise.race([(async () => {
      const chunks: Uint8Array[] = [];let size = 0;
      for (;;) {
        request.signal.throwIfAborted();const part = await reader.read();request.signal.throwIfAborted();
        if (part.done) { complete = true;if (!size) throw new AuthRequestError(422, "INVALID_IMAGE");return Buffer.concat(chunks, size); }
        size += part.value.byteLength;
        if (size > maxListingImageFileSize || chunks.length >= 2048) throw new AuthRequestError(413, "IMAGE_TOO_LARGE");
        chunks.push(part.value);
      }
    })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AuthRequestError(408, "UPLOAD_TIMEOUT")), 30000); })]);
  } finally {
    clearTimeout(timer);
    try { if (!complete) await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

/** Separate private-byte boundary: no GET/public URL, bearer fallback, native decoder or retry. */
export function createProductionMediaHandler(config: { origin: string }, getRuntime: () => Runtime | Promise<Runtime>,
  audit: (event: Event) => void = event => console.info(JSON.stringify(event))) {
  if (typeof window !== "undefined") throw new Error("Media authorization is server-only");
  return async (request: Request, operation: "upload" | "read"): Promise<Response> => {
    const requestId = randomUUID(), start = Date.now();let status = 503, code: string | undefined, acquired = false;
    const respond = (body: unknown, next: number, headers?: Record<string, string>) => {
      status = next;return authJson(body, next, { "X-Request-ID": requestId, ...headers });
    };
    try {
      let owner: string, intent: string | undefined, fileId: string | undefined, mimeType: string | undefined;
      if (operation === "upload") ({ owner, intent, mimeType } = uploadBoundary(request, config.origin));
      else {
        const input = await readAuthJson(request, config);
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new AuthRequestError(422, "INVALID_INPUT");
        const row = input as Record<string, unknown>;
        if (Object.keys(row).sort().join() !== "expectedOwnerId,fileId") throw new AuthRequestError(422, "INVALID_INPUT");
        owner = parseListingDraftId(row.expectedOwnerId);fileId = parseMediaId(row.fileId);
      }
      const ip = getTrustedProxyIp(request.headers);
      if (!ip) throw new AuthRequestError(403, "UNTRUSTED_INGRESS");
      const token = readAccountSessionToken(request);
      if (!token) throw new AuthRequestError(401, "UNAUTHENTICATED");
      const runtime = await getRuntime();
      if (!await runtime.limiter.allowProduction("session", ip)) throw new AuthRequestError(429, "RATE_LIMITED");
      const user = await runtime.identity.resolveSession(token);
      if (!user) throw new AuthRequestError(401, "UNAUTHENTICATED");
      if (user.id !== owner) throw new AuthRequestError(409, "SESSION_CHANGED");
      if (operation === "upload" ? admission.upload : admission.reads >= 4) throw new AuthRequestError(503, "MEDIA_BUSY");
      if (operation === "upload") admission.upload = true;else admission.reads++;
      acquired = true;
      if (operation === "upload") {
        const bytes = await readUpload(request);
        const result = await runtime.upload.upload(token, intent!, bytes, mimeType!, request.signal);
        let view;
        try { view = parseUploadedImage(result); } catch { throw new Error("Invalid media upload reply"); }
        return respond(view, 200);
      }
      const result = await runtime.repository.readOwned(token, fileId!);
      if (!result) throw new AuthRequestError(404, "MEDIA_NOT_FOUND");
      if (result.record.mimeType !== "image/webp" || result.bytes.length !== result.record.size || result.bytes.length > normalizedImageByteLimit) throw new Error("Invalid private media reply");
      status = 200;
      const headers = new Headers(authJson({}, 200, { "X-Request-ID": requestId }).headers);
      headers.set("Content-Type", "image/webp");headers.set("Content-Length", String(result.bytes.length));headers.set("Content-Disposition", 'inline; filename="photo.webp"');
      return new Response(new Uint8Array(result.bytes), { status, headers });
    } catch (error) {
      if (error instanceof ListingDraftInputError || error instanceof MediaInputError) error = new AuthRequestError(422, "INVALID_INPUT");
      const codes: Record<string, number> = { MEDIA_ACCESS_DENIED: 401, MEDIA_NOT_FOUND: 404, MEDIA_INTENT_CONFLICT: 409,
        MEDIA_IN_PROGRESS: 409, MEDIA_QUOTA_EXCEEDED: 503, INVALID_IMAGE: 422, IMAGE_TOO_LARGE: 413, UNSUPPORTED_IMAGE: 415, MEDIA_BUSY: 503 };
      if (!(error instanceof AuthRequestError) && error && typeof error === "object" && "code" in error &&
          typeof error.code === "string" && Object.hasOwn(codes, error.code)) error = new AuthRequestError(codes[error.code], error.code);
      status = error instanceof AuthRequestError ? error.status : 503;code = error instanceof AuthRequestError ? error.code : "MEDIA_UNAVAILABLE";
      return respond({ error: { code } }, status, status === 429 ? { "Retry-After": "900" } : code === "MEDIA_BUSY" ? { "Retry-After": "1" } : undefined);
    } finally {
      if (acquired) { if (operation === "upload") admission.upload = false;else admission.reads--; }
      audit({ event: "media_request", requestId, operation, status, durationMs: Date.now()-start, code });
    }
  };
}
