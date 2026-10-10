// Only called inside the owned bootstrap PG18/private-file fixture.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashSessionToken } from "../src/lib/identity.ts";
import { fileWorkerModule } from "./media-file-worker-module.mjs";
import { loadMediaModule } from "./media-module.mjs";
import { waitForLock } from "./admin-authorization-integration.mjs";

const { MediaMetadataRepository } = loadMediaModule("media-metadata");
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export async function testMediaObservations(suite, db, { repo, root, token, otherToken, adminToken, image, bytes }) {
  const worker = await fileWorkerModule().createLocalMediaFileWorker(appRoot, root);
  const budget = async () => (await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0];
  await suite.test("media observation: current pending/ready and known leaves are observed without media mutation", async () => {
    const pending = await repo.reserve(token, randomUUID(), image), claim = await repo.claimWrite(token, pending.id, image), before = await budget();
    assert.deepEqual({ ...await repo.observeWrite(token, pending.id, worker) }, { state: "pending", files: { final: "absent", temporary: "absent", linked: false } });
    await worker.write(claim.record, bytes, claim.attemptId);
    assert.deepEqual({ ...await repo.observeWrite(token, pending.id, worker) }, { state: "pending", files: { final: "complete", temporary: "absent", linked: false } });
    assert.equal((await repo.getWriteAttempt(token, pending.id)).attemptId, claim.attemptId);
    assert.deepEqual(await budget(), before);
    await repo.complete(token, pending.id);
    assert.deepEqual({ ...await repo.observeWrite(token, pending.id, worker) }, { state: "ready", files: { final: "complete", temporary: "absent", linked: false } });
  });
  await suite.test("media observation: other owner/admin, missing, unclaimed and bad sessions never request filesystem observation", async () => {
    const pending = await repo.reserve(token, randomUUID(), image); await repo.claimWrite(token, pending.id, image);
    const unclaimed = await repo.reserve(token, randomUUID(), image); let inspections = 0;
    const tracked = { observe: work => worker.observe(inspect => work((...args) => { inspections++; return inspect(...args); })) };
    for (const [auth, id, code] of [[otherToken, pending.id, "MEDIA_NOT_FOUND"], [adminToken, pending.id, "MEDIA_NOT_FOUND"],
      [token, randomUUID(), "MEDIA_NOT_FOUND"], [token, unclaimed.id, "MEDIA_NOT_FOUND"], ["a".repeat(64), pending.id, "MEDIA_ACCESS_DENIED"]]) {
      await assert.rejects(repo.observeWrite(auth, id, tracked), { code });
    }
    assert.equal(inspections, 0);
  });
  await suite.test("media observation: expiry after actual file report denies return and rolls back session refresh", async () => {
    const pending = await repo.reserve(token, randomUUID(), image), claim = await repo.claimWrite(token, pending.id, image);
    await fs.writeFile(path.join(root, ".pending-" + claim.attemptId), bytes.subarray(0, 12), { flag: "wx", mode: 0o600 });
    const before = await budget(); let activeTx, inspected = false;
    const expired = new MediaMetadataRepository({ transaction: work => db.transaction(async tx => { activeTx = tx; return work(tx); }) }, { read: async () => { throw new Error("Unused reader"); } });
    const scoped = { observe: work => worker.observe(inspect => work(async (...args) => {
      const report = await inspect(...args); inspected = true;
      await activeTx.query("update app.sessions set expires_at=clock_timestamp() where token_hash=$1", [hashSessionToken(token)]);
      return report;
    })) };
    await assert.rejects(expired.observeWrite(token, pending.id, scoped), { code: "MEDIA_ACCESS_DENIED" });
    assert.equal(inspected, true); assert.deepEqual(await budget(), before);
    assert.equal((await repo.getWriteAttempt(token, pending.id)).attemptId, claim.attemptId);
    assert.deepEqual({ ...await repo.observeWrite(token, pending.id, worker) }, { state: "pending", files: { final: "absent", temporary: "incomplete", linked: false } });
    assert.deepEqual(await fs.readFile(path.join(root, ".pending-" + claim.attemptId)), bytes.subarray(0, 12));
  });
  await suite.test("media observation: kernel fence remains held through SQL COMMIT response; lost response does not retry", async () => {
    const pending = await repo.reserve(token, randomUUID(), image); await repo.claimWrite(token, pending.id, image);
    const otherParent = await fileWorkerModule().createLocalMediaFileWorker(appRoot, root); let transactions = 0;
    const lost = new MediaMetadataRepository({ transaction: async work => {
      transactions++; await db.transaction(work);
      // A separate parent tests the actual kernel lock, not this process's busy flag.
      await assert.rejects(otherParent.write({ ...image, id: randomUUID() }, bytes, randomUUID()), { code: "MEDIA_FILE_WORKER_BUSY" });
      throw new Error("Synthetic lost COMMIT response");
    } }, { read: async () => { throw new Error("Unused reader"); } });
    await assert.rejects(lost.observeWrite(token, pending.id, worker), { code: "MEDIA_METADATA_UNAVAILABLE" });
    assert.equal(transactions, 1);
    assert.deepEqual({ ...await repo.observeWrite(token, pending.id, worker) }, { state: "pending", files: { final: "absent", temporary: "absent", linked: false } });
  });
  await suite.test("media observation: current state is reread after waiting on the media row while the kernel fence stays held", async () => {
    const pending = await repo.reserve(token, randomUUID(), image), claim = await repo.claimWrite(token, pending.id, image);
    await worker.write(claim.record, bytes, claim.attemptId);
    let release, locked, entered; const hold = new Promise(resolve => { release = resolve; });
    const lockReady = new Promise(resolve => { locked = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const updating = db.transaction(async tx => {
      await tx.query("update app.media_objects set state='ready',ready_at=clock_timestamp() where id=$1", [pending.id]); locked(); await hold;
    });
    await lockReady;
    const watched = new MediaMetadataRepository({ transaction: work => db.transaction(async tx => {
      const { rows: [row] } = await tx.query("select pg_backend_pid() as pid"); entered(row.pid); return work(tx);
    }) }, { read: async () => { throw new Error("Unused reader"); } });
    const observing = watched.observeWrite(token, pending.id, worker);
    try {
      await waitForLock(db, await started);
      const separateParent = await fileWorkerModule().createLocalMediaFileWorker(appRoot, root);
      await assert.rejects(separateParent.write({ ...image, id: randomUUID() }, bytes, randomUUID()), { code: "MEDIA_FILE_WORKER_BUSY" });
      release(); await updating;
      assert.deepEqual({ ...await observing }, { state: "ready", files: { final: "complete", temporary: "absent", linked: false } });
    } finally { release(); await updating; await observing.catch(() => {}); }
  });
  await suite.test("media observation: existing column-scoped runtime grants suffice without new privileges", async () => {
    const pending = await repo.reserve(token, randomUUID(), image); await repo.claimWrite(token, pending.id, image);
    const restricted = new MediaMetadataRepository({ transaction: work => db.transaction(async tx => {
      await tx.query("set local role media_fixture_runtime"); return work(tx);
    }) }, { read: async () => { throw new Error("Unused reader"); } });
    assert.deepEqual({ ...await restricted.observeWrite(token, pending.id, worker) }, { state: "pending", files: { final: "absent", temporary: "absent", linked: false } });
  });
}
