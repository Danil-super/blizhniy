import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as identity from "../src/lib/identity.ts";

const ts = createRequire(import.meta.url)("typescript");
const modules = new Map();
export function loadAdminModule(name) {
  if (!["admin-authorization", "catalog-administration", "tariff-administration", "account-cookie"].includes(name)) throw new Error("Unapproved admin test module");
  if (modules.has(name)) return modules.get(name);
  const exports = {};
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", compiled)(path => {
    if (path === "./identity") return identity;
    if (path === "./admin-authorization") return loadAdminModule("admin-authorization");
    throw new Error("Unapproved admin test import");
  }, exports);
  modules.set(name, exports);
  return exports;
}
