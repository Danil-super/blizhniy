import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

async function fixture(states = ["idle"], changes = {}) {
  const { runAuthMailWorker } = await import("../scripts/auth-mail-worker-runtime.mjs");
  const calls = { created: 0, recover: 0, prune: 0, verify: 0, run: 0, close: 0, events: [] };
  const runtime = {
    worker: { recoverAbandoned: async limit => { assert.equal(limit, 100); calls.recover++; return 2; },
      runOne: async () => { calls.run++; return { state: states[calls.run-1] ?? "idle", id: "must-not-be-logged" }; } },
    prune: async () => { calls.prune++; return 4; },
    mailer: { verify: async () => { calls.verify++; }, send: async () => assert.fail("runner must delegate sending to the durable worker") },
    close: async () => { calls.close++; }, ...changes,
  };
  const run = options => runAuthMailWorker({ mode: "run", createRuntime: async () => { calls.created++; return runtime; },
    report: event => calls.events.push(event), ...options });
  return { run, calls, runtime };
}
test("operator check verifies connectivity without claiming, sending or deleting jobs and closes the pool", async () => {
  const f = await fixture();
  assert.equal(await f.run({ mode: "check" }), 0);
  assert.equal(f.calls.verify, 1); assert.equal(f.calls.close, 1);
  assert.equal(f.calls.run, 0); assert.equal(f.calls.recover, 0); assert.equal(f.calls.prune, 0);
  assert.equal(f.calls.events[0].status, "complete");
  assert.equal(f.calls.events[0].entryPoint, "cli");
});
test("batch is capped at three attempts, cleans bounded expired work and reports state counts without identifiers", async () => {
  const f = await fixture(["accepted", "unknown", "ready", "accepted"]);
  assert.equal(await f.run({ entryPoint: "systemd" }), 0);
  assert.equal(f.calls.run, 3); assert.equal(f.calls.recover, 1); assert.equal(f.calls.prune, 1); assert.equal(f.calls.close, 1);
  assert.deepEqual(f.calls.events[0].outcomes, { accepted: 1, unknown: 1, ready: 1 });
  assert.equal(f.calls.events[0].recovered, 2); assert.equal(f.calls.events[0].pruned, 4);
  assert.equal(JSON.stringify(f.calls.events).includes("must-not-be-logged"), false);
  assert.equal(f.calls.events[0].entryPoint, "systemd");
});
test("idle stops immediately; SIGTERM-style cancellation drains the current attempt without claiming another", async () => {
  const idle = await fixture(); assert.equal(await idle.run(), 0); assert.equal(idle.calls.run, 1);
  const controller = new AbortController();
  const f = await fixture();
  f.runtime.worker.runOne = async () => { f.calls.run++; controller.abort(); return { state: "unknown" }; };
  assert.equal(await f.run({ signal: controller.signal }), 0);
  assert.equal(f.calls.run, 1); assert.equal(f.calls.close, 1); assert.equal(f.calls.events[0].status, "stopped");
  const stopped = await fixture();
  assert.equal(await stopped.run({ signal: controller.signal }), 0); assert.equal(stopped.calls.created, 0);
});
test("invalid mode, startup/cleanup/SMTP/finish/close failures fail closed and discard raw secret-bearing errors", async () => {
  const error = new Error("synthetic password token recipient@example.invalid");
  const invalid = await fixture(); assert.equal(await invalid.run({ mode: "anything" }), 1); assert.equal(invalid.calls.created, 0);
  assert.equal(await invalid.run({ entryPoint: "synthetic-hidden-entry" }), 1); assert.equal(invalid.calls.created, 0);
  assert.equal(JSON.stringify(invalid.calls.events).includes("synthetic-hidden-entry"), false);
  for (const point of ["startup", "cleanup", "smtp", "delivery", "close"]) {
    const f = await fixture();
    if (point === "cleanup") f.runtime.prune = async () => { throw error; };
    if (point === "smtp") f.runtime.mailer.verify = async () => { throw error; };
    if (point === "delivery") f.runtime.worker.runOne = async () => { throw error; };
    if (point === "close") f.runtime.close = async () => { f.calls.close++; throw error; };
    assert.equal(await f.run(point === "startup" ? { createRuntime: async () => { throw error; } } : {}), 1);
    assert.equal(f.calls.close, point === "startup" ? 0 : 1);
    assert.equal(f.calls.events[0].status, "unavailable");
    assert.equal(f.calls.events[0].failureStage, { startup: "configuration", cleanup: "cleanup", smtp: "smtp", delivery: "delivery", close: "shutdown" }[point]);
    assert.equal(JSON.stringify(f.calls.events).includes(error.message), false);
    if (["startup", "cleanup", "smtp"].includes(point)) assert.equal(f.calls.run, 0);
  }
});
test("real Node CLI imports trusted TypeScript without a custom loader and refuses off/malformed config without leaking it", () => {
  for (const args of [[], ["--run", "extra"], ["--check"], ["--run"]]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/auth-mail-worker.mjs", ...args], {
      cwd: new URL("../", import.meta.url), env: { NODE_ENV: "production", BLIZHNIY_DB_PASSWORD: "synthetic-hidden-password" },
      timeout: 3000, maxBuffer: 4096, encoding: "utf8",
    });
    assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.equal(result.stderr, "");
    const event = JSON.parse(result.stdout.trim());
    assert.equal(event.status, "unavailable"); assert.equal(result.stdout.includes("synthetic-hidden-password"), false);
    assert.equal(result.stdout.includes("ERR_MODULE_NOT_FOUND"), false);
    if (args.length === 1) assert.equal(event.mode, args[0].slice(2), "valid CLI mode reaches the real runtime, not an import failure");
  }
});
