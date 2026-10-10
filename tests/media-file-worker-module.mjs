import { readFileSync, constants } from "node:fs";
import fs from "node:fs/promises";
import * as childProcess from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as protocol from "../src/lib/media-file-protocol.ts";
import * as inspection from "../src/lib/media-file-inspection-protocol.ts";

const ts = createRequire(import.meta.url)("typescript");
export function fileWorkerModule(overrides = {}) {
  const dependencies = { "node:child_process": { ...childProcess, ...overrides.childProcess }, "node:fs": { constants }, "node:fs/promises": { ...fs, ...overrides.fs },
    "node:path": path, "./media-file-protocol.ts": protocol, "./media-file-inspection-protocol.ts": inspection };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/media-file-worker.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Buffer, Uint8Array, Error, globalThis: overrides.global ?? {},
    process: { env: { NODE_ENV: "test" }, platform: process.platform, getuid: process.getuid, versions: process.versions, execPath: process.execPath, ...overrides.process },
    setTimeout: overrides.setTimeout ?? setTimeout, clearTimeout: overrides.clearTimeout ?? clearTimeout, ...(overrides.browser ? { window: {} } : {}),
    require: name => { if (!(name in dependencies)) throw new Error("Unapproved file worker dependency"); return dependencies[name]; } });
  return exports;
}
