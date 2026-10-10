import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { readLocalAuthConfig } from "../src/lib/auth-http.ts";

const ts = createRequire(import.meta.url)("typescript");
const env = { NODE_ENV: "test", BLIZHNIY_AUTH_MODE: "local", BLIZHNIY_DB_HOST: "127.0.0.1", BLIZHNIY_DB_SSL_MODE: "disable",
  BLIZHNIY_AUTH_ORIGIN: "https://127.0.0.1:3037", BLIZHNIY_LOCAL_MAIL_URL: "http://127.0.0.1:3038/messages", BLIZHNIY_AUTH_RATE_SECRET: "s".repeat(64) };
function load(file, changes = {}, browser = false) {
  const exports = {};
  let creations = 0;
  const database = { synthetic: true };
  const context = { exports, process: { env: { ...env, ...changes } }, Error,
    require: name => {
      if (name === "./postgres") return { createPostgresDatabase: () => { creations++; return database; } };
      if (name === "./auth-http") return { readLocalAuthConfig: () => readLocalAuthConfig({ ...env, ...changes }) };
      throw new Error("Unapproved server boundary import");
    }, ...(browser ? { window: {} } : {}),
  };
  const code = ts.transpileModule(readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, context);
  return { exports, creations: () => creations, database };
}

test("cookie parser accepts exactly one canonical host session and no other credential source", () => {
  const { exports: { readAccountSessionToken } } = load("account-cookie");
  const token = "a".repeat(64);
  const request = headers => new Request("https://127.0.0.1:3037/api/account/session", { headers });
  assert.equal(readAccountSessionToken(request({ cookie: `other=1; __Host-blizhniy_session=${token}; third=2` })), token);
  for (const headers of [{}, { authorization: `Bearer ${token}` }, { cookie: `other=${token}` },
    { cookie: `__Host-blizhniy_session=${token}; __Host-blizhniy_session=${token}` },
    { cookie: `__Host-blizhniy_session="${token}"` }, { cookie: `__Host-blizhniy_session=${token.toUpperCase()}` },
    { cookie: `__Host-blizhniy_session=${token}; extra=${"x".repeat(4096)}` }]) assert.equal(readAccountSessionToken(request(headers)), null);
});

test("local server modules share one lazy database and never create it at import", () => {
  const module = load("local-database");
  assert.equal(module.creations(), 0);
  assert.equal(module.exports.getLocalDatabase(), module.database);
  assert.equal(module.exports.getLocalDatabase(), module.database);
  assert.equal(module.creations(), 1);
});

test("shared local database refuses browser, off, production and non-loopback configuration", () => {
  for (const [changes, browser] of [[{}, true], [{ BLIZHNIY_AUTH_MODE: "" }, false], [{ NODE_ENV: "production" }, false], [{ BLIZHNIY_DB_HOST: "db.example.invalid" }, false]]) {
    const module = load("local-database", changes, browser);
    assert.throws(() => module.exports.getLocalDatabase());
    assert.equal(module.creations(), 0);
  }
});
