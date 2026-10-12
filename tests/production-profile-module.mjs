import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as boundary from "../src/lib/auth-http.ts";
import * as cookies from "../src/lib/account-cookie.ts";
import * as proxy from "../src/lib/trusted-proxy-ip.ts";
import { loadAdminModule } from "./admin-module.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const modules = new Map();
export function loadProfileModule(name) {
  if (!["cabinet-profile", "postgres-profile", "production-profile-http"].includes(name)) throw new Error("Unapproved profile fixture");
  if (modules.has(name)) return modules.get(name);
  const exports = {};
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  new Function("require", "exports", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(path => {
    if (path === "node:crypto") return require(path);
    if (path === "./auth-http") return boundary;
    if (path === "./account-cookie") return cookies;
    if (path === "./trusted-proxy-ip") return proxy;
    if (path === "./app-session-transaction") return loadAdminModule("app-session-transaction");
    if (["./cabinet-profile", "./postgres-profile"].includes(path)) return loadProfileModule(path.slice(2));
    throw new Error("Unapproved profile import");
  }, exports);
  modules.set(name, exports);
  return exports;
}
