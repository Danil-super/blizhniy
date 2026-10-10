import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import { encodeMediaReply, encodeMediaFailure, decodeMediaReply, MEDIA_REPLY_HEADER_BYTES } from "../src/lib/media-worker-protocol.ts";

async function reply() {
  const bytes = await sharp({ create: { width: 10, height: 5, channels: 3, background: "red" } }).webp().toBuffer();
  return { bytes, mimeType: "image/webp", width: 10, height: 5, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
test("binary worker reply preserves only bounded WebP metadata and actual bytes", async () => {
  const image = await reply();
  const encoded = encodeMediaReply(image);
  assert.equal(encoded.length, image.size + MEDIA_REPLY_HEADER_BYTES);
  assert.deepEqual(decodeMediaReply(encoded), image);
});
test("worker errors are finite codes without arbitrary messages or residual data", () => {
  for (const code of ["INVALID_IMAGE", "IMAGE_TOO_LARGE", "UNSUPPORTED_IMAGE", "MEDIA_UNAVAILABLE"]) {
    const frame = encodeMediaFailure(code);
    assert.equal(frame.length, MEDIA_REPLY_HEADER_BYTES);
    assert.deepEqual(decodeMediaReply(frame), { error: code });
    const extra = Buffer.concat([frame, Buffer.from("private details")]);
    assert.throws(() => decodeMediaReply(extra));
    frame[5] = 1;
    assert.throws(() => decodeMediaReply(frame));
  }
  assert.deepEqual(decodeMediaReply(encodeMediaFailure("private details")), { error: "MEDIA_UNAVAILABLE" });
});
test("truncated, wrong-version, unknown-status and mismatched-length replies cannot become photos", async () => {
  const frame = encodeMediaReply(await reply());
  for (const value of [Buffer.alloc(0), frame.subarray(0, 44), frame.subarray(0, -1), Buffer.concat([frame, Buffer.alloc(1)])]) {
    assert.throws(() => decodeMediaReply(value));
  }
  for (const [offset, value] of [[0, 0], [3, 50], [4, 255]]) {
    const broken = Buffer.from(frame); broken[offset] = value;
    assert.throws(() => decodeMediaReply(broken));
  }
});
test("worker reply validates dimensions, size, digest and container without loading a pixel decoder", async () => {
  const frame = encodeMediaReply(await reply());
  for (const mutate of [b => b.writeUInt16BE(0, 5), b => b.writeUInt16BE(2049, 7), b => b.writeUInt32BE(2 * 1024 * 1024 + 1, 9), b => b[13] ^= 1,
    b => b[MEDIA_REPLY_HEADER_BYTES] ^= 1, b => b.writeUInt32LE(0, MEDIA_REPLY_HEADER_BYTES + 4)]) {
    const broken = Buffer.from(frame); mutate(broken);
    assert.throws(() => decodeMediaReply(broken));
  }
  const oversized = Buffer.alloc(MEDIA_REPLY_HEADER_BYTES + 2 * 1024 * 1024 + 1);
  assert.throws(() => decodeMediaReply(oversized));
});
