import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { encodeFileInspection, decodeFileInspection, encodeFileObservation, decodeFileObservation,
  FILE_INSPECT_REQUEST_BYTES, FILE_INSPECT_REPLY_BYTES } from "../src/lib/media-file-inspection-protocol.ts";

const record = { id: randomUUID(), mimeType: "image/webp", width: 2048, height: 1, size: 2 * 1024 * 1024, sha256: "ab".repeat(32) }, attemptId = randomUUID();
test("inspection IPC carries only a bounded copy of metadata and two UUIDs", () => {
  const input = { ...record }, frame = encodeFileInspection(input, attemptId); input.id = randomUUID(); input.size = 12;
  assert.equal(frame.length, FILE_INSPECT_REQUEST_BYTES); assert.equal(frame.length, 116);
  assert.deepEqual(decodeFileInspection(frame), { record, attemptId });
});
test("inspection IPC rejects extra authority, paths and invalid metadata before I/O", () => {
  for (const candidate of [null, { ...record, token: "secret" }, { ...record, owner: randomUUID() }, { ...record, id: "../outside" },
    { ...record, width: 0 }, { ...record, height: 2049 }, { ...record, size: 11 }, { ...record, size: record.size + 1 },
    { ...record, sha256: "x".repeat(64) }, { ...record, mimeType: "image/png" }]) assert.throws(() => encodeFileInspection(candidate, attemptId));
  for (const candidate of [undefined, "../pending", attemptId.toUpperCase()]) assert.throws(() => encodeFileInspection(record, candidate));
});
test("inspection IPC rejects truncation, excess bytes, high-bit magic, UUID and dimension corruption", () => {
  const frame = encodeFileInspection(record, attemptId);
  for (const candidate of [frame.subarray(0, 115), Buffer.concat([frame, Buffer.from([0])]), Buffer.alloc(10000)]) assert.throws(() => decodeFileInspection(candidate));
  for (const index of [0, 4, 40]) { const changed = Buffer.from(frame); changed[index] ^= 128; assert.throws(() => decodeFileInspection(changed)); }
  const dimensions = Buffer.from(frame); dimensions.writeUInt16BE(2049, 76); assert.throws(() => decodeFileInspection(dimensions));
});
test("observation IPC is seven bytes with no bytes, path, inode or deletion token", () => {
  for (const final of ["absent", "complete", "incomplete", "unsafe"]) for (const temporary of ["absent", "complete", "incomplete", "unsafe"]) {
    const observation = { final, temporary, linked: false }, frame = encodeFileObservation(observation);
    assert.equal(frame.length, FILE_INSPECT_REPLY_BYTES); assert.equal(frame.length, 7); assert.deepEqual(decodeFileObservation(frame), observation);
  }
  for (const status of ["complete", "incomplete"]) assert.deepEqual(decodeFileObservation(encodeFileObservation({ final: status, temporary: status, linked: true })), { final: status, temporary: status, linked: true });
});
test("observation IPC rejects malformed or contradictory reports", () => {
  const frame = encodeFileObservation({ final: "complete", temporary: "absent", linked: false });
  for (const candidate of [frame.subarray(0, 6), Buffer.concat([frame, Buffer.from([0])]), Buffer.from([1])]) assert.throws(() => decodeFileObservation(candidate));
  for (const [index, value] of [[0, frame[0] ^ 128], [4, 4], [5, 4], [6, 2], [6, 1]]) {
    const changed = Buffer.from(frame); changed[index] = value; assert.throws(() => decodeFileObservation(changed));
  }
  for (const candidate of [{ final: "absent", temporary: "absent", linked: true }, { final: "complete", temporary: "incomplete", linked: true },
    { final: "unsafe", temporary: "unsafe", linked: true }, { final: "invalid", temporary: "absent", linked: false },
    { final: "absent", temporary: "absent", linked: 0 }, { final: "absent", temporary: "absent", linked: false, path: "/tmp" }]) assert.throws(() => encodeFileObservation(candidate));
});
