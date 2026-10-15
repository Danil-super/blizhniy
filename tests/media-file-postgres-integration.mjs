import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileWorkerModule } from "./media-file-worker-module.mjs";
import { loadMediaModule } from "./media-module.mjs";
import { testMediaObservations } from "./media-observation-integration.mjs";
import { normalizeMediaImage } from "../src/lib/media-image.ts";
import sharp from "sharp";

const { LocalMediaWriter } = loadMediaModule("media-write");
const { LocalMediaUpload } = loadMediaModule("media-upload");
const { MediaMetadataRepository } = loadMediaModule("media-metadata");
const { createLocalMediaFileStore } = loadMediaModule("media-files");
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const fail = promise => assert.rejects(promise, error => error.code === "MEDIA_WRITE_UNAVAILABLE" && !error.cause);
export async function testFencedMediaWrites(suite, db, { repo, root, token, otherToken, adminToken, image, bytes }) {
  await fs.writeFile(path.join(root, ".writer.lock"), "", { flag: "wx", mode: 0o600 });
  await suite.test("file process + PG: committed owner claim, OS-fenced write, ready and private read", async () => {
    const pending = await repo.reserve(token, randomUUID(), image);
    const worker = await fileWorkerModule().createLocalMediaFileWorker(appRoot, root);
    const writer = new LocalMediaWriter(repo, { write: async (...args) => {
      assert.equal((await repo.getWriteAttempt(token, pending.id)).attemptId, args[2]);
      await worker.write(...args);
    } });
    assert.equal((await writer.write(token, pending.id, { ...image, bytes })).state, "ready");
    assert.deepEqual((await repo.readOwned(token, pending.id)).bytes, bytes);
    await assert.rejects(writer.write(token, pending.id, { ...image, bytes }), { code: "MEDIA_IN_PROGRESS" });
  });
  await suite.test("upload + restricted PG + fenced FS: pixels to owned ready file; replay cannot duplicate or change the payload", async () => {
    const limitedDb = { transaction: work => db.transaction(async tx => { await tx.query("set local role media_fixture_runtime"); return work(tx); }) };
    const limited = new MediaMetadataRepository(limitedDb, await createLocalMediaFileStore(root));
    const worker = await fileWorkerModule().createLocalMediaFileWorker(appRoot, root);
    let writes = 0, decodes = 0;
    const writer = new LocalMediaWriter(limited, { write: async (...args) => { writes++; await worker.write(...args); } });
    // Real pixels here, not a codec sandbox: systemd/cgroup enforcement has its separate local suite.
    const normalizer = { normalize: async (...args) => { decodes++; return normalizeMediaImage(...args); } };
    const upload = new LocalMediaUpload(limited, normalizer, writer), intent = randomUUID();
    const source = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const before = (await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0];
    const ready = await upload.upload(token, intent, source, "image/jpeg");
    assert.deepEqual(Object.keys(ready).sort(), ["height", "id", "mimeType", "size", "width"]);
    assert.equal(ready.width, 40); assert.equal(ready.height, 80);
    const stored = await limited.readOwned(token, ready.id), metadata = await sharp(stored.bytes).metadata();
    assert.equal(metadata.format, "webp"); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
    assert.equal((await upload.upload(token, intent, source, "image/jpeg")).id, ready.id);
    assert.equal(writes, 1); assert.equal(decodes, 2);
    const after = (await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0];
    assert.equal(BigInt(after.charged_bytes) - BigInt(before.charged_bytes), BigInt(ready.size));
    assert.equal(after.charged_objects - before.charged_objects, 1);
    const changed = await sharp({ create: { width: 12, height: 9, channels: 3, background: "blue" } }).png().toBuffer();
    await assert.rejects(upload.upload(token, intent, changed, "image/png"), { code: "MEDIA_INTENT_CONFLICT" });
    assert.equal(writes, 1); assert.deepEqual((await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0], after);
    assert.equal(await limited.readOwned(otherToken, ready.id), null); assert.equal(await limited.readOwned(adminToken, ready.id), null);
    const independent = await upload.upload(otherToken, intent, source, "image/jpeg");
    assert.notEqual(independent.id, ready.id); assert.equal(await limited.readOwned(token, independent.id), null);
    const beforeDenial = decodes;
    await assert.rejects(upload.upload("0".repeat(64), randomUUID(), source, "image/jpeg"), { code: "MEDIA_ACCESS_DENIED" });
    assert.equal(decodes, beforeDenial);
    const beforeInvalid = (await db.query("select count(*)::integer as n from app.media_objects")).rows[0].n;
    await assert.rejects(upload.upload(token, randomUUID(), source.subarray(0, 30), "image/jpeg"), { code: "INVALID_IMAGE" });
    assert.equal((await db.query("select count(*)::integer as n from app.media_objects")).rows[0].n, beforeInvalid);
  });
  await suite.test("upload + PG: lost ready acknowledgement reads the committed file without a second claim or write", async () => {
    const worker = await fileWorkerModule().createLocalMediaFileWorker(appRoot, root);
    let writes = 0;
    const writer = new LocalMediaWriter({ claimWrite: repo.claimWrite.bind(repo), complete: async (...args) => {
      await repo.complete(...args); throw new Error("Synthetic lost committed ready acknowledgement");
    } }, { write: async (...args) => { writes++; await worker.write(...args); } });
    const upload = new LocalMediaUpload(repo, { normalize: normalizeMediaImage }, writer), intent = randomUUID();
    await assert.rejects(upload.upload(token, intent, bytes, "image/webp"), { code: "MEDIA_UPLOAD_UNAVAILABLE" });
    const saved = await repo.getByIntent(token, intent); assert.equal(saved.state, "ready");
    assert.equal((await upload.upload(token, intent, bytes, "image/webp")).id, saved.id);
    assert.equal(writes, 1);
    assert.equal((await db.query("select count(*)::integer as n from app.media_write_attempts where media_id=$1", [saved.id])).rows[0].n, 1);
  });
  await suite.test("upload + PG: two callers past authentication cannot race into two reservations or writes", { timeout: 15000 }, async () => {
    const normalized = await normalizeMediaImage(bytes, "image/webp"), worker = await fileWorkerModule().createLocalMediaFileWorker(appRoot, root);
    let entered = 0, release, writes = 0;
    const barrier = new Promise(resolve => { release = resolve; });
    const normalizer = { normalize: async () => { if (++entered === 2) release(); await barrier; return normalized; } };
    const writer = new LocalMediaWriter(repo, { write: async (...args) => { writes++; await worker.write(...args); } });
    const upload = new LocalMediaUpload(repo, normalizer, writer), intent = randomUUID();
    const outcomes = await Promise.allSettled([upload.upload(token, intent, bytes, "image/webp"), upload.upload(token, intent, bytes, "image/webp")]);
    assert.equal(entered, 2); assert.ok(outcomes.some(value => value.status === "fulfilled"));
    for (const value of outcomes) if (value.status === "rejected") assert.equal(value.reason.code, "MEDIA_IN_PROGRESS");
    const saved = await repo.getByIntent(token, intent); assert.equal(saved.state, "ready"); assert.equal(writes, 1);
    assert.equal((await db.query("select count(*)::integer as n from app.media_write_attempts where media_id=$1", [saved.id])).rows[0].n, 1);
  });
  await suite.test("file process + PG: cancelled partial writer stops, retains immutable claim and quota, never resumes", async () => {
    const pending = await repo.reserve(token, randomUUID(), image), abort = new AbortController(); let closed = false, child;
    const budget = (await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0];
    const module = fileWorkerModule({ childProcess: { spawn: (command, args, options) => {
      child = spawn(command, Array.from(args, arg => arg === path.join(appRoot, "scripts/media-file-worker.mjs") ? path.join(appRoot, "tests/media-file-worker-fault.mjs") : arg), options);
      child.once("close", () => { closed = true; }); return child;
    } } });
    const worker = await module.createLocalMediaFileWorker(appRoot, root);
    const writer = new LocalMediaWriter(repo, { write: (...args) => worker.write(...args, abort.signal) });
    const writing = writer.write(token, pending.id, { ...image, bytes }), rejected = fail(writing); let claim, partial;
    try {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline && !closed) {
        claim = await repo.getWriteAttempt(token, pending.id);
        partial = claim ? await fs.lstat(path.join(root, `.pending-${claim.attemptId}`)).catch(() => null) : null;
        if (partial?.size === 12) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(partial?.size === 12); abort.abort(); await rejected;
      assert.equal(closed, true); assert.equal(child.signalCode, "SIGKILL"); assert.equal(await repo.readOwned(token, pending.id), null);
      assert.equal((await repo.getWriteAttempt(token, pending.id)).attemptId, claim.attemptId);
      assert.deepEqual((await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0], budget);
      await assert.rejects(new LocalMediaWriter(repo, await fileWorkerModule().createLocalMediaFileWorker(appRoot, root)).write(token, pending.id, { ...image, bytes }), { code: "MEDIA_IN_PROGRESS" });
      assert.equal((await fs.lstat(path.join(root, `.pending-${claim.attemptId}`))).ino, partial.ino);
    } finally { abort.abort(); if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await rejected; }
  });
  await testMediaObservations(suite, db, { repo, root, token, otherToken, adminToken, image, bytes });
}
