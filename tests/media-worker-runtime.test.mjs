import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { assertConstrainedMediaRuntime } from "../scripts/media-worker-runtime.mjs";
import { decodeMediaReply } from "../src/lib/media-worker-protocol.ts";

test("runtime guard checks every actual resource limit and refuses missing or relaxed controllers", () => {
  const unit = "blizhniy-media-11111111-1111-4111-8111-111111111111.service";
  const group = "/user.slice/" + unit;
  const defaults = { "/proc/self/cgroup": "0::" + group, "/proc/self/status": "NoNewPrivs:\t1\n", "memory.max": "536870912", "memory.swap.max": "0", "cpu.max": "100000 100000", "pids.max": "32" };
  const ts = createRequire(import.meta.url)("typescript");
  const source = ts.transpileModule(readFileSync(new URL("../scripts/media-worker-runtime.mjs", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const check = changes => {
    const values = { ...defaults, ...changes }, exports = {};
    vm.runInNewContext(source, { exports, Error, process: { platform: "linux", env: { NODE_ENV: "test" } }, require: name => {
      assert.equal(name, "node:fs");
      return { readFileSync: filename => {
        const key = filename.startsWith("/sys/fs/cgroup" + group + "/") ? filename.split("/").at(-1) : filename;
        if (values[key] == null) throw new Error("Missing controller");
        return values[key];
      } };
    } });
    exports.assertConstrainedMediaRuntime(unit);
  };
  check({}); check({ "cpu.max": "10000 100000" });
  for (const change of [{ "memory.max": "max" }, { "memory.max": "1073741824" }, { "memory.swap.max": "max" }, { "pids.max": "max" }, { "pids.max": "64" },
    { "cpu.max": "max 100000" }, { "cpu.max": "100001 100000" }, { "cpu.max": "0 0" }, { "/proc/self/status": "NoNewPrivs:\t0\n" }, { "memory.max": null }, { "/proc/self/cgroup": "0::/other.service" }]) {
    assert.throws(() => check(change));
  }
});

test("runtime guard refuses a forged or missing unit outside a constrained cgroup", () => {
  for (const unit of [undefined, "../../../", "blizhniy-media-11111111-1111-4111-8111-111111111111.service"]) {
    assert.throws(() => assertConstrainedMediaRuntime(unit), /Media runtime unavailable/);
  }
});
test("the executable refuses an ordinary uncapped child process without reading or decoding its input", () => {
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/media-worker.mjs", "blizhniy-media-11111111-1111-4111-8111-111111111111.service"], {
    cwd: new URL("../", import.meta.url), env: { NODE_ENV: "test" }, input: Buffer.from([1, 137, 80, 78, 71]), timeout: 2000, maxBuffer: 1024, stdio: ["pipe", "pipe", "ignore"],
  });
  assert.deepEqual(decodeMediaReply(output), { error: "MEDIA_UNAVAILABLE" });
});
