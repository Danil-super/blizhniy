import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadMediaModule } from "./media-module.mjs";

const { MediaMetadataRepository } = loadMediaModule("media-metadata");
const metadata = { mimeType: "image/webp", width: 16, height: 9, size: 128, sha256: "a".repeat(64) };
const token = "a".repeat(64);
function fixture(row = { ...metadata, id: randomUUID(), state: "pending" }, options = {}) {
  const calls = []; let reads = 0, transactions = 0;
  const db = { transaction: work => { transactions++; return work({ query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.startsWith("select u.id")) return { rows: [{ id: "owner", role: "user", isBlocked: false, verified: true, authVersion: "0" }] };
    if (sql.startsWith("select token_hash") || sql.startsWith("update app.sessions")) return { rowCount: 1, rows: [] };
    if (options.error) throw options.error;
    if (sql.startsWith("insert") && options.conflict) return { rowCount: 0, rows: [] };
    return { rowCount: row ? 1 : 0, rows: row ? [{ ...row, ...(sql.startsWith("update") ? { state: "ready" } : {}) }] : [] };
  } }); } };
  const repository = new MediaMetadataRepository(db, { read: async () => { reads++; if (options.readError) throw options.readError; return Buffer.alloc(metadata.size); } });
  return { repository, calls, readCount: () => reads, transactionCount: () => transactions };
}
const fail = (promise, code) => assert.rejects(promise, error => error.name === "MediaMetadataError" && error.code === code && error.message === "Media metadata operation failed" && !error.cause);
test("reservation accepts only normalized metadata and stable UUID intent, never owner/state/path from a caller", async () => {
  const { repository, calls } = fixture();
  for (const value of [null, [], { ...metadata, ownerId: randomUUID() }, { ...metadata, state: "ready" }, { ...metadata, id: randomUUID() }, { ...metadata, path: "../" },
    { ...metadata, size: 2097153 }, { ...metadata, width: 2049 }, { ...metadata, height: 0 }, { ...metadata, sha256: "A".repeat(64) }, { ...metadata, mimeType: "image/png" }]) {
    await fail(repository.reserve(token, randomUUID(), value), "INVALID_MEDIA_METADATA");
  }
  await fail(repository.reserve(token, "../../outside", metadata), "INVALID_MEDIA_METADATA"); assert.equal(calls.length, 0);
});
test("owner is the guarded database identity and intent/metadata are bound, not interpolated", async () => {
  const { repository, calls } = fixture(), intent = randomUUID(), input = { ...metadata };
  const pending = repository.reserve(token, intent, input); input.sha256 = "b".repeat(64); await pending;
  const insert = calls.find(call => call.sql.startsWith("insert"));
  assert.equal(insert.values[0], "owner"); assert.ok(insert.values.includes(intent)); assert.ok(insert.values.includes(metadata.sha256));
  assert.ok(!insert.sql.includes(intent)); assert.ok(!insert.sql.includes(metadata.sha256));
});
test("duplicates cannot start another pending write and a changed payload cannot reuse an intent", async () => {
  await fail(fixture(undefined, { conflict: true }).repository.reserve(token, randomUUID(), metadata), "MEDIA_IN_PROGRESS");
  await fail(fixture({ ...metadata, sha256: "b".repeat(64), id: randomUUID(), state: "pending" }, { conflict: true }).repository.reserve(token, randomUUID(), metadata), "MEDIA_INTENT_CONFLICT");
  const row = { ...metadata, id: randomUUID(), state: "ready" };
  assert.deepEqual(await fixture(row, { conflict: true }).repository.reserve(token, randomUUID(), metadata), row);
});
test("missing/foreign records never reach the filesystem and reads require ready state", async () => {
  const missing = fixture(null); assert.equal(await missing.repository.readOwned(token, randomUUID()), null);
  await fail(missing.repository.complete(token, randomUUID()), "MEDIA_NOT_FOUND"); assert.equal(missing.readCount(), 0);
  const pending = fixture(); assert.equal(await pending.repository.readOwned(token, randomUUID()), null); assert.equal(pending.readCount(), 0);
});
test("ready transition verifies the file before SQL update; failure stays generic without retries", async () => {
  const app = fixture(); assert.equal((await app.repository.complete(token, randomUUID())).state, "ready"); assert.equal(app.readCount(), 1);
  const failed = fixture(undefined, { readError: new Error("private file diagnostic") });
  await fail(failed.repository.complete(token, randomUUID()), "MEDIA_METADATA_UNAVAILABLE");
  assert.equal(failed.readCount(), 1); assert.equal(failed.calls.filter(call => call.sql.startsWith("update app.media_objects")).length, 0);
});
test("quota SQLSTATE is finite and unknown commit errors remain generic without an automatic second transaction", async () => {
  for (const code of ["BL001", "ECONNRESET"]) {
    const app = fixture(undefined, { error: Object.assign(new Error("private SQL and credential"), { code }) });
    await fail(app.repository.reserve(token, randomUUID(), metadata), code === "BL001" ? "MEDIA_QUOTA_EXCEEDED" : "MEDIA_METADATA_UNAVAILABLE"); assert.equal(app.transactionCount(), 1);
  }
});
test("production and browser cannot enable this local repository", () => {
  for (const environment of [{ env: { NODE_ENV: "production" } }, { env: {} }, { browser: true }]) {
    assert.throws(() => new (loadMediaModule("media-metadata", environment).MediaMetadataRepository)({}, {}), error => error.code === "MEDIA_METADATA_UNAVAILABLE");
  }
});
test("a write claim validates metadata against the locked owned reservation and stores only its ID", async () => {
  const row = { ...metadata, id: randomUUID(), state: "pending" }, app = fixture(row);
  const claim = await app.repository.claimWrite(token, row.id, metadata);
  assert.equal(claim.record.id, row.id);
  const insert = app.calls.find(call => call.sql.startsWith("insert into app.media_write_attempts"));
  assert.deepEqual(Array.from(insert.values), [row.id]); assert.ok(!insert.sql.includes(row.id));
  assert.equal(app.readCount(), 0);
});
test("a foreign, ready, mismatching or already claimed record cannot grant another write", async () => {
  await fail(fixture(null).repository.claimWrite(token, randomUUID(), metadata), "MEDIA_NOT_FOUND");
  await fail(fixture({ ...metadata, id: randomUUID(), state: "ready" }).repository.claimWrite(token, randomUUID(), metadata), "MEDIA_IN_PROGRESS");
  await fail(fixture().repository.claimWrite(token, randomUUID(), { ...metadata, sha256: "b".repeat(64) }), "MEDIA_INTENT_CONFLICT");
  await fail(fixture(undefined, { conflict: true }).repository.claimWrite(token, randomUUID(), metadata), "MEDIA_IN_PROGRESS");
});
test("observation validates identifiers before its fence and maps busy/unknown errors without a SQL retry", async () => {
  const app = fixture(); let attempts = 0;
  const busy = { observe: async () => { attempts++; throw Object.assign(new Error("Private diagnostics"), { code: "MEDIA_FILE_WORKER_BUSY" }); } };
  await fail(app.repository.observeWrite(token, "../outside", busy), "INVALID_MEDIA_METADATA"); assert.equal(attempts, 0);
  await fail(app.repository.observeWrite(token, randomUUID(), busy), "MEDIA_IN_PROGRESS"); assert.equal(attempts, 1); assert.equal(app.transactionCount(), 0);
  await fail(app.repository.observeWrite(token, randomUUID(), { observe: async () => { throw new Error("Private worker diagnostics"); } }), "MEDIA_METADATA_UNAVAILABLE");
});
test("missing observation never invokes a reader or requests bytes inside its guarded fence", async () => {
  const app = fixture(null); let inspections = 0;
  await fail(app.repository.observeWrite(token, randomUUID(), { observe: work => work(async () => { inspections++; }) }), "MEDIA_NOT_FOUND");
  assert.equal(inspections, 0); assert.equal(app.readCount(), 0); assert.equal(app.transactionCount(), 1);
});
