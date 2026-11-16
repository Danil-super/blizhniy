import type { MediaMetadataRepository, MediaReservation } from "./media-metadata";
import type { createLocalMediaFileWorker } from "./media-file-worker";
import type { NormalizedImage } from "./media-image";
import { encodeMediaReply, MEDIA_MAX_OUTPUT_BYTES } from "./media-worker-protocol";
import { assertMediaRuntime } from "./media-runtime-policy.ts";

const metadataErrors = ["MEDIA_ACCESS_DENIED", "MEDIA_NOT_FOUND", "MEDIA_INTENT_CONFLICT", "MEDIA_IN_PROGRESS"] as const;
type WriteErrorCode = (typeof metadataErrors)[number] | "INVALID_MEDIA_WRITE" | "MEDIA_WRITE_UNAVAILABLE";
export class MediaWriteError extends Error {
  constructor(readonly code: WriteErrorCode) { super("Media write operation failed"); this.name = "MediaWriteError"; }
}
function assertLocal(): void {
  if (typeof window !== "undefined" || process.platform !== "linux") throw new MediaWriteError("MEDIA_WRITE_UNAVAILABLE");
  try { assertMediaRuntime(process); } catch { throw new MediaWriteError("MEDIA_WRITE_UNAVAILABLE"); }
}
function snapshot(input: unknown): NormalizedImage {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    const value = input as NormalizedImage;
    const { bytes, mimeType, width, height, size, sha256 } = value;
    if (Object.keys(value).length !== 6 || Object.keys(value).some(key => !["bytes", "mimeType", "width", "height", "size", "sha256"].includes(key)) ||
        !(bytes instanceof Uint8Array) || mimeType !== "image/webp" || !Number.isInteger(width) || width < 1 || width > 2048 || !Number.isInteger(height) || height < 1 || height > 2048 ||
        !Number.isInteger(size) || size < 12 || size > MEDIA_MAX_OUTPUT_BYTES || bytes.byteLength !== size || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error();
    const result = { bytes: Buffer.from(bytes), mimeType, width, height, size, sha256 };
    encodeMediaReply(result); return result;
  } catch { throw new MediaWriteError("INVALID_MEDIA_WRITE"); }
}

/** Local one-shot workflow. OS-fenced composition supplies media-file-worker, not the raw store.
 * This orchestrator itself is not a cleanup lease or authorization for resetting attempts. No HTTP/retry. */
export class LocalMediaWriter {
  constructor(private readonly repository: Pick<MediaMetadataRepository, "claimWrite" | "complete">,
    private readonly files: Pick<Awaited<ReturnType<typeof createLocalMediaFileWorker>>, "writeClaimed">) { assertLocal(); }
  async write(token: string, fileId: string, input: unknown): Promise<MediaReservation> {
    assertLocal(); const image = snapshot(input);
    try {
      const { mimeType, width, height, size, sha256 } = image;
      // Claim only while the child owns the OS fence; unknown/late COMMIT never sends file bytes.
      await this.files.writeClaimed(image.bytes, () => this.repository.claimWrite(token, fileId, { mimeType, width, height, size, sha256 }));
      return await this.repository.complete(token, fileId);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      throw new MediaWriteError(code === "MEDIA_FILE_WORKER_BUSY" ? "MEDIA_IN_PROGRESS" : metadataErrors.find(value => value === code) ?? "MEDIA_WRITE_UNAVAILABLE");
    }
  }
}
