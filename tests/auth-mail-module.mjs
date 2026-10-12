import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as identity from "../src/lib/identity.ts";
import * as outbox from "../src/lib/mail-outbox.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(name) {
  const exports = {};
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  new Function("require", "exports", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(path => {
    if (path === "./identity") return identity;
    if (path === "./mail-outbox") return outbox;
    if (path === "./registration-legal") return { REGISTRATION_LEGAL_VERSIONS };
    if (path === "node:crypto") return require("node:crypto");
    throw new Error("Unapproved auth mail test import");
  }, exports);
  return exports;
}
export const { RegistrationStore, RegistrationInputError } = load("registration");
export const { PasswordRecoveryStore, RecoveryInputError } = load("password-recovery");
