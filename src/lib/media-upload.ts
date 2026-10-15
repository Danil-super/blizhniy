import type { MediaMetadataRepository, MediaReservation } from "./media-metadata";
import type { LocalMediaWriter } from "./media-write";
import type { createLocalMediaWorker } from "./media-worker";
import { decodeMediaReply, encodeMediaReply, MEDIA_INPUT_TYPES, MEDIA_MAX_INPUT_BYTES, MEDIA_MAX_OUTPUT_BYTES } from "./media-worker-protocol";

export type UploadedMedia = Pick<MediaReservation, "id" | "mimeType" | "width" | "height" | "size">;
const publicErrors = ["MEDIA_ACCESS_DENIED", "MEDIA_INTENT_CONFLICT", "MEDIA_IN_PROGRESS", "MEDIA_QUOTA_EXCEEDED",
  "INVALID_IMAGE", "IMAGE_TOO_LARGE", "UNSUPPORTED_IMAGE", "MEDIA_BUSY"] as const;
type UploadErrorCode = (typeof publicErrors)[number] | "INVALID_MEDIA_UPLOAD" | "MEDIA_UPLOAD_UNAVAILABLE";
export class MediaUploadError extends Error {
  constructor(readonly code: UploadErrorCode) { super("Media upload operation failed"); this.name = "MediaUploadError"; }
}
function assertLocal(): void {
  if (typeof window !== "undefined" || process.platform !== "linux" || !["development", "test"].includes(process.env.NODE_ENV ?? "")) throw new MediaUploadError("MEDIA_UPLOAD_UNAVAILABLE");
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new MediaUploadError("MEDIA_UPLOAD_UNAVAILABLE");
}
const result = ({ id, mimeType, width, height, size }: MediaReservation): UploadedMedia => ({ id, mimeType, width, height, size });

/** Local composition only: supply the constrained decoder and OS-fenced one-shot writer.
 * No HTTP, public paths, cleanup, resumed claims or automatic retries. */
export class LocalMediaUpload {
  constructor(private readonly repository: Pick<MediaMetadataRepository, "getByIntent" | "reserve" | "readOwned">,
    private readonly normalizer: Pick<ReturnType<typeof createLocalMediaWorker>, "normalize">,
    private readonly writer: Pick<LocalMediaWriter, "write">) { assertLocal(); }

  async upload(token: string, intentId: string, source: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<UploadedMedia> {
    assertLocal();
    if (typeof intentId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(intentId) ||
        !(source instanceof Uint8Array) || !source.byteLength || source.byteLength > MEDIA_MAX_INPUT_BYTES || !MEDIA_INPUT_TYPES.some(type => type === mimeType)) throw new MediaUploadError("INVALID_MEDIA_UPLOAD");
    checkAbort(signal);
    const input = Buffer.from(source);
    try {
      // This read authenticates even when no intent exists; pending never grants another writer.
      const existing = await this.repository.getByIntent(token, intentId);
      if (existing?.state === "pending") throw new MediaUploadError("MEDIA_IN_PROGRESS");
      checkAbort(signal);
      const normalized = await this.normalizer.normalize(input, mimeType, signal);
      if (normalized.mimeType !== "image/webp" || !(normalized.bytes instanceof Uint8Array) || normalized.bytes.byteLength > MEDIA_MAX_OUTPUT_BYTES) throw new MediaUploadError("MEDIA_UPLOAD_UNAVAILABLE");
      const image = decodeMediaReply(encodeMediaReply(normalized));
      if ("error" in image) throw new MediaUploadError("MEDIA_UPLOAD_UNAVAILABLE");
      checkAbort(signal);
      const { width, height, size, sha256 } = image;
      const reserved = await this.repository.reserve(token, intentId, { mimeType: image.mimeType, width, height, size, sha256 });
      // After mutation starts, finish bounded one-shot work even if the caller disconnects.
      // Unknown COMMIT/FS results remain unknown; no new claim, reset or compensation.
      if (reserved.state === "ready") {
        if (!await this.repository.readOwned(token, reserved.id)) throw new MediaUploadError("MEDIA_UPLOAD_UNAVAILABLE");
        return result(reserved);
      }
      const ready = await this.writer.write(token, reserved.id, image);
      if (ready.state !== "ready") throw new MediaUploadError("MEDIA_UPLOAD_UNAVAILABLE");
      return result(ready);
    } catch (error) {
      if (error instanceof MediaUploadError) throw error;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      throw new MediaUploadError(publicErrors.find(value => value === code) ?? "MEDIA_UPLOAD_UNAVAILABLE");
    }
  }
}
