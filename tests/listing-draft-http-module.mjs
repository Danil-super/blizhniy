import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as boundary from "../src/lib/auth-http.ts";
import * as cookies from "../src/lib/account-cookie.ts";
import * as proxy from "../src/lib/trusted-proxy-ip.ts";
import * as contract from "../src/lib/listing-draft-contract.ts";
import * as store from "./listing-draft-module.mjs";
import { loadAdminModule } from "./admin-module.mjs";

const require = createRequire(import.meta.url), ts = require("typescript");
const exports = {};
// Fixed repository source only; all application dependencies are real implementations.
new Function("require", "exports", ts.transpileModule(
  readFileSync(new URL("../src/lib/production-listing-draft-http.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText)(path => {
  if (path === "node:crypto") return require(path);
  if (path === "./auth-http") return boundary;
  if (path === "./account-cookie") return cookies;
  if (path === "./trusted-proxy-ip") return proxy;
  if (path === "./listing-draft-contract") return contract;
  if (path === "./postgres-listing-drafts") return store;
  if (path === "./app-session-transaction") return loadAdminModule("app-session-transaction");
  throw new Error("Unapproved draft HTTP fixture import");
}, exports);
export const { createProductionListingDraftHandler } = exports;

export function loadDraftRoute(handleProductionListingDraftRequest, collection = false) {
  const route = {};
  new Function("require", "exports", ts.transpileModule(
    readFileSync(new URL(collection ? "../src/app/api/account/listing-drafts/collection/route.ts" : "../src/app/api/account/listing-drafts/route.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText)(path => {
    if (path === "@/lib/auth-http") return boundary;
    if (path === "@/lib/production-listing-draft-runtime") return { handleProductionListingDraftRequest };
    throw new Error("Unapproved draft route fixture import");
  }, route);
  return route;
}
