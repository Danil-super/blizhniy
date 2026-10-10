import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import sharp from "sharp";
import * as protocol from "../src/lib/media-worker-protocol.ts";

const require = createRequire(import.meta.url), ts = require("typescript");
function module(overrides = {}) {
  const exports = {};
  const dependencies = { "node:fs": { constants }, "node:fs/promises": { ...fs, ...overrides.fs }, "node:crypto": { randomUUID, ...overrides.crypto }, "node:path": path, "./media-worker-protocol": protocol };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/media-files.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Buffer, Uint8Array, Error, process: { platform: "linux", getuid: process.getuid, env: { NODE_ENV: "test" }, ...overrides.process },
    ...(overrides.browser ? { window: {} } : {}), require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return exports;
}
async function fixture(t, overrides) {
  const base = await fs.mkdtemp(path.join(tmpdir(), "blizhniy-media-files-"));
  const owned = await fs.lstat(base, { bigint: true });
  const root = path.join(base, "objects"); await fs.mkdir(root, { mode: 0o700 });
  t.after(async () => {
    const current = await fs.lstat(base, { bigint: true });
    assert.equal(current.dev, owned.dev); assert.equal(current.ino, owned.ino); assert.equal(current.uid, BigInt(process.getuid()));
    assert.ok(current.isDirectory()); assert.ok(path.basename(base).startsWith("blizhniy-media-files-"));
    await fs.rm(base, { recursive: true });
  });
  return { base, root, store: await module(overrides).createLocalMediaFileStore(root) };
}
const bytes = await sharp({ create: { width: 16, height: 9, channels: 3, background: "#619a77" } }).webp().toBuffer();
const record = () => ({ id: randomUUID(), mimeType: "image/webp", width: 16, height: 9, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
const failure = (promise, code = "MEDIA_FILE_UNAVAILABLE") => assert.rejects(promise, error => error.name === "MediaFileError" && error.code === code && error.message === "Media file operation failed" && !error.cause);

test("private files persist across store restart with exact bytes and mode, without recording metadata on disk", async t => {
  const { root, store } = await fixture(t), metadata = record();
  await store.write(metadata, bytes);
  assert.deepEqual(await fs.readdir(root), [metadata.id + ".webp"]);
  const info = await fs.lstat(path.join(root, metadata.id + ".webp"));
  assert.equal(info.mode & 0o7777, 0o600); assert.equal(info.nlink, 1);
  const restarted = await module().createLocalMediaFileStore(root);
  assert.deepEqual(await restarted.read(metadata), bytes);
  assert.deepEqual(Object.keys(restarted).sort(), ["read", "write"]);
});
test("competing writes publish one complete object and never overwrite a prior object", async t => {
  const { root, store } = await fixture(t), metadata = record();
  const results = await Promise.allSettled([store.write(metadata, bytes), store.write(metadata, bytes)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected"); assert.equal(rejected.reason.code, "MEDIA_FILE_EXISTS");
  await failure(store.write(metadata, bytes), "MEDIA_FILE_EXISTS");
  assert.deepEqual(await store.read(metadata), bytes); assert.deepEqual(await fs.readdir(root), [metadata.id + ".webp"]);
});
test("record paths, MIME, dimensions, size and digest are rejected before any object is created", async t => {
  const { root, store } = await fixture(t);
  const mutations = [{ id: "../outside" }, { id: "/etc/passwd" }, { id: "00000000-0000-0000-0000-000000000000" }, { id: record().id.toUpperCase() },
    { mimeType: "image/jpeg" }, { width: 0 }, { width: 2049 }, { height: 1.5 }, { size: 0 }, { size: 2097153 }, { size: bytes.length + 1 }, { sha256: "0".repeat(64) }, { sha256: "a" }, { sha256: record().sha256.toUpperCase() }];
  for (const mutation of mutations) await failure(store.write({ ...record(), ...mutation }, bytes), "INVALID_MEDIA_FILE");
  await failure(store.write(record(), new Uint8Array(2097153)), "INVALID_MEDIA_FILE");
  await failure(store.write(record(), "not bytes"), "INVALID_MEDIA_FILE");
  await failure(store.write(record(), Buffer.alloc(bytes.length)), "INVALID_MEDIA_FILE");
  assert.deepEqual(await fs.readdir(root), []);
});
test("mutable input bytes and metadata are snapshotted before the first await", async t => {
  const { store } = await fixture(t), metadata = record(), original = { ...metadata }, input = Buffer.from(bytes);
  const pending = store.write(metadata, input); input.fill(0); metadata.id = randomUUID(); metadata.sha256 = "0".repeat(64);
  await pending; const read = store.read(original); original.id = randomUUID(); original.size = 1;
  assert.deepEqual(await read, bytes);
});
test("symlink and hardlink objects are refused, and conflicting destinations remain untouched", async t => {
  const { base, root, store } = await fixture(t), metadata = record(), outside = path.join(base, "outside");
  await fs.writeFile(outside, bytes, { mode: 0o600 });
  const destination = path.join(root, metadata.id + ".webp"); await fs.symlink(outside, destination);
  await failure(store.read(metadata)); await failure(store.write(metadata, bytes), "MEDIA_FILE_EXISTS");
  assert.ok((await fs.lstat(destination)).isSymbolicLink()); assert.deepEqual(await fs.readFile(outside), bytes);
  await fs.unlink(destination); await fs.link(outside, destination);
  await failure(store.read(metadata)); assert.equal((await fs.lstat(outside)).nlink, 2);
});
test("directories, FIFO and public mode are refused without blocking or returning their content", async t => {
  const { root, store } = await fixture(t), metadata = record(), destination = path.join(root, metadata.id + ".webp");
  await fs.mkdir(destination); await failure(store.read(metadata)); await fs.rmdir(destination);
  const { execFileSync } = await import("node:child_process"); execFileSync("/usr/bin/mkfifo", ["--", destination]);
  await failure(store.read(metadata)); await fs.unlink(destination);
  await fs.writeFile(destination, bytes, { mode: 0o644 }); await failure(store.read(metadata));
});
test("missing, truncated, larger and same-size corrupted files never produce unchecked bytes", async t => {
  const { root, store } = await fixture(t), metadata = record(), destination = path.join(root, metadata.id + ".webp");
  await failure(store.read(metadata));
  for (const content of [bytes.subarray(0, bytes.length - 1), Buffer.concat([bytes, Buffer.from([0])]), Buffer.alloc(bytes.length)]) {
    await fs.writeFile(destination, content, { mode: 0o600 }); await failure(store.read(metadata));
  }
  await fs.writeFile(destination, bytes, { mode: 0o600 });
  await failure(store.read({ ...metadata, sha256: "0".repeat(64) }));
});
test("root must already exist, be canonical, private and owned; root replacement fails closed", async t => {
  const { base, root, store } = await fixture(t), api = module();
  for (const invalid of ["/", ".", root + "/..", path.join(base, "missing")]) await failure(api.createLocalMediaFileStore(invalid));
  await fs.chmod(root, 0o750); await failure(api.createLocalMediaFileStore(root)); await failure(store.write(record(), bytes)); await fs.chmod(root, 0o700);
  const alias = path.join(base, "alias"); await fs.symlink(root, alias); await failure(api.createLocalMediaFileStore(alias));
  await fs.mkdir(path.join(root, "child"), { mode: 0o700 });
  await failure(api.createLocalMediaFileStore(alias + "/child"));
  await failure(module({ process: { getuid: () => process.getuid() + 1 } }).createLocalMediaFileStore(root));
  await fs.rename(root, path.join(base, "old")); await fs.mkdir(root, { mode: 0o700 });
  await failure(store.write(record(), bytes)); assert.deepEqual(await fs.readdir(root), []);
});
test("browser, non-Linux and production cannot enable the local file store", async t => {
  const { root } = await fixture(t);
  for (const overrides of [{ browser: true }, { process: { platform: "win32" } }, { process: { env: { NODE_ENV: "production" } } }, { process: { env: {} } }]) {
    await failure(module(overrides).createLocalMediaFileStore(root));
  }
});

function wrapHandle(handle, changes) {
  return new Proxy(handle, { get(target, property) {
    if (property in changes) return changes[property];
    const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } });
}
const diskError = () => Object.assign(new Error("private disk path and diagnostic"), { code: "ENOSPC" });
test("partial write and sync failures remove only their own temporary and leave no destination", async t => {
  for (const stage of ["writeFile", "sync"]) {
    const { root, store } = await fixture(t, { fs: { open: async (...args) => {
      const handle = await fs.open(...args);
      if (!(args[1] & constants.O_WRONLY)) return handle;
      return wrapHandle(handle, { [stage]: async content => {
        if (stage === "writeFile") await handle.writeFile(content.subarray(0, 5));
        throw diskError();
      } });
    } } });
    await failure(store.write(record(), bytes)); assert.deepEqual(await fs.readdir(root), []);
    // A fully cleaned pre-publication failure does not poison subsequent attempts.
    await failure(store.write(record(), bytes)); assert.deepEqual(await fs.readdir(root), []);
  }
});
test("failure to prove the created temporary inode disables subsequent writes without deleting an unproven file", async t => {
  const { root, store } = await fixture(t, { fs: { open: async (...args) => {
    const handle = await fs.open(...args);
    return args[1] & constants.O_WRONLY ? wrapHandle(handle, { stat: async () => { throw diskError(); } }) : handle;
  } } });
  await failure(store.write(record(), bytes)); assert.equal((await fs.readdir(root)).length, 1);
  await failure(store.write(record(), bytes)); assert.equal((await fs.readdir(root)).length, 1);
});
test("failed cleanup is generic and disables the instance rather than accumulating unlimited temporary files", async t => {
  const { root, store } = await fixture(t, { fs: { unlink: async () => { throw diskError(); } } });
  const metadata = record(); await failure(store.write(metadata, bytes));
  const remaining = await fs.readdir(root); assert.equal(remaining.length, 2); assert.ok(remaining.includes(metadata.id + ".webp"));
  await failure(store.write(record(), bytes)); assert.deepEqual(await fs.readdir(root), remaining);
});
test("a post-publication directory-sync error keeps the complete object, reports unknown and disables the instance", async t => {
  const { root, store } = await fixture(t, { fs: { open: async (...args) => {
    const handle = await fs.open(...args);
    return args[1] & constants.O_DIRECTORY ? wrapHandle(handle, { sync: async () => { throw diskError(); } }) : handle;
  } } });
  const metadata = record(); await failure(store.write(metadata, bytes));
  assert.deepEqual(await fs.readdir(root), [metadata.id + ".webp"]);
  await failure(store.write(record(), bytes));
  assert.deepEqual(await (await module().createLocalMediaFileStore(root)).read(metadata), bytes);
});
test("growing content after fstat is read with a strict byte bound and then refused", async t => {
  let maximumRead = 0;
  const { root, store } = await fixture(t, { fs: { open: async (...args) => {
    const handle = await fs.open(...args);
    if (args[1] & constants.O_DIRECTORY || args[1] & constants.O_WRONLY) return handle;
    let enlarged = false;
    return wrapHandle(handle, { read: async (buffer, offset, length, position) => {
      maximumRead += length;
      if (!enlarged) { enlarged = true; await fs.appendFile(args[0], Buffer.alloc(3 * 1024 * 1024)); }
      return handle.read(buffer, offset, length, position);
    } });
  } } });
  const metadata = record(); await store.write(metadata, bytes); await failure(store.read(metadata));
  assert.equal(maximumRead, bytes.length + 1); assert.equal((await fs.readdir(root)).length, 1);
});
test("file/ancestor symlink substitution during an operation does not redirect reads through the pinned root", async t => {
  const { base, root, store } = await fixture(t), metadata = record(); await store.write(metadata, bytes);
  const replacement = path.join(base, "replacement"); await fs.mkdir(replacement, { mode: 0o700 });
  await fs.writeFile(path.join(replacement, metadata.id + ".webp"), Buffer.alloc(bytes.length), { mode: 0o600 });
  let changed = false;
  const api = module({ fs: { realpath: async candidate => {
    const actual = await fs.realpath(candidate);
    if (!changed) return actual;
    await fs.rename(root, path.join(base, "moved")); await fs.symlink(replacement, root); changed = false;
    return actual;
  } } });
  const pinned = await api.createLocalMediaFileStore(root); changed = true;
  assert.deepEqual(await pinned.read(metadata), bytes);
  await failure(pinned.read(metadata));
});
test("partial bytes are never visible under the final name, which is linked only after file sync", async t => {
  let release, started, synced = false;
  const held = new Promise(resolve => { release = resolve; }), writing = new Promise(resolve => { started = resolve; });
  const { root, store } = await fixture(t, { fs: {
    open: async (...args) => {
      const handle = await fs.open(...args);
      return args[1] & constants.O_WRONLY ? wrapHandle(handle, {
        writeFile: async content => { await handle.write(content.subarray(0, 5), 0, 5, 0); started(); await held; await handle.writeFile(content); },
        sync: async () => { await handle.sync(); synced = true; },
      }) : handle;
    },
    link: async (temporary, destination) => { assert.ok(synced); assert.deepEqual(await fs.readFile(temporary), bytes); await fs.link(temporary, destination); },
  } });
  const metadata = record(), pending = store.write(metadata, bytes);
  try {
    await writing; const entries = await fs.readdir(root);
    assert.equal(entries.length, 1); assert.ok(entries[0].startsWith(".pending-"));
    await assert.rejects(fs.lstat(path.join(root, metadata.id + ".webp")), { code: "ENOENT" });
  } finally { release(); }
  await pending; assert.deepEqual(await store.read(metadata), bytes);
});
test("temporary name collision never truncates or deletes the existing file", async t => {
  const uuid = randomUUID();
  const { root, store } = await fixture(t, { crypto: { randomUUID: () => uuid } });
  const existing = path.join(root, ".pending-" + uuid); await fs.writeFile(existing, "unrelated", { mode: 0o600 });
  await failure(store.write(record(), bytes)); assert.equal(await fs.readFile(existing, "utf8"), "unrelated");
  assert.deepEqual(await fs.readdir(root), [".pending-" + uuid]);
});
test("temporary inode replacement refuses cleanup and preserves the foreign replacement", async t => {
  let temporaryPath;
  const { root, store } = await fixture(t, { fs: { link: async (temporary, destination) => {
    await fs.link(temporary, destination); await fs.unlink(temporary);
    await fs.writeFile(temporary, "unrelated replacement", { mode: 0o600 }); temporaryPath = temporary;
  } } });
  const metadata = record(); await failure(store.write(metadata, bytes));
  const pendingName = path.basename(temporaryPath);
  assert.equal(await fs.readFile(path.join(root, pendingName), "utf8"), "unrelated replacement");
  assert.deepEqual(await fs.readFile(path.join(root, metadata.id + ".webp")), bytes);
  await failure(store.write(record(), bytes)); assert.equal((await fs.readdir(root)).length, 2);
});
