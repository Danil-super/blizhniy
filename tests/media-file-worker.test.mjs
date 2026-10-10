import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fileWorkerModule } from "./media-file-worker-module.mjs";
import { encodeFileInspection } from "../src/lib/media-file-inspection-protocol.ts";

const { createLocalMediaFileWorker } = await import("../src/lib/media-file-worker.ts");
const { createLocalMediaFileStore } = await import("../src/lib/media-files.ts");
process.env.NODE_ENV = "test";
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const bytes = Buffer.from("524946460400000057454250", "hex");
const record = () => ({ id: randomUUID(), mimeType: "image/webp", width: 1, height: 1, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
const failure = (promise, code = "MEDIA_FILE_WORKER_UNAVAILABLE") => assert.rejects(promise, error => error.code === code && error.message === "Media file worker failed" && !error.cause);
async function fixture(t, provision = true) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "blizhniy-file-fence-")), owned = await fs.lstat(root, { bigint: true });
  if (provision) await fs.writeFile(path.join(root, ".writer.lock"), "", { flag: "wx", mode: 0o600 });
  t.after(async () => {
    const current = await fs.lstat(root, { bigint: true });
    assert.equal(current.dev, owned.dev); assert.equal(current.ino, owned.ino); assert.equal(current.uid, BigInt(process.getuid()));
    assert.ok(current.isDirectory()); assert.ok(path.basename(root).startsWith("blizhniy-file-fence-"));
    await fs.rm(root, { recursive: true });
  });
  return { root, worker: provision ? await createLocalMediaFileWorker(appRoot, root) : null };
}
test("actual no-fork writer publishes privately, then exits and releases the OS lock", async t => {
  const { root, worker } = await fixture(t), metadata = record(), attempt = randomUUID();
  await worker.write(metadata, bytes, attempt);
  assert.deepEqual(await (await createLocalMediaFileStore(root)).read(metadata), bytes);
  assert.deepEqual((await fs.readdir(root)).sort(), [".writer.lock", metadata.id + ".webp"].sort());
  const next = await createLocalMediaFileWorker(appRoot, root); await next.write(record(), bytes, randomUUID());
});
test("a separate live process holds the same inode lock: conflict starts no FS and is not queued", async t => {
  const { root, worker } = await fixture(t), metadata = record();
  const child = spawn("/usr/bin/flock", ["--no-fork", "--exclusive", "--nonblock", path.join(root, ".writer.lock"), process.execPath, "-e", 'process.stdout.write("locked");setInterval(()=>{},1000)'], { env: {}, stdio: ["ignore", "pipe", "ignore"] });
  const ended = new Promise(resolve => child.once("close", resolve));
  const guard = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 8000);
  try {
    await new Promise((resolve, reject) => { child.stdout.once("data", chunk => chunk.toString() === "locked" ? resolve() : reject(new Error("Unexpected fixture reply"))); child.once("error", reject); child.once("close", () => reject(new Error("Lock holder closed"))); });
    await failure(worker.write(metadata, bytes, randomUUID()), "MEDIA_FILE_WORKER_BUSY");
    await failure(worker.inspect(metadata, randomUUID()), "MEDIA_FILE_WORKER_BUSY");
    assert.deepEqual(await fs.readdir(root), [".writer.lock"]);
  } finally { clearTimeout(guard); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await ended; }
  await worker.write(metadata, bytes, randomUUID());
});
test("pre-provisioning and inode evidence are mandatory; factory never creates a lock", async t => {
  const { root } = await fixture(t, false);
  await failure(createLocalMediaFileWorker(appRoot, root)); assert.deepEqual(await fs.readdir(root), []);
  for (const setup of [async () => fs.symlink("missing", path.join(root, ".writer.lock")), async () => fs.mkdir(path.join(root, ".writer.lock")), async () => fs.writeFile(path.join(root, ".writer.lock"), "", { mode: 0o644 })]) {
    await setup(); await failure(createLocalMediaFileWorker(appRoot, root)); await fs.rm(path.join(root, ".writer.lock"), { recursive: true });
  }
  await fs.writeFile(path.join(root, "foreign-lock"), "", { flag: "wx", mode: 0o600 });
  await fs.link(path.join(root, "foreign-lock"), path.join(root, ".writer.lock"));
  await failure(createLocalMediaFileWorker(appRoot, root));
  assert.equal((await fs.lstat(path.join(root, "foreign-lock"))).nlink, 2);
});
test("replacement of a proven lock inode refuses I/O instead of splitting the fence", async t => {
  const { root, worker } = await fixture(t);
  await fs.rename(path.join(root, ".writer.lock"), path.join(root, "previous-lock"));
  await fs.writeFile(path.join(root, ".writer.lock"), "", { flag: "wx", mode: 0o600 });
  await failure(worker.write(record(), bytes, randomUUID()));
  await failure(worker.inspect(record(), randomUUID()));
  assert.deepEqual((await fs.readdir(root)).sort(), [".writer.lock", "previous-lock"]);
});
test("invalid input and pre-aborted jobs cannot create files", async t => {
  const { root, worker } = await fixture(t), abort = new AbortController(); abort.abort();
  await failure(worker.write({ ...record(), id: "../outside" }, bytes, randomUUID()), "INVALID_MEDIA_FILE_WRITE");
  await failure(worker.write(record(), bytes, randomUUID(), abort.signal));
  assert.deepEqual(await fs.readdir(root), [".writer.lock"]);
});
test("production mode cannot start the file worker", async t => {
  const { root } = await fixture(t); process.env.NODE_ENV = "production";
  try { await failure(createLocalMediaFileWorker(appRoot, root)); } finally { process.env.NODE_ENV = "test"; }
});
test("actual cancelled partial writer is dead before rejection and leaves its attempt leaf untouched", async t => {
  const { root } = await fixture(t), attempt = randomUUID(), metadata = record(), abort = new AbortController(); let child, closed = false;
  const module = fileWorkerModule({ childProcess: { spawn: (command, args, options) => {
    assert.equal(command, "/usr/bin/flock"); assert.ok(args.includes("--no-fork")); assert.equal(options.shell, false);
    assert.deepEqual(Object.keys(options.env).sort(), ["LANG", "NODE_ENV", "UV_THREADPOOL_SIZE"]);
    const actualArgs = Array.from(args, arg => arg === path.join(appRoot, "scripts/media-file-worker.mjs") ? path.join(appRoot, "tests/media-file-worker-fault.mjs") : arg);
    child = spawn(command, actualArgs, options); child.once("close", () => { closed = true; }); return child;
  } } });
  const worker = await module.createLocalMediaFileWorker(appRoot, root);
  const pending = worker.write(metadata, bytes, attempt, abort.signal); const rejected = failure(pending);
  const deadline = Date.now() + 4000; let partial;
  try {
    while (Date.now() < deadline && !closed) {
      partial = await fs.lstat(path.join(root, `.pending-${attempt}`), { bigint: true }).catch(() => null);
      if (partial?.size === BigInt(12)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(partial?.size === BigInt(12), "Own child reached the actual partial write");
    abort.abort(); await rejected; assert.equal(closed, true); assert.equal(child.signalCode, "SIGKILL");
    const after = await fs.lstat(path.join(root, `.pending-${attempt}`), { bigint: true });
    assert.equal(after.dev, partial.dev); assert.equal(after.ino, partial.ino); assert.equal(after.size, BigInt(12));
    assert.equal(after.mode & BigInt(0o7777), BigInt(0o600));
    await assert.rejects(fs.stat(path.join(root, metadata.id + ".webp")), { code: "ENOENT" });
    await failure(worker.write(record(), bytes, randomUUID())); // Unknown write latches the parent.
    // A fresh supervisor can take the same OS lock for a DIFFERENT attempt, not resume the old one.
    await (await createLocalMediaFileWorker(appRoot, root)).write(record(), bytes, randomUUID());
  } finally {
    abort.abort(); if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await rejected;
  }
});
test("parent SIGKILL cannot release the OS lock while its separate partial writer remains alive", async t => {
  const { root, worker } = await fixture(t), attempt = randomUUID(), metadata = record();
  const { encodeFileWrite } = await import("../src/lib/media-file-protocol.ts");
  const parent = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(appRoot, "tests/media-file-orphan-fixture.mjs"), appRoot, root], {
    env: { NODE_ENV: "test" }, stdio: ["pipe", "ignore", "ignore"],
  });
  const ended = new Promise((resolve, reject) => { parent.once("error", reject); parent.once("close", (code, signal) => resolve({ code, signal })); });
  parent.stdin.on("error", () => {}); parent.stdin.end(encodeFileWrite(metadata, bytes, attempt));
  try {
    const deadline = Date.now() + 4000; let partial;
    while (Date.now() < deadline && parent.exitCode === null && parent.signalCode === null) {
      partial = await fs.stat(path.join(root, `.pending-${attempt}`)).catch(() => null); if (partial?.size === 12) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(partial?.size, 12); parent.kill("SIGKILL"); assert.equal((await ended).signal, "SIGKILL");
    await failure(worker.write(record(), bytes, randomUUID()), "MEDIA_FILE_WORKER_BUSY");
    // Test child has its own bounded deadline. Poll only the pinned fence, not PID liveness.
    const stopLimit = Date.now() + 8000; let released = false;
    while (Date.now() < stopLimit) {
      try { await worker.write(record(), bytes, randomUUID()); released = true; break; }
      catch (error) { assert.equal(error.code, "MEDIA_FILE_WORKER_BUSY"); }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(released, true); assert.equal((await fs.stat(path.join(root, `.pending-${attempt}`))).ino, partial.ino);
  } finally { if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL"); await ended; }
});
test("invoking the entry without its kernel lock cannot perform file effects", async t => {
  const { root } = await fixture(t), metadata = record();
  const { encodeFileWrite } = await import("../src/lib/media-file-protocol.ts");
  const lock = await fs.open(path.join(root, ".writer.lock"), "r"), directory = await fs.open(root, "r");
  try {
    for (const mode of ["write", "inspect", "observe"]) {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(appRoot, "scripts/media-file-worker.mjs"), root, mode], {
        env: { NODE_ENV: "test" }, stdio: ["pipe", "pipe", "ignore", lock.fd, directory.fd],
      });
      const chunks = []; child.stdout.on("data", chunk => chunks.push(chunk)); child.stdin.on("error", () => {});
      const finished = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      child.stdin.end(mode === "write" ? encodeFileWrite(metadata, bytes, randomUUID()) : encodeFileInspection(metadata, randomUUID())); assert.equal(await finished, 1);
      assert.deepEqual(Buffer.concat(chunks), Buffer.from([1])); assert.deepEqual(await fs.readdir(root), [".writer.lock"]);
    }
  } finally { await lock.close(); await directory.close(); }
});
test("root replacement cannot redirect an already configured writer", async t => {
  const { root, worker } = await fixture(t);
  // Move the original owned inode into a second, fixture-owned parent for final cleanup.
  const parent = await fs.mkdtemp(path.join(tmpdir(), "blizhniy-fence-root-parent-")), parentProof = await fs.lstat(parent, { bigint: true });
  try {
    await fs.rename(root, path.join(parent, "original")); await fs.mkdir(root, { mode: 0o700 });
    await fs.writeFile(path.join(root, ".writer.lock"), "", { flag: "wx", mode: 0o600 });
    await failure(worker.write(record(), bytes, randomUUID())); assert.deepEqual(await fs.readdir(root), [".writer.lock"]);
  } finally {
    await fs.unlink(path.join(root, ".writer.lock")); await fs.rmdir(root); await fs.rename(path.join(parent, "original"), root);
    const current = await fs.lstat(parent, { bigint: true }); assert.equal(current.dev, parentProof.dev); assert.equal(current.ino, parentProof.ino); await fs.rmdir(parent);
  }
});
