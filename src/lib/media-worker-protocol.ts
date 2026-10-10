import { createHash } from "node:crypto";
import type { NormalizedImage } from "./media-image";

export const MEDIA_REPLY_HEADER_BYTES = 45;
export const MEDIA_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MEDIA_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MEDIA_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const errors = ["INVALID_IMAGE", "IMAGE_TOO_LARGE", "UNSUPPORTED_IMAGE", "MEDIA_UNAVAILABLE"] as const;
type WorkerFailure = { error: (typeof errors)[number] };
const magic = Buffer.from("BLM1");

export function encodeMediaFailure(code: string): Buffer {
  const header = Buffer.alloc(MEDIA_REPLY_HEADER_BYTES);
  magic.copy(header);
  const index = errors.findIndex(value => value === code);
  header[4] = index < 0 ? errors.length : index + 1;
  return header;
}

export function encodeMediaReply(image: NormalizedImage): Buffer {
  const header = Buffer.alloc(MEDIA_REPLY_HEADER_BYTES);
  magic.copy(header);
  header.writeUInt16BE(image.width, 5); header.writeUInt16BE(image.height, 7);
  header.writeUInt32BE(image.size, 9);
  Buffer.from(image.sha256, "hex").copy(header, 13);
  const frame = Buffer.concat([header, image.bytes]);
  decodeMediaReply(frame);
  return frame;
}

/** Treat the worker as a separate, untrusted boundary; never decode pixels here. */
export function decodeMediaReply(frame: Buffer): NormalizedImage | WorkerFailure {
  const invalid = () => { throw new Error("Invalid media reply"); };
  if (frame.length < MEDIA_REPLY_HEADER_BYTES || frame.length > MEDIA_REPLY_HEADER_BYTES + MEDIA_MAX_OUTPUT_BYTES || !frame.subarray(0, 4).equals(magic)) return invalid();
  const status = frame[4];
  if (status) {
    if (status > errors.length || frame.length !== MEDIA_REPLY_HEADER_BYTES || frame.subarray(5).some(byte => byte !== 0)) return invalid();
    return { error: errors[status - 1] };
  }
  const width = frame.readUInt16BE(5), height = frame.readUInt16BE(7), size = frame.readUInt32BE(9);
  const bytes = frame.subarray(MEDIA_REPLY_HEADER_BYTES);
  if (width < 1 || height < 1 || width > 2048 || height > 2048 || size !== bytes.length || size < 12 || size > MEDIA_MAX_OUTPUT_BYTES) return invalid();
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== size) return invalid();
  const digest = createHash("sha256").update(bytes).digest();
  if (!digest.equals(frame.subarray(13, MEDIA_REPLY_HEADER_BYTES))) return invalid();
  return { bytes, mimeType: "image/webp", width, height, size, sha256: digest.toString("hex") };
}
