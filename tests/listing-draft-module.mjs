import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as contract from "../src/lib/listing-draft-contract.ts";
import { loadAdminModule } from "./admin-module.mjs";

const ts = createRequire(import.meta.url)("typescript");
const source = readFileSync(new URL("../src/lib/postgres-listing-drafts.ts", import.meta.url), "utf8");
const exports = {};
new Function("require", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(path => {
  if (path === "./listing-draft-contract") return contract;
  if (path === "./app-session-transaction") return loadAdminModule("app-session-transaction");
  throw new Error("Unapproved listing draft fixture import");
}, exports);
export const { PostgresListingDraftStore, ListingDraftAccessError, ListingDraftConflictError } = exports;
