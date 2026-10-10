import type { MediaFileRecord, MediaFileObservation } from "./media-files";
import { MEDIA_MAX_OUTPUT_BYTES } from "./media-worker-protocol.ts";

export const FILE_INSPECT_REQUEST_BYTES = 116;
export const FILE_INSPECT_REPLY_BYTES = 7;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const statuses = ["absent", "complete", "incomplete", "unsafe"] as const;
const invalid = () => { throw new Error("Invalid file inspection frame"); };

export function encodeFileInspection(record: MediaFileRecord, attemptId: string): Buffer {
  if (!record || Object.keys(record).length !== 6 || Object.keys(record).some(key => !["id", "mimeType", "width", "height", "size", "sha256"].includes(key)) ||
      typeof record.id !== "string" || !uuid.test(record.id) || typeof attemptId !== "string" || !uuid.test(attemptId) || record.mimeType !== "image/webp" ||
      !Number.isInteger(record.width) || record.width < 1 || record.width > 2048 || !Number.isInteger(record.height) || record.height < 1 || record.height > 2048 ||
      !Number.isInteger(record.size) || record.size < 12 || record.size > MEDIA_MAX_OUTPUT_BYTES || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) return invalid();
  const frame = Buffer.alloc(FILE_INSPECT_REQUEST_BYTES);
  frame.write("BFI1" + record.id + attemptId, 0, "ascii");
  frame.writeUInt16BE(record.width, 76); frame.writeUInt16BE(record.height, 78); frame.writeUInt32BE(record.size, 80);
  Buffer.from(record.sha256, "hex").copy(frame, 84);
  return frame;
}

export function decodeFileInspection(frame: Buffer): { record: MediaFileRecord; attemptId: string } {
  if (frame.length !== FILE_INSPECT_REQUEST_BYTES || !frame.subarray(0, 4).equals(Buffer.from("BFI1"))) return invalid();
  const record: MediaFileRecord = { id: frame.toString("utf8", 4, 40), mimeType: "image/webp", width: frame.readUInt16BE(76), height: frame.readUInt16BE(78),
    size: frame.readUInt32BE(80), sha256: frame.subarray(84).toString("hex") };
  const attemptId = frame.toString("utf8", 40, 76); encodeFileInspection(record, attemptId);
  return { record, attemptId };
}

export function decodeFileObservation(frame: Buffer): MediaFileObservation {
  if (frame.length !== FILE_INSPECT_REPLY_BYTES || !frame.subarray(0, 4).equals(Buffer.from("BFO1")) || frame[4] > 3 || frame[5] > 3 || frame[6] > 1) return invalid();
  const final = statuses[frame[4]], temporary = statuses[frame[5]], linked = frame[6] === 1;
  if (linked && (final !== temporary || !["complete", "incomplete"].includes(final))) return invalid();
  return { final, temporary, linked };
}

export function encodeFileObservation(observation: MediaFileObservation): Buffer {
  if (!observation || Object.keys(observation).length !== 3 || Object.keys(observation).some(key => !["final", "temporary", "linked"].includes(key)) || typeof observation.linked !== "boolean") return invalid();
  const frame = Buffer.concat([Buffer.from("BFO1"), Buffer.from([statuses.indexOf(observation.final), statuses.indexOf(observation.temporary), Number(observation.linked)])]);
  decodeFileObservation(frame); return frame;
}
