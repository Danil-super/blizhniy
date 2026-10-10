import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileWorkerModule } from "./media-file-worker-module.mjs";
import { encodeFileObservation } from "../src/lib/media-file-inspection-protocol.ts";

const bytes = Buffer.from("524946460400000057454250", "hex");
const metadata = () => ({ id: randomUUID(), mimeType: "image/webp", width: 1, height: 1, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
const fail = promise => assert.rejects(promise, error => error.code === "MEDIA_FILE_WORKER_UNAVAILABLE" && !error.cause);
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "blizhniy-file-supervisor-")), owned = await fs.lstat(root, { bigint: true });
  await fs.writeFile(path.join(root, ".writer.lock"), "", { flag: "wx", mode: 0o600 });
  t.after(async () => {
    const current = await fs.lstat(root, { bigint: true }); assert.equal(current.dev, owned.dev); assert.equal(current.ino, owned.ino);
    assert.equal(current.uid, BigInt(process.getuid())); assert.ok(current.isDirectory()); await fs.rm(root, { recursive: true });
  });
  const timers = new Map(), calls = []; let next = 0, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const child = new EventEmitter(); child.pid = 12345; child.stdin = new PassThrough(); child.stdout = new PassThrough();
  child.kill = signal => { calls.push(signal); return !options.killFails; };
  const input = []; child.stdin.on("data", chunk => input.push(chunk));
  const module = fileWorkerModule({ ...options, childProcess: { spawn: (command, args, settings) => {
    calls.push({ command, args, settings }); if (options.spawnThrows) throw new Error("Private diagnostics"); entered(); return child;
  } }, setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) });
  const worker = await module.createLocalMediaFileWorker("/opt/site", root);
  return { child, timers, calls, started, worker, input, restart: () => module.createLocalMediaFileWorker("/opt/site", root) };
}
test("supervisor keeps capacity and never reports success before actual close", async t => {
  const app = await fixture(t); let resolved = false;
  const first = app.worker.write(metadata(), bytes, randomUUID()).then(() => { resolved = true; }); await app.started;
  const other = await app.restart(); await assert.rejects(other.write(metadata(), bytes, randomUUID()), { code: "MEDIA_FILE_WORKER_BUSY" });
  app.child.stdout.write(Buffer.from([0])); await Promise.resolve(); assert.equal(resolved, false);
  app.child.emit("exit", 0); await Promise.resolve(); assert.equal(resolved, false);
  app.child.emit("close", 0); await first; assert.equal(resolved, true); assert.equal(app.timers.size, 0);
  const call = app.calls[0]; assert.equal(call.command, "/usr/bin/flock"); assert.ok(call.args.includes("--no-fork")); assert.ok(call.args.includes("--nonblock"));
  assert.equal(call.settings.shell, false); assert.equal(call.settings.stdio.length, 5); assert.equal(Buffer.concat(app.input).subarray(0, 4).toString(), "BFW1");
});
test("abort sends SIGKILL once but waits for close; unknown file outcome remains latched", async t => {
  const app = await fixture(t), abort = new AbortController(); let finished = false;
  const pending = app.worker.write(metadata(), bytes, randomUUID(), abort.signal); const failure = fail(pending).then(() => { finished = true; }); await app.started;
  abort.abort(); abort.abort(); await Promise.resolve(); assert.equal(finished, false); assert.equal(app.calls.filter(call => call === "SIGKILL").length, 1);
  await assert.rejects(app.worker.write(metadata(), bytes, randomUUID()), { code: "MEDIA_FILE_WORKER_BUSY" });
  app.child.emit("close", null, "SIGKILL"); await failure; assert.equal(app.timers.size, 0); await fail(app.restart());
});
test("no confirmed close within the stop bound disables future jobs despite a later close", async t => {
  const app = await fixture(t, { killFails: true }); const pending = app.worker.write(metadata(), bytes, randomUUID()); const failure = fail(pending); await app.started;
  [...app.timers.values()].find(timer => timer.ms === 5000).fn();
  [...app.timers.values()].find(timer => timer.ms === 2000).fn(); await failure; assert.equal(app.timers.size, 0);
  app.child.emit("close", 0); await fail(app.restart()); assert.equal(app.calls.filter(call => typeof call === "object").length, 1);
});
test("a reaped PID is never signalled while stdio is still closing", async t => {
  const app = await fixture(t), abort = new AbortController(); const pending = app.worker.write(metadata(), bytes, randomUUID(), abort.signal); const failure = fail(pending); await app.started;
  app.child.emit("exit", 0); abort.abort(); assert.equal(app.calls.includes("SIGKILL"), false);
  app.child.emit("close", 0); await failure;
});
test("malformed or oversized reply stops the only writer and waits for its close", async t => {
  const app = await fixture(t); const pending = app.worker.write(metadata(), bytes, randomUUID()); const failure = fail(pending); await app.started;
  app.child.stdout.write(Buffer.alloc(2)); assert.ok(app.calls.includes("SIGKILL")); app.child.emit("close", null, "SIGKILL"); await failure;
  await fail(app.restart());
});
test("spawn exception is generic and releases capacity without repeating the attempt", async t => {
  const app = await fixture(t, { spawnThrows: true }); await fail(app.worker.write(metadata(), bytes, randomUUID()));
  await fail(app.worker.write(metadata(), bytes, randomUUID())); assert.equal(app.calls.length, 2); assert.equal(app.timers.size, 0);
});
test("browser, non-Linux and unsupported Node cannot spawn even with a private root", async t => {
  for (const options of [{ browser: true }, { process: { platform: "darwin" } }, { process: { versions: { node: "20.20.2" } } }]) {
    await assert.rejects(fixture(t, options), { code: "MEDIA_FILE_WORKER_UNAVAILABLE" });
  }
});
test("inspection shares writer capacity and releases a validated report only after close", async t => {
  const app = await fixture(t), observation = { final: "complete", temporary: "absent", linked: false }; let resolved = false;
  const pending = app.worker.inspect(metadata(), randomUUID()).then(report => { resolved = true; return report; }); await app.started;
  await assert.rejects(app.worker.write(metadata(), bytes, randomUUID()), { code: "MEDIA_FILE_WORKER_BUSY" });
  const frame = encodeFileObservation(observation); app.child.stdout.write(frame.subarray(0, 2)); app.child.stdout.write(frame.subarray(2));
  app.child.emit("exit", 0); await Promise.resolve(); assert.equal(resolved, false);
  app.child.emit("close", 0); assert.deepEqual(await pending, observation); assert.equal(app.timers.size, 0);
  assert.equal(Buffer.concat(app.input).length, 116); assert.equal(app.calls[0].args.at(-1), "inspect");
});
test("exit zero with truncated, invalid or contradictory inspection report is UNKNOWN and latches", async t => {
  for (const frame of [Buffer.from([0]), Buffer.from("BFO1\x04\x00\x00", "binary"), Buffer.from("BFO1\x01\x00\x01", "binary")]) {
    const app = await fixture(t), pending = app.worker.inspect(metadata(), randomUUID()), failure = fail(pending); await app.started;
    app.child.stdout.write(frame); app.child.emit("close", 0); await failure; await fail(app.restart());
  }
});
test("inspection overflow kills once and cannot return partial evidence before close", async t => {
  const app = await fixture(t); let finished = false;
  const failure = fail(app.worker.inspect(metadata(), randomUUID())).then(() => { finished = true; }); await app.started;
  app.child.stdout.write(Buffer.alloc(8)); await Promise.resolve(); assert.equal(finished, false); assert.deepEqual(app.calls.filter(call => call === "SIGKILL"), ["SIGKILL"]);
  app.child.emit("close", null, "SIGKILL"); await failure; await fail(app.restart());
});
