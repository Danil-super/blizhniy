import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

const { encodeFileWrite, decodeFileWrite, FILE_WRITE_MAX_BYTES } = await import("../src/lib/media-file-protocol.ts");
const bytes = Buffer.from("524946460400000057454250", "hex");
const record = { id: randomUUID(), mimeType: "image/webp", width: 1, height: 1, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const attempt = randomUUID();

test("file IPC copies exact IDs and normalized bytes without SQL tokens or paths", () => {
  const source = Buffer.from(bytes), frame = encodeFileWrite(record, source, attempt); source.fill(0);
  const request = decodeFileWrite(frame);
  assert.deepEqual(request, { record, bytes, attemptId: attempt });
  assert.equal(FILE_WRITE_MAX_BYTES, 121 + 2 * 1024 * 1024);
});
test("file IPC rejects caller paths, extra fields, invalid IDs and mismatched normalized bytes", () => {
  for (const candidate of [{ ...record, id: "../outside" }, { ...record, owner: randomUUID() }, { ...record, width: 0 }, { ...record, sha256: "a".repeat(64) }]) {
    assert.throws(() => encodeFileWrite(candidate, bytes, attempt));
  }
  for (const id of [undefined, "../pending", attempt.toUpperCase()]) assert.throws(() => encodeFileWrite(record, bytes, id));
  assert.throws(() => encodeFileWrite(record, Buffer.alloc(bytes.length), attempt));
});
test("file IPC rejects truncation, overflow, corruption and error frames before filesystem I/O", () => {
  const frame = encodeFileWrite(record, bytes, attempt);
  for (const value of [frame.subarray(0, 120), Buffer.concat([frame, Buffer.from([0])]), Buffer.alloc(FILE_WRITE_MAX_BYTES + 1)]) assert.throws(() => decodeFileWrite(value));
  for (const index of [0, 4, 40, 76, 120]) {
    const changed = Buffer.from(frame); changed[index] ^= 255; assert.throws(() => decodeFileWrite(changed));
  }
});
test("file magic uses exact bytes, not ASCII high-bit masking", () => {
  const frame = encodeFileWrite(record, bytes, attempt); frame[0] ^= 128;
  assert.throws(() => decodeFileWrite(frame));
});
