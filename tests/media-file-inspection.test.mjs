import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import sharp from "sharp";
import { createLocalMediaFileWorker } from "../src/lib/media-file-worker.ts";
import { loadMediaModule } from "./media-module.mjs";

process.env.NODE_ENV = "test";
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const bytes = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#618477" } }).webp().toBuffer();
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "blizhniy-file-inspection-")), proof = await fs.lstat(root, { bigint: true });
  await fs.writeFile(path.join(root, ".writer.lock"), "", { flag: "wx", mode: 0o600 });
  t.after(async () => {
    const current = await fs.lstat(root, { bigint: true });
    assert.equal(current.dev, proof.dev); assert.equal(current.ino, proof.ino); assert.equal(current.uid, BigInt(process.getuid()));
    assert.ok(current.isDirectory()); assert.ok(path.basename(root).startsWith("blizhniy-file-inspection-"));
    await fs.rm(root, { recursive: true });
  });
  const record = { id: randomUUID(), mimeType: "image/webp", width: 8, height: 4, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const attemptId = randomUUID();
  return { root, record, attemptId, worker: await createLocalMediaFileWorker(appRoot, root),
    final: path.join(root, record.id + ".webp"), temporary: path.join(root, ".pending-" + attemptId) };
}
const expected = (final, temporary, linked = false) => ({ final, temporary, linked });
test("fenced inspection observes absence without creating, publishing or enumerating other attempts", async t => {
  const f = await fixture(t), unrelated = path.join(f.root, ".pending-" + randomUUID());
  await fs.writeFile(unrelated, bytes, { mode: 0o600 });
  assert.deepEqual(await f.worker.inspect(f.record, f.attemptId), expected("absent", "absent"));
  assert.deepEqual((await fs.readdir(f.root)).sort(), [".writer.lock", path.basename(unrelated)].sort());
  assert.deepEqual(await fs.readFile(unrelated), bytes);
});
test("fenced inspection observes a completed object and leaves its contents and inode intact", async t => {
  const f = await fixture(t); await f.worker.write(f.record, bytes, f.attemptId);
  const before = await fs.lstat(f.final, { bigint: true });
  assert.deepEqual(await f.worker.inspect(f.record, f.attemptId), expected("complete", "absent"));
  const after = await fs.lstat(f.final, { bigint: true });
  for (const field of ["ino", "dev", "size", "mode", "nlink", "mtimeNs", "ctimeNs"]) assert.equal(after[field], before[field]);
  assert.deepEqual(await fs.readFile(f.final), bytes);
});
test("temporary complete, incomplete and empty leaves are observations, never cleanup authority", async t => {
  const f = await fixture(t);
  for (const content of [bytes, bytes.subarray(0, 12), Buffer.alloc(0)]) {
    await fs.writeFile(f.temporary, content, { mode: 0o600 });
    const before = await fs.lstat(f.temporary, { bigint: true });
    assert.deepEqual(await f.worker.inspect(f.record, f.attemptId), expected("absent", content.length === bytes.length ? "complete" : "incomplete"));
    assert.equal((await fs.lstat(f.temporary, { bigint: true })).ino, before.ino); assert.deepEqual(await fs.readFile(f.temporary), content);
  }
});
test("only the two known leaves can explain a two-link inode; unrelated hardlinks are unsafe", async t => {
  const f = await fixture(t); await fs.writeFile(f.temporary, bytes, { mode: 0o600 }); await fs.link(f.temporary, f.final);
  assert.deepEqual(await f.worker.inspect(f.record, f.attemptId), expected("complete", "complete", true));
  const other = path.join(f.root, "unrelated"); await fs.link(f.final, other);
  assert.deepEqual(await f.worker.inspect(f.record, f.attemptId), expected("unsafe", "unsafe"));
  assert.equal((await fs.stat(f.final)).nlink, 3); assert.deepEqual(await fs.readFile(other), bytes);
});
test("unsafe symlink, directory, public mode, oversized and corrupt leaves are neither followed nor removed", async t => {
  const f = await fixture(t);
  const other = path.join(f.root, "unrelated"); await fs.writeFile(other, bytes, { mode: 0o600 });
  const setups = [
    async () => fs.symlink(other, f.final), async () => fs.mkdir(f.final),
    async () => fs.writeFile(f.final, bytes, { mode: 0o644 }),
    async () => fs.writeFile(f.final, Buffer.concat([bytes, Buffer.from([0])]), { mode: 0o600 }),
    async () => fs.writeFile(f.final, Buffer.alloc(bytes.length), { mode: 0o600 }),
    async () => fs.link(other, f.final),
  ];
  for (const setup of setups) {
    await setup(); const before = await fs.lstat(f.final, { bigint: true });
    assert.deepEqual(await f.worker.inspect(f.record, f.attemptId), expected("unsafe", "absent"));
    assert.equal((await fs.lstat(f.final, { bigint: true })).ino, before.ino);
    await fs.rm(f.final, { recursive: true }); // Only this fixture's explicitly created leaf.
  }
  assert.deepEqual(await fs.readFile(other), bytes);
});
test("inspection invalid authority and cancellation cannot create any leaf", async t => {
  const f = await fixture(t), abort = new AbortController(); abort.abort();
  await assert.rejects(f.worker.inspect({ ...f.record, owner: randomUUID() }, f.attemptId), { code: "INVALID_MEDIA_FILE_INSPECTION" });
  await assert.rejects(f.worker.inspect(f.record, "../pending"), { code: "INVALID_MEDIA_FILE_INSPECTION" });
  await assert.rejects(f.worker.inspect(f.record, f.attemptId, abort.signal), { code: "MEDIA_FILE_WORKER_UNAVAILABLE" });
  assert.deepEqual(await fs.readdir(f.root), [".writer.lock"]);
});
test("an I/O error is UNKNOWN, never reported as an absent file", async t => {
  const f = await fixture(t);
  const module = loadMediaModule("media-files", {}, { ...fs, lstat: async () => { throw Object.assign(new Error("Private path and diagnostics"), { code: "EIO" }); } });
  const store = await module.createLocalMediaFileStore(f.root);
  await assert.rejects(store.inspect(f.record, f.attemptId), error => error.code === "MEDIA_FILE_UNAVAILABLE" && error.message === "Media file operation failed" && !error.cause);
  assert.deepEqual(await fs.readdir(f.root), [".writer.lock"]);
});
test("namespace change during observation is UNKNOWN, not reusable absence proof", async t => {
  const f = await fixture(t); let calls = 0;
  const module = loadMediaModule("media-files", {}, { ...fs, lstat: async (leaf, options) => {
    if (++calls === 3) await fs.writeFile(f.final, bytes, { mode: 0o600 });
    return fs.lstat(leaf, options);
  } });
  const store = await module.createLocalMediaFileStore(f.root);
  await assert.rejects(store.inspect(f.record, f.attemptId), { code: "MEDIA_FILE_UNAVAILABLE" });
  assert.deepEqual(await fs.readFile(f.final), bytes);
});
