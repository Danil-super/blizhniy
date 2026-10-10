import { readFileSync, constants } from "node:fs";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as protocol from "../src/lib/media-worker-protocol.ts";
import { loadAdminModule } from "./admin-module.mjs";

const ts = createRequire(import.meta.url)("typescript");
export function loadMediaModule(name, environment = {}) {
  if (!["media-metadata", "media-files"].includes(name)) throw new Error("Unapproved media module");
  const dependencies = { "./app-session-transaction": loadAdminModule("app-session-transaction"), "./media-worker-protocol": protocol,
    "node:fs": { constants }, "node:fs/promises": fs, "node:crypto": crypto, "node:path": path };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Buffer, Uint8Array, Error, process: { env: { NODE_ENV: "test" }, platform: process.platform, getuid: process.getuid, ...environment },
    ...(environment.browser ? { window: {} } : {}), require: name => { assertDependency(name, dependencies); return dependencies[name]; } });
  return exports;
}
function assertDependency(name, dependencies) { if (!(name in dependencies)) throw new Error("Unapproved media dependency"); }
