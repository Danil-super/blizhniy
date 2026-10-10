import type { MediaFileRecord } from "./media-files";
import { encodeMediaReply, decodeMediaReply, MEDIA_REPLY_HEADER_BYTES, MEDIA_MAX_OUTPUT_BYTES } from "./media-worker-protocol.ts";

export const FILE_WRITE_MAX_BYTES = 76 + MEDIA_REPLY_HEADER_BYTES + MEDIA_MAX_OUTPUT_BYTES;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const invalid = () => { throw new Error("Invalid file write frame"); };

export function encodeFileWrite(record: MediaFileRecord, source: Uint8Array, attemptId: string): Buffer {
  if (!record || Object.keys(record).length !== 6 || Object.keys(record).some(key => !["id", "mimeType", "width", "height", "size", "sha256"].includes(key))) return invalid();
  if (typeof record.id !== "string" || !uuid.test(record.id) || typeof attemptId !== "string" || !uuid.test(attemptId) || record.mimeType !== "image/webp" ||
      !(source instanceof Uint8Array) || !Number.isInteger(record.width) || !Number.isInteger(record.height) || !Number.isInteger(record.size) ||
      typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256) || source.byteLength !== record.size || source.byteLength > MEDIA_MAX_OUTPUT_BYTES) return invalid();
  return Buffer.concat([Buffer.from("BFW1" + record.id + attemptId, "ascii"), encodeMediaReply({ ...record, bytes: Buffer.from(source) })]);
}

export function decodeFileWrite(frame: Buffer): { record: MediaFileRecord; bytes: Buffer; attemptId: string } {
  if (frame.length < 76 + MEDIA_REPLY_HEADER_BYTES || frame.length > FILE_WRITE_MAX_BYTES || !frame.subarray(0, 4).equals(Buffer.from("BFW1"))) return invalid();
  const id = frame.toString("utf8", 4, 40), attemptId = frame.toString("utf8", 40, 76);
  if (!uuid.test(id) || !uuid.test(attemptId)) return invalid();
  const image = decodeMediaReply(frame.subarray(76));
  if ("error" in image) return invalid();
  const { bytes, ...metadata } = image;
  return { record: { id, ...metadata }, bytes, attemptId };
}
