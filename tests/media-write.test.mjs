import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import { loadMediaModule } from "./media-module.mjs";

const { LocalMediaWriter } = loadMediaModule("media-write");
const bytes = await sharp({ create: { width: 16, height: 9, channels: 3, background: "#619a77" } }).webp().toBuffer();
const image = { bytes, mimeType: "image/webp", width: 16, height: 9, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const token = "a".repeat(64), id = randomUUID(), attemptId = randomUUID();
function fixture(fault = {}) {
  const events = [], records = [];
  const repository = {
    claimWrite: async (tokenValue, fileId, metadata) => { events.push("claim"); assert.equal(tokenValue, token); assert.equal(fileId, id); records.push(metadata); if (fault.claim) throw fault.claim; return { attemptId, record: { ...metadata, id } }; },
    complete: async () => { events.push("ready"); if (fault.ready) throw fault.ready; return { ...image, id, state: "ready" }; },
  };
  const files = { write: async (record, payload, attempt) => { events.push("file"); assert.equal(attempt, attemptId); assert.equal(record.id, id); assert.deepEqual(payload, bytes); if (fault.file) throw fault.file; } };
  return { writer: new LocalMediaWriter(repository, files), events, records };
}
const fail = (promise, code) => assert.rejects(promise, error => error.name === "MediaWriteError" && error.code === code && error.message === "Media write operation failed" && !error.cause);
test("normalized bytes are written only after a committed claim and before guarded ready", async () => {
  const app = fixture(); assert.equal((await app.writer.write(token, id, image)).state, "ready");
  assert.deepEqual(app.events, ["claim", "file", "ready"]); assert.ok(!("bytes" in app.records[0]));
});
test("input bytes and metadata are snapshotted before the first await", async () => {
  const app = fixture(), input = { ...image, bytes: Buffer.from(bytes) };
  const pending = app.writer.write(token, id, input); input.bytes.fill(0); input.sha256 = "b".repeat(64); input.width = 99;
  await pending; assert.equal(app.records[0].sha256, image.sha256); assert.equal(app.records[0].width, image.width);
});
test("malformed, oversized, mismatched and client-controlled image fields cannot consume a claim", async () => {
  const app = fixture();
  for (const input of [null, [], { ...image, owner: randomUUID() }, { ...image, attemptId }, { ...image, bytes: Buffer.alloc(2097153), size: 2097153 },
    { ...image, bytes: Buffer.alloc(bytes.length) }, { ...image, sha256: "a".repeat(64) }, { ...image, sha256: image.sha256.toUpperCase() },
    { ...image, mimeType: "image/png" }, { ...image, width: 1.5 }, { ...image, size: bytes.length + 1 }]) {
    await fail(app.writer.write(token, id, input), "INVALID_MEDIA_WRITE");
  }
  assert.deepEqual(app.events, []);
});
test("unknown claim outcome never starts FS and never retries", async () => {
  const app = fixture({ claim: new Error("Synthetic lost COMMIT response with private diagnostics") });
  await fail(app.writer.write(token, id, image), "MEDIA_WRITE_UNAVAILABLE"); assert.deepEqual(app.events, ["claim"]);
});
test("an in-flight duplicate keeps its finite error and never reaches FS", async () => {
  const app = fixture({ claim: Object.assign(new Error("private"), { code: "MEDIA_IN_PROGRESS" }) });
  await fail(app.writer.write(token, id, image), "MEDIA_IN_PROGRESS"); assert.deepEqual(app.events, ["claim"]);
});
test("unknown FS or ready outcomes are not compensated by delete, reset, or a second write", async () => {
  for (const phase of ["file", "ready"]) {
    const app = fixture({ [phase]: new Error("private") });
    await fail(app.writer.write(token, id, image), "MEDIA_WRITE_UNAVAILABLE");
    assert.deepEqual(app.events, phase === "file" ? ["claim", "file"] : ["claim", "file", "ready"]);
  }
});
test("production/browser/non-Linux cannot enable the local writer", () => {
  for (const environment of [{ env: { NODE_ENV: "production" } }, { env: {} }, { browser: true }, { platform: "win32" }]) {
    assert.throws(() => new (loadMediaModule("media-write", environment).LocalMediaWriter)({}, {}), error => error.code === "MEDIA_WRITE_UNAVAILABLE");
  }
});
