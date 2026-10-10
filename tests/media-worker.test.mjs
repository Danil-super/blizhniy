import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import vm from "node:vm";
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as image from "../src/lib/media-image.ts";
import * as protocol from "../src/lib/media-worker-protocol.ts";

const ts = createRequire(import.meta.url)("typescript");
function fixture(options = {}) {
  const children = [], calls = [], timers = new Map(); let timerId = 0;
  const fakeProcess = { platform: "linux", versions: { node: "22.23.1" }, getuid: () => 1000, execPath: "/opt/node/bin/node", env: { NODE_ENV: "test", DATABASE_URL: "synthetic-private", NODE_OPTIONS: "--inspect" } };
  const control = (command, args, settings, callback) => { calls.push({ command, args, settings }); if (options.stopThrows) throw new Error("private detail"); callback(options.stopFailure ? new Error("private detail") : null); };
  const spawn = (command, args, settings) => {
    calls.push({ command, args, settings });
    if (options.spawnThrows) throw new Error("private detail");
    const child = new EventEmitter(); child.pid = 98765;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = signal => { calls.push({ signal }); return true; };
    const written = []; child.stdin.on("data", chunk => written.push(chunk));
    child.input = () => Buffer.concat(written);
    children.push(child); return child;
  };
  const dependencies = { "node:child_process": { spawn, execFile: control }, "node:crypto": { ...crypto, randomUUID: options.uuidThrows ? () => { throw new Error("private random source detail"); } : crypto.randomUUID }, "node:path": path, "./media-image": image, "./media-worker-protocol": protocol };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/media-worker.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Buffer, Uint8Array, Error, process: fakeProcess, globalThis: options.sharedGlobal ?? {}, ...(options.browser ? { window: {} } : {}),
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    require: name => { if (!(name in dependencies)) throw new Error("Unexpected worker dependency: " + name); return dependencies[name]; },
  });
  return { create: () => exports.createLocalMediaWorker("/opt/site"), process: fakeProcess, calls, children, timers };
}
const source = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const failure = async (promise, code) => assert.rejects(promise, error => error instanceof image.MediaImageError && error.code === code && error.cause === undefined && !error.message.includes("private"));

test("production, unknown mode, browser, non-Linux and unsupported Node cannot start a worker", () => {
  for (const change of [p => p.env.NODE_ENV = "production", p => p.env.NODE_ENV = "", p => p.platform = "darwin", p => p.versions.node = "20.20.2"]) {
    const app = fixture(); change(app.process);
    assert.throws(app.create, { code: "MEDIA_UNAVAILABLE" }); assert.equal(app.calls.length, 0);
  }
  assert.throws(fixture({ browser: true }).create, { code: "MEDIA_UNAVAILABLE" });
});
test("parent validates bytes, MIME and abort before invoking an executable", async () => {
  const app = fixture(); const worker = app.create();
  for (const value of ["/etc/passwd", "https://localhost/image", null, Buffer.alloc(0)]) await failure(worker.normalize(value, "image/png"), "INVALID_IMAGE");
  await failure(worker.normalize(Buffer.alloc(10 * 1024 * 1024 + 1), "image/png"), "IMAGE_TOO_LARGE");
  await failure(worker.normalize(source, "image/svg+xml"), "UNSUPPORTED_IMAGE");
  const abort = new AbortController(); abort.abort();
  await failure(worker.normalize(source, "image/png", abort.signal), "MEDIA_UNAVAILABLE");
  assert.equal(app.calls.length, 0);
});
test("worker command has fixed system limits, no shell, and never inherits credentials or Node options", async () => {
  const app = fixture(); const pending = app.create().normalize(source, "image/png");
  const [call] = app.calls;
  assert.equal(call.command, "/usr/bin/systemd-run"); assert.equal(call.settings.shell, false);
  for (const setting of ["MemoryMax=512M", "MemorySwapMax=0", "CPUQuota=100%", "TasksMax=32", "RuntimeMaxSec=8s", "KillMode=control-group", "KillSignal=SIGKILL", "NoNewPrivileges=yes", "LimitCORE=0"]) assert.ok(call.args.includes("--property=" + setting));
  assert.ok(call.args.includes("--expand-environment=no")); assert.ok(call.args.includes("/usr/bin/env")); assert.ok(call.args.includes("-i"));
  assert.equal(call.settings.env.NODE_OPTIONS, undefined); assert.equal(call.settings.env.DATABASE_URL, undefined);
  assert.equal(call.args.some(arg => arg.includes("synthetic-private") || arg.includes("--inspect")), false);
  assert.equal(app.children[0].input()[0], 1); assert.deepEqual(app.children[0].input().subarray(1), source);
  app.children[0].stdout.write(protocol.encodeMediaFailure("INVALID_IMAGE")); app.children[0].emit("close", 0, null);
  await failure(pending, "INVALID_IMAGE"); assert.equal(app.timers.size, 0);
});
test("the input is copied synchronously and a fragmented error reply is accepted only after close", async () => {
  const app = fixture(); const bytes = Buffer.from(source);
  const pending = app.create().normalize(bytes, "image/png"); bytes.fill(0);
  assert.deepEqual(app.children[0].input().subarray(1), source);
  const header = protocol.encodeMediaFailure("INVALID_IMAGE");
  app.children[0].stdout.write(header.subarray(0, 3)); app.children[0].stdout.write(header.subarray(3));
  await failure(app.create().normalize(source, "image/png"), "MEDIA_BUSY");
  app.children[0].emit("close", 0, null); await failure(pending, "INVALID_IMAGE");
});
test("distinct supervisors in the same process share capacity until the child closes, then allow another job", async () => {
  const sharedGlobal = {};
  const app = fixture({ sharedGlobal }); const first = app.create().normalize(source, "image/png");
  await failure(fixture({ sharedGlobal }).create().normalize(source, "image/png"), "MEDIA_BUSY");
  assert.equal(app.children.length, 1);
  app.children[0].emit("close", 1, null); await failure(first, "MEDIA_UNAVAILABLE");
  const next = app.create().normalize(source, "image/png");
  app.children[1].stdout.write(protocol.encodeMediaFailure("UNSUPPORTED_IMAGE")); app.children[1].emit("close", 0, null);
  await failure(next, "UNSUPPORTED_IMAGE");
});
test("a synchronous control failure is generic and latches closed instead of escaping the abort callback", async () => {
  const app = fixture({ stopThrows: true }); const abort = new AbortController();
  const pending = app.create().normalize(source, "image/png", abort.signal);
  abort.abort();
  await failure(pending, "MEDIA_UNAVAILABLE");
  await failure(app.create().normalize(source, "image/png"), "MEDIA_UNAVAILABLE");
});
test("deadline stops only the generated unit, and never trusts an incomplete reply", async () => {
  const app = fixture(); const pending = app.create().normalize(source, "image/png");
  const timer = [...app.timers.values()][0]; assert.equal(timer.ms, 10_000); timer.fn();
  await failure(pending, "MEDIA_UNAVAILABLE");
  const stop = app.calls.find(call => call.command === "/usr/bin/systemctl");
  assert.ok(stop.args.includes("stop")); assert.match(stop.args.at(-1), /^blizhniy-media-[0-9a-f-]{36}\.service$/);
  assert.ok(app.calls.some(call => call.signal === "SIGKILL")); assert.equal(app.timers.size, 0);
});
test("abort and oversized stdout stop the worker; failed termination latches the supervisor closed", async () => {
  for (const mode of ["abort", "overflow"]) {
    const app = fixture({ stopFailure: true }); const worker = app.create(); const abort = new AbortController();
    const pending = worker.normalize(source, "image/png", abort.signal);
    if (mode === "abort") abort.abort(); else app.children[0].stdout.write(Buffer.alloc(protocol.MEDIA_REPLY_HEADER_BYTES + protocol.MEDIA_MAX_OUTPUT_BYTES + 1));
    await failure(pending, "MEDIA_UNAVAILABLE");
    await failure(app.create().normalize(source, "image/png"), "MEDIA_UNAVAILABLE");
    assert.equal(app.children.length, 1);
    app.children[0].emit("close", 0, null); // A late event cannot reopen capacity.
    await failure(worker.normalize(source, "image/png"), "MEDIA_UNAVAILABLE");
  }
});
test("excessively fragmented stdout cannot create an unbounded array of tiny buffers", async () => {
  const app = fixture(); const pending = app.create().normalize(source, "image/png");
  for (let count = 0; count < 257; count++) app.children[0].stdout.write(Buffer.from([0]));
  await failure(pending, "MEDIA_UNAVAILABLE");
  assert.ok(app.calls.some(call => call.command === "/usr/bin/systemctl"));
});
test("spawn errors and malformed successful replies stay generic and release capacity", async () => {
  const broken = fixture({ spawnThrows: true }); await failure(broken.create().normalize(source, "image/png"), "MEDIA_UNAVAILABLE");
  const app = fixture(); const pending = app.create().normalize(source, "image/png");
  app.children[0].stdout.write(Buffer.from("private detail")); app.children[0].emit("close", 0, null);
  await failure(pending, "MEDIA_UNAVAILABLE");
  const next = app.create().normalize(source, "image/png"); app.children[1].emit("close", 1, null); await failure(next, "MEDIA_UNAVAILABLE");
});
test("an identifier-generation failure is generic and does not leave capacity permanently busy", async () => {
  const app = fixture({ uuidThrows: true }); const worker = app.create();
  await failure(worker.normalize(source, "image/png"), "MEDIA_UNAVAILABLE");
  await failure(worker.normalize(source, "image/png"), "MEDIA_UNAVAILABLE");
  assert.equal(app.calls.length, 0);
});
