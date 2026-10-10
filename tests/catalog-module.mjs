import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as contract from "../src/lib/category-contract.ts";

// Same trusted-source TypeScript loading convention as registration-integration.mjs.
const ts = createRequire(import.meta.url)("typescript");
const exports = {};
const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/postgres-catalog.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("require", "exports", compiled)(path => {
  if (path === "./category-contract") return contract;
  throw new Error("Unapproved catalog test import");
}, exports);

export const { PostgresCatalogRepository, CatalogInputError } = exports;
