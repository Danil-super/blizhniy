// Called only by the ownership-checked, throwaway bootstrap PG18 + private FS fixture.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMediaModule } from "./media-module.mjs";
import { waitForLock } from "./admin-authorization-integration.mjs";
import { testFencedMediaWrites } from "./media-file-postgres-integration.mjs";

const { MediaMetadataRepository } = loadMediaModule("media-metadata");
const { LocalMediaWriter } = loadMediaModule("media-write");
const fail = (promise, code) => assert.rejects(promise, error => error.code === code && !error.cause);
export async function testMediaWrites(suite, db, operator, { repo, store, root, token, otherToken, adminToken, image, bytes, ready }) {
  const normalized = { ...image, bytes };
  const reserve = async () => repo.reserve(token, randomUUID(), image);
  const count = async id => (await db.query("select count(*)::integer as n from app.media_write_attempts where media_id=$1", [id])).rows[0].n;
  const down = readFileSync(new URL("../database/migrations/0007-media-write-attempts.down.sql", import.meta.url), "utf8");
  const up = readFileSync(new URL("../database/migrations/0007-media-write-attempts.sql", import.meta.url), "utf8");
  let written;
  await suite.test("media writer: committed attempt precedes real FS and private ready survives readback", async () => {
    written = await reserve(); let writes = 0;
    const writer = new LocalMediaWriter(repo, { write: async (record, payload, attempt) => {
      writes++; assert.equal((await repo.getWriteAttempt(token, written.id)).attemptId, attempt);
      await store.write(record, payload, attempt);
    } });
    assert.equal((await writer.write(token, written.id, normalized)).state, "ready");
    assert.equal(writes, 1); assert.deepEqual((await repo.readOwned(token, written.id)).bytes, bytes); assert.equal(await count(written.id), 1);
    await fail(writer.write(token, written.id, normalized), "MEDIA_IN_PROGRESS"); assert.equal(writes, 1);
  });
  await suite.test("media writer: foreign/admin IDs, changed metadata and an already ready record do not create a claim", async () => {
    const pending = await reserve();
    for (const foreignToken of [otherToken, adminToken]) {
      await fail(repo.claimWrite(foreignToken, pending.id, image), "MEDIA_NOT_FOUND");
      assert.equal(await repo.getWriteAttempt(foreignToken, written.id), null);
    }
    await fail(repo.claimWrite(token, pending.id, { ...image, sha256: "b".repeat(64) }), "MEDIA_INTENT_CONFLICT");
    await fail(repo.claimWrite(token, ready.id, image), "MEDIA_IN_PROGRESS"); assert.equal(await count(pending.id), 0);
    await assert.rejects(operator.query("insert into app.media_write_attempts(media_id) values($1)", [ready.id]), { code: "23514" });
  });
  await suite.test("media writer: concurrent calls for one pending file start exactly one FS write", async () => {
    const pending = await reserve(); let writes = 0, release, entered;
    const barrier = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const writer = new LocalMediaWriter(repo, { write: async (...args) => { writes++; entered(); await barrier; return store.write(...args); } });
    const first = writer.write(token, pending.id, normalized);
    try { await Promise.race([started, first]); await fail(new LocalMediaWriter(repo, store).write(token, pending.id, normalized), "MEDIA_IN_PROGRESS"); }
    finally { release(); await first; }
    assert.equal(writes, 1); assert.equal(await count(pending.id), 1);
  });
  await suite.test("media writer: lost claim COMMIT never reaches FS and readback does not grant another write", async () => {
    const pending = await reserve(); let transactions = 0, writes = 0;
    const lost = new MediaMetadataRepository({ transaction: async work => {
      transactions++; await db.transaction(work); throw Object.assign(new Error("Synthetic lost claim response"), { code: "ECONNRESET" });
    } }, store);
    await fail(new LocalMediaWriter(lost, { write: async () => { writes++; } }).write(token, pending.id, normalized), "MEDIA_WRITE_UNAVAILABLE");
    assert.equal(transactions, 1); assert.equal(writes, 0); assert.ok(await repo.getWriteAttempt(token, pending.id));
    await fail(new LocalMediaWriter(repo, store).write(token, pending.id, normalized), "MEDIA_IN_PROGRESS");
    assert.equal(await count(pending.id), 1); assert.equal((await repo.getByIntent(token, (await db.query("select intent_id from app.media_objects where id=$1", [pending.id])).rows[0].intent_id)).state, "pending");
  });
  await suite.test("media writer: unknown FS result retains claim/file/quota and existing file can be completed without rewriting", async () => {
    const pending = await reserve(); let writes = 0;
    const before = (await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0];
    const writer = new LocalMediaWriter(repo, { write: async (...args) => { writes++; await store.write(...args); throw new Error("Synthetic lost FS response"); } });
    await fail(writer.write(token, pending.id, normalized), "MEDIA_WRITE_UNAVAILABLE");
    assert.equal(await repo.readOwned(token, pending.id), null); assert.deepEqual(await store.read(pending), bytes);
    await fail(writer.write(token, pending.id, normalized), "MEDIA_IN_PROGRESS"); assert.equal(writes, 1);
    assert.deepEqual((await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0], before);
    assert.equal((await repo.complete(token, pending.id)).state, "ready"); assert.equal(await count(pending.id), 1);
  });
  await suite.test("media writer: lost ready COMMIT retains ready result with no second FS write", async () => {
    const pending = await reserve(); let transactions = 0, writes = 0;
    const lost = new MediaMetadataRepository({ transaction: async work => {
      const result = await db.transaction(work); transactions++;
      if (transactions === 2) throw Object.assign(new Error("Synthetic lost ready response"), { code: "ECONNRESET" });
      return result;
    } }, store);
    const writer = new LocalMediaWriter(lost, { write: async (...args) => { writes++; return store.write(...args); } });
    await fail(writer.write(token, pending.id, normalized), "MEDIA_WRITE_UNAVAILABLE");
    assert.equal(transactions, 2); assert.deepEqual((await repo.readOwned(token, pending.id)).bytes, bytes);
    await fail(new LocalMediaWriter(repo, store).write(token, pending.id, normalized), "MEDIA_IN_PROGRESS"); assert.equal(writes, 1);
  });
  await suite.test("media writer: SIGKILL leaves a charged immutable claim and its exact partial temporary file without replay", async () => {
    const pending = await reserve(), claim = await repo.claimWrite(token, pending.id, image);
    const before = (await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0];
    const child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./media-write-crash-fixture.mjs", import.meta.url)), root, claim.attemptId], {
      env: { NODE_ENV: "test", PATH: process.env.PATH }, stdio: ["pipe", "pipe", "ignore"],
    });
    let partial = "", timer;
    const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
    try {
      const started = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Owned partial-write child did not reach its barrier")), 8000);
        child.stdout.on("data", chunk => { partial += chunk.toString("utf8"); if (partial.length > 32) reject(new Error("Owned child output bound exceeded")); if (partial === "partial\n") resolve(); });
      });
      child.stdin.on("error", () => {}); child.stdin.end(JSON.stringify({ record: claim.record, hex: bytes.toString("hex") }));
      await Promise.race([started, closed.then(() => { throw new Error("Owned child exited before the partial-write barrier"); })]);
      child.kill("SIGKILL"); assert.equal((await closed).signal, "SIGKILL");
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    }
    const info = await fs.lstat(path.join(root, `.pending-${claim.attemptId}`));
    assert.ok(info.isFile()); assert.equal(info.size, 12); assert.equal(info.mode & 0o7777, 0o600); assert.equal(info.uid, process.getuid());
    assert.equal((await repo.getWriteAttempt(token, pending.id)).attemptId, claim.attemptId);
    await fail(new LocalMediaWriter(repo, store).write(token, pending.id, normalized), "MEDIA_IN_PROGRESS");
    assert.equal(await repo.readOwned(token, pending.id), null);
    assert.equal((await fs.lstat(path.join(root, `.pending-${claim.attemptId}`))).ino, info.ino);
    assert.deepEqual((await db.query("select charged_bytes,charged_objects from app.media_storage_budget")).rows[0], before);
  });
  await suite.test("media writer: column-scoped role can claim but cannot alter IDs/time/journal or insert without pending parent", async () => {
    const limitedDb = { transaction: work => db.transaction(async tx => { await tx.query("set local role media_fixture_runtime"); return work(tx); }) };
    const limited = new MediaMetadataRepository(limitedDb, store), pending = await reserve();
    const claim = await limited.claimWrite(token, pending.id, image);
    assert.equal((await limited.getWriteAttempt(token, pending.id)).attemptId, claim.attemptId);
    for (const sql of ["update app.media_write_attempts set claimed_at=now()", "delete from app.media_write_attempts", "truncate app.media_write_attempts", "insert into app.media_write_attempts(id,media_id) select gen_random_uuid(),id from app.media_objects limit 1"]) {
      await assert.rejects(limitedDb.transaction(tx => tx.query(sql)), { code: "42501" });
    }
    await assert.rejects(operator.query("update app.media_write_attempts set claimed_at=now() where id=$1", [claim.attemptId]), { code: "BL003" });
    await assert.rejects(operator.query("delete from app.media_write_attempts where id=$1", [claim.attemptId]), { code: "BL003" });
    await fail(limited.claimWrite(token, pending.id, image), "MEDIA_IN_PROGRESS");
  });
  await testFencedMediaWrites(suite, db, { repo, root, token, otherToken, adminToken, image, bytes });
  await suite.test("media writer: guarded down refuses recorded and concurrently committed attempts; empty-only rehearsal preserves media", async () => {
    await assert.rejects(operator.query(down), /Refusing/); await operator.query("rollback");
    // Only this disposable fixture is reset. There is no application delete/reset method.
    await operator.query("truncate app.media_write_attempts");
    const pending = await reserve(); let release, entered;
    const barrier = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const held = new MediaMetadataRepository({ transaction: work => db.transaction(async tx => { const result = await work(tx); entered(); await barrier; return result; }) }, store);
    const claim = held.claimWrite(token, pending.id, image); let refused;
    try {
      await Promise.race([started, claim]); const pid = (await operator.query("select pg_backend_pid() as pid")).rows[0].pid;
      refused = assert.rejects(operator.query(down), /Refusing/); await waitForLock(db, pid);
    } finally { release(); await claim; }
    await refused; await operator.query("rollback");
    assert.equal(await count(pending.id), 1);
    await operator.query("truncate app.media_write_attempts"); await operator.query(down);
    assert.equal((await operator.query("select to_regclass('app.media_write_attempts') is null as absent")).rows[0].absent, true);
    assert.deepEqual((await repo.readOwned(token, written.id)).bytes, bytes);
    await operator.query(up);
  });
}
