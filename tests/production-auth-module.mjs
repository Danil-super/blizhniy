import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as mail from "../src/lib/timeweb-mail.ts";
import * as boundary from "../src/lib/auth-http.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { RegistrationStore, PasswordRecoveryStore, RegistrationInputError, RecoveryInputError } from "./auth-mail-module.mjs";
import * as identity from "../src/lib/identity.ts";
import * as validation from '../src/lib/account-validation.ts';
import * as browserProof from '../src/lib/account-browser-proof.ts';
import { verifyProductionAuthDatabase } from "../src/lib/production-auth-database.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
export function loadProductionAuth(name, extra = {}) {
  if (!["production-auth-config", "production-account-http", "production-auth-runtime"].includes(name)) throw new Error("Unapproved production auth fixture");
  const exports = {};
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  new Function("require", "exports", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(path => {
    if (Object.hasOwn(extra, path)) return extra[path];
    if (["node:fs", "node:path", "node:crypto"].includes(path)) return require(path);
    if (["./timeweb-mail", "./timeweb-mail.ts"].includes(path)) return mail;
    if (path === "./production-auth-database.ts") return { verifyProductionAuthDatabase };
    if (path === "./auth-http") return boundary;
    if (path === "./registration-legal") return { REGISTRATION_LEGAL_VERSIONS };
    if (path === "./registration") return { RegistrationStore, RegistrationInputError };
    if (path === "./password-recovery") return { PasswordRecoveryStore, RecoveryInputError };
    if (path === "./identity") return identity;
    if (path === './account-validation.ts') return validation;
    if (path === './account-browser-proof.ts') return browserProof;
    throw new Error("Unapproved production auth import");
  }, exports);
  return exports;
}
