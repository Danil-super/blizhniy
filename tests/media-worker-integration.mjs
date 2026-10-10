import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import vm from "node:vm";
import sharp from "sharp";
import * as image from "../src/lib/media-image.ts";
import * as protocol from "../src/lib/media-worker-protocol.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const ts = createRequire(import.meta.url)("typescript");
const units = [];
let fault;
const subprocess = { ...childProcess, spawn: (command, args, options) => {
  const unit = args.find(arg => arg.startsWith("--unit="))?.slice(7);
  if (unit) units.push(unit);
  if (fault) {
    args = args.filter(arg => arg !== "--collect").map(arg => arg === path.join(root, "scripts/media-worker.mjs") ? path.join(root, "tests/media-worker-fault.mjs") : arg);
    args.push(fault);
  }
  return childProcess.spawn(command, args, options);
} };
const exports = {};
const imports = { "node:child_process": subprocess, "node:crypto": crypto, "node:path": path, "./media-image": image, "./media-worker-protocol": protocol };
// Transpile the supervisor as Next does; actual child processes and systemd/cgroups are not mocked.
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(root, "src/lib/media-worker.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports, Buffer, Uint8Array, Error, globalThis: {}, setTimeout, clearTimeout,
  process: { ...process, env: { NODE_ENV: "test", NODE_OPTIONS: "--inspect", DATABASE_URL: "synthetic-private" } },
  require: name => { if (!(name in imports)) throw new Error("Unexpected worker import"); return imports[name]; },
});
const worker = exports.createLocalMediaWorker(root);
const photo = () => sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } });
const stopped = unit => {
  const result = childProcess.spawnSync("/usr/bin/systemctl", ["--user", "is-active", unit], { encoding: "utf8", timeout: 2000 });
  assert.notEqual(result.stdout.trim(), "active");
  assert.ok(["inactive", "failed", "unknown"].includes(result.stdout.trim()));
};
const serviceResult = () => childProcess.execFileSync("/usr/bin/systemctl", ["--user", "show", units.at(-1), "--property=Result", "--value"], { encoding: "utf8", timeout: 2000 }).trim();
after(() => {
  for (const unit of units) {
    assert.match(unit, /^blizhniy-media-[0-9a-f-]{36}\.service$/);
    stopped(unit);
    childProcess.spawnSync("/usr/bin/systemctl", ["--user", "reset-failed", unit], { stdio: "ignore", timeout: 2000 });
  }
});
test("actual constrained worker normalizes photos, keeps capacity process-wide and has no live unit afterwards", async () => {
  const input = await photo().withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const first = worker.normalize(input, "image/jpeg");
  await assert.rejects(exports.createLocalMediaWorker(root).normalize(input, "image/jpeg"), { code: "MEDIA_BUSY" });
  const output = await first;
  assert.equal(output.width, 40); assert.equal(output.height, 80);
  const metadata = await sharp(output.bytes).metadata();
  assert.equal(metadata.format, "webp"); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
  stopped(units.at(-1));
});
test("bad pixels are rejected in the worker, and another actual job succeeds afterwards", async () => {
  const input = await photo().png().toBuffer();
  await assert.rejects(worker.normalize(input.subarray(0, Math.floor(input.length / 2)), "image/png"), { code: "INVALID_IMAGE" });
  assert.equal((await worker.normalize(input, "image/png")).width, 80);
  stopped(units.at(-1));
});
test("an actual 24MP photo fits the constrained worker and preserves the output limits", async () => {
  const input = await sharp({ create: { width: 6000, height: 4000, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
  const output = await worker.normalize(input, "image/png");
  assert.equal(output.width, 2048); assert.equal(output.height, 1365);
  assert.ok(output.size <= protocol.MEDIA_MAX_OUTPUT_BYTES);
  stopped(units.at(-1));
});
test("worker environment is clean even when the supervisor has credentials and injected Node options", async () => {
  fault = "environment";
  try { await assert.rejects(worker.normalize(await photo().png().toBuffer(), "image/png"), { code: "INVALID_IMAGE" }); }
  finally { fault = undefined; }
  stopped(units.at(-1));
});
test("native-style crash or oversized output cannot crash the parent or publish a partial image", async () => {
  for (const mode of ["crash", "overflow"]) {
    fault = mode;
    try { await assert.rejects(worker.normalize(await photo().png().toBuffer(), "image/png"), { code: "MEDIA_UNAVAILABLE" }); }
    finally { fault = undefined; }
    stopped(units.at(-1));
    assert.equal((await worker.normalize(await photo().png().toBuffer(), "image/png")).width, 80);
  }
});
test("cgroup OOM terminates only the bounded fault worker and capacity recovers", async () => {
  fault = "memory";
  try { await assert.rejects(worker.normalize(await photo().png().toBuffer(), "image/png"), { code: "MEDIA_UNAVAILABLE" }); }
  finally { fault = undefined; }
  stopped(units.at(-1));
  assert.equal(serviceResult(), "oom-kill");
  assert.equal((await worker.normalize(await photo().png().toBuffer(), "image/png")).width, 80);
});
test("abort stops the actual generated service and releases capacity only after confirmed termination", async () => {
  fault = "hang";
  const abort = new AbortController();
  try {
    const pending = worker.normalize(await photo().png().toBuffer(), "image/png", abort.signal);
    const rejected = assert.rejects(pending, { code: "MEDIA_UNAVAILABLE" });
    let active = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const result = childProcess.spawnSync("/usr/bin/systemctl", ["--user", "is-active", units.at(-1)], { encoding: "utf8", timeout: 2000 });
      if (result.stdout.trim() === "active") { active = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(active);
    abort.abort(); await rejected;
  } finally { fault = undefined; }
  stopped(units.at(-1));
  assert.equal((await worker.normalize(await photo().png().toBuffer(), "image/png")).width, 80);
});
test("external systemd runtime deadline kills an unresponsive worker without a decoder timeout", async () => {
  fault = "hang"; const start = performance.now();
  try { await assert.rejects(worker.normalize(await photo().png().toBuffer(), "image/png"), { code: "MEDIA_UNAVAILABLE" }); }
  finally { fault = undefined; }
  const elapsed = performance.now() - start;
  assert.ok(elapsed >= 7000 && elapsed < 12_000, `runtime ${elapsed}ms`);
  stopped(units.at(-1));
  assert.equal(serviceResult(), "timeout");
  assert.equal((await worker.normalize(await photo().png().toBuffer(), "image/png")).width, 80);
});
