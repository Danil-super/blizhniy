import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import { loadMediaModule } from "./media-module.mjs";

const { LocalMediaUpload } = loadMediaModule("media-upload");
const source = await sharp({ create: { width: 16, height: 9, channels: 3, background: "#619a77" } }).png().toBuffer();
const bytes = await sharp(source).webp().toBuffer();
const image = { bytes, mimeType: "image/webp", width: 16, height: 9, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const token = "a".repeat(64), intent = randomUUID(), id = randomUUID();
const record = { id, mimeType: image.mimeType, width: 16, height: 9, size: bytes.length, sha256: image.sha256 };
function fixture(fault = {}) {
  const events = [], metadata = [];
  const repository = {
    getByIntent: async (session, key) => { events.push("auth"); assert.equal(session, token); assert.equal(key, intent); if (fault.auth) throw fault.auth; return fault.existing ?? null; },
    reserve: async (session, key, value) => { events.push("reserve"); assert.equal(session, token); assert.equal(key, intent); metadata.push(value); fault.afterReserve?.(); if (fault.reserve) throw fault.reserve; return { ...record, state: fault.existing ? "ready" : "pending" }; },
    readOwned: async (session, fileId) => { events.push("read"); assert.equal(session, token); assert.equal(fileId, id); if (fault.read) throw fault.read; return fault.missing ? null : { record, bytes }; },
  };
  const normalizer = { normalize: async (input, mimeType) => { events.push("decode"); assert.deepEqual(input, source); assert.equal(mimeType, "image/png"); if (fault.decode) throw fault.decode; return fault.output ?? image; } };
  const writer = { write: async (session, fileId, value) => { events.push("write"); assert.equal(session, token); assert.equal(fileId, id); assert.deepEqual(value.bytes, bytes); if (fault.write) throw fault.write; return { ...record, state: "ready" }; } };
  return { upload: new LocalMediaUpload(repository, normalizer, writer), events, metadata };
}
const fail = (promise, code) => assert.rejects(promise, error => error.name === "MediaUploadError" && error.code === code && error.message === "Media upload operation failed" && !error.cause);
const coded = code => Object.assign(new Error("Synthetic private detail"), { code });
test("upload authenticates before decode and reserves only normalized metadata before one-shot write", async () => {
  const app = fixture();
  assert.deepEqual({ ...await app.upload.upload(token, intent, source, "image/png") }, { id, mimeType: "image/webp", width: 16, height: 9, size: bytes.length });
  assert.deepEqual(app.events, ["auth", "decode", "reserve", "write"]);
  assert.deepEqual({ ...app.metadata[0] }, { mimeType: image.mimeType, width: 16, height: 9, size: bytes.length, sha256: image.sha256 });
});
test("invalid intent, unbounded bytes and forbidden MIME consume no authentication or worker capacity", async () => {
  const app = fixture();
  for (const [key, input, mime] of [["../file", source, "image/png"], [intent, null, "image/png"], [intent, Buffer.alloc(0), "image/png"], [intent, Buffer.alloc(10485761), "image/png"], [intent, source, "image/svg+xml"], [intent.toUpperCase(), source, "image/png"]]) {
    await fail(app.upload.upload(token, key, input, mime), "INVALID_MEDIA_UPLOAD");
  }
  assert.deepEqual(app.events, []);
});
test("source is copied before asynchronous authentication", async () => {
  const app = fixture(), input = Buffer.from(source);
  const pending = app.upload.upload(token, intent, input, "image/png"); input.fill(0); await pending;
});
test("invalid or revoked session never reaches decoder, reservation or filesystem", async () => {
  const app = fixture({ auth: coded("MEDIA_ACCESS_DENIED") });
  await fail(app.upload.upload(token, intent, source, "image/png"), "MEDIA_ACCESS_DENIED"); assert.deepEqual(app.events, ["auth"]);
});
test("an unresolved pending intent never authorizes another decode, claim or write", async () => {
  const app = fixture({ existing: { ...record, state: "pending" } });
  await fail(app.upload.upload(token, intent, source, "image/png"), "MEDIA_IN_PROGRESS"); assert.deepEqual(app.events, ["auth"]);
});
test("ready replay verifies normalized payload and actual owned file without another write", async () => {
  const app = fixture({ existing: { ...record, state: "ready" } });
  assert.equal((await app.upload.upload(token, intent, source, "image/png")).id, id);
  assert.deepEqual(app.events, ["auth", "decode", "reserve", "read"]);
});
test("same ready intent with different payload conflicts before readback or write", async () => {
  const app = fixture({ existing: { ...record, state: "ready" }, reserve: coded("MEDIA_INTENT_CONFLICT") });
  await fail(app.upload.upload(token, intent, source, "image/png"), "MEDIA_INTENT_CONFLICT");
  assert.deepEqual(app.events, ["auth", "decode", "reserve"]);
});
test("decoder failure or malformed reply never consumes storage quota", async () => {
  for (const fault of [{ decode: coded("INVALID_IMAGE") }, { output: { ...image, bytes: Buffer.alloc(bytes.length) } }, { output: { ...image, bytes: Buffer.alloc(2097153) } }, { output: { ...image, mimeType: "image/png" } }]) {
    const app = fixture(fault);
    await fail(app.upload.upload(token, intent, source, "image/png"), fault.decode ? "INVALID_IMAGE" : "MEDIA_UPLOAD_UNAVAILABLE");
    assert.deepEqual(app.events, ["auth", "decode"]);
  }
});
test("unknown reservation outcome never starts a write; quota/conflict errors remain finite", async () => {
  for (const code of ["MEDIA_METADATA_UNAVAILABLE", "MEDIA_IN_PROGRESS", "MEDIA_QUOTA_EXCEEDED"]) {
    const app = fixture({ reserve: coded(code) });
    await fail(app.upload.upload(token, intent, source, "image/png"), code === "MEDIA_METADATA_UNAVAILABLE" ? "MEDIA_UPLOAD_UNAVAILABLE" : code);
    assert.deepEqual(app.events, ["auth", "decode", "reserve"]);
  }
});
test("unknown write or missing ready file is not compensated, reset or retried", async () => {
  const app = fixture({ write: coded("MEDIA_WRITE_UNAVAILABLE") });
  await fail(app.upload.upload(token, intent, source, "image/png"), "MEDIA_UPLOAD_UNAVAILABLE");
  assert.deepEqual(app.events, ["auth", "decode", "reserve", "write"]);
  const replay = fixture({ existing: { ...record, state: "ready" }, missing: true });
  await fail(replay.upload.upload(token, intent, source, "image/png"), "MEDIA_UPLOAD_UNAVAILABLE");
  assert.deepEqual(replay.events, ["auth", "decode", "reserve", "read"]);
});
test("abort before authentication, after decode and before reservation does not start storage writes", async () => {
  const abort = new AbortController(); abort.abort(); const app = fixture();
  await fail(app.upload.upload(token, intent, source, "image/png", abort.signal), "MEDIA_UPLOAD_UNAVAILABLE"); assert.deepEqual(app.events, []);
  const later = new AbortController(), duringDecode = fixture({ get output() { later.abort(); return image; } });
  await fail(duringDecode.upload.upload(token, intent, source, "image/png", later.signal), "MEDIA_UPLOAD_UNAVAILABLE");
  assert.deepEqual(duringDecode.events, ["auth", "decode"]);
});
test("client cancellation after reservation does not strand or replay a committed one-shot operation", async () => {
  const abort = new AbortController(), app = fixture({ afterReserve: () => abort.abort() });
  assert.equal((await app.upload.upload(token, intent, source, "image/png", abort.signal)).id, id);
  assert.equal(abort.signal.aborted, true); assert.deepEqual(app.events, ["auth", "decode", "reserve", "write"]);
});
test("session revoked during decode is rechecked by reservation before any filesystem claim", async () => {
  const app = fixture({ reserve: coded("MEDIA_ACCESS_DENIED") });
  await fail(app.upload.upload(token, intent, source, "image/png"), "MEDIA_ACCESS_DENIED");
  assert.deepEqual(app.events, ["auth", "decode", "reserve"]);
});
test("production/browser/non-Linux cannot expose the local upload workflow", () => {
  for (const environment of [{ env: { NODE_ENV: "production" } }, { env: {} }, { browser: true }, { platform: "win32" }]) {
    assert.throws(() => new (loadMediaModule("media-upload", environment).LocalMediaUpload)({}, {}, {}), error => error.code === "MEDIA_UPLOAD_UNAVAILABLE");
  }
});
