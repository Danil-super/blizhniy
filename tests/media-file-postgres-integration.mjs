import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileWorkerModule } from "./media-file-worker-module.mjs";
import { loadMediaModule } from "./media-module.mjs";

const { LocalMediaWriter } = loadMediaModule("media-write");
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const fail = promise => assert.rejects(promise, error => error.code === "MEDIA_WRITE_UNAVAILABLE" && !error.cause);
export async function testFencedMediaWrites(suite, db, { repo, root, token, image, bytes }) {
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
}
