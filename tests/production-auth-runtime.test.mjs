import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import * as cookies from "../src/lib/account-cookie.ts";
import * as proxy from "../src/lib/trusted-proxy-ip.ts";
import { MailPayloadCipher } from "../src/lib/mail-outbox.ts";
import { MailDeliveryWorker } from "../src/lib/mail-delivery.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import * as boundary from "../src/lib/auth-http.ts";
import { loadProductionAuth } from "./production-auth-module.mjs";

const settings = loadProductionAuth("production-auth-config");
const account = loadProductionAuth("production-account-http", { "./account-cookie": cookies,
  "./trusted-proxy-ip": proxy, "./production-auth-config": settings });
const config = { origin: settings.productionAuthOrigin, rateSecret: "r".repeat(64), mailKeyFile: "/synthetic/key.bin" };
function fixture(changes = {}) {
  delete globalThis.blizhniyProductionAuth;
  const calls = { keys: 0, pools: 0, queries: [], close: 0, mailers: 0, cipher: null };
  const key = randomBytes(32);
  const role = { name: "blizhniy_runtime", rolsuper: false, rolcreatedb: false, rolcreaterole: false,
    rolreplication: false, rolbypassrls: false, schema_create: false, public_create: false,
    database_create: false, temp_create: false, role_update: false, role_insert: false, rate_schema_missing: false, ...changes.role };
  if (changes.missingRateSchema) delete role.rate_schema_missing;
  const db = { query: async sql => {
    calls.queries.push(sql);
    if (sql.includes("from pg_roles")) return { rows: [role] };
    if (changes.missingSchema) throw new Error("Synthetic missing queue schema");
    return { rows: [] };
  }, close: async () => { calls.close++; } };
  const runtime = loadProductionAuth("production-auth-runtime", {
    "./production-auth-config": { ...settings, readProductionAuthConfig: () => changes.off ? null : config,
      readMailEncryptionKey: () => { calls.keys++; return key; } },
    "./production-account-http": account,
    "./postgres": { createPostgresDatabase: () => { calls.pools++; return db; } },
    "./mail-outbox": { MailPayloadCipher }, "./mail-delivery": { MailDeliveryWorker },
    "./timeweb-mail": { createTimewebMailer: () => { calls.mailers++; return { send: async () => assert.fail("unexpected SMTP send") }; } },
    "./turnstile": { verifyTurnstileToken: async () => true },
    "./auth-http": { ...boundary, AuthRateLimiter: class { async allowProduction() { return true; } } },
    "./registration": { RegistrationInputError: class extends Error {}, RegistrationStore: class {
      constructor(actualDB, cipher) { assert.equal(actualDB, db); calls.cipher = cipher; }
      async register() { return null; }
    } },
  });
  return { runtime, calls, key };
}

function request(headers = {}, method = "POST") {
  return new Request(`${config.origin}/api/account/register`, { method, headers: {
    host: new URL(config.origin).host, origin: config.origin, "x-blizhniy-request": "1",
    "content-type": "application/json", "x-real-ip": "192.0.2.1", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify({ email: "synthetic-runtime@example.invalid", password: "Synthetic runtime passphrase!",
      captchaToken: "synthetic-proof", acceptedAgreement: true, acknowledgedPrivacy: true,
      agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy }) }),
  });
}
test("production runtime import/off/invalid request never reads a key or creates a PostgreSQL pool", async () => {
  const off = fixture({ off: true });
  assert.equal(off.calls.pools, 0);
  assert.equal((await off.runtime.handleProductionAccountRequest(request(), "register")).status, 404);
  assert.equal(off.calls.keys, 0);
  const invalid = fixture();
  assert.equal((await invalid.runtime.handleProductionAccountRequest(request({ origin: "https://attacker.invalid" }), "register")).status, 403);
  assert.equal((await invalid.runtime.handleProductionAccountRequest(request({}, "GET"), "confirm")).status, 405);
  assert.equal(invalid.calls.pools, 0);
  assert.equal(invalid.calls.keys, 0);
});
test("production runtime verifies restricted role and delivery schema once, copies/zeroes key bytes and reuses one pool", async () => {
  const f = fixture();
  assert.equal((await f.runtime.handleProductionAccountRequest(request(), "register")).status, 202);
  assert.equal((await f.runtime.handleProductionAccountRequest(request(), "register")).status, 202);
  assert.equal(f.calls.pools, 1);
  assert.equal(f.calls.keys, 1);
  assert.equal(f.calls.queries.length, 2);
  assert.ok(f.calls.cipher instanceof MailPayloadCipher);
  assert.equal(f.key.every(byte => byte === 0), true);
  assert.equal(f.calls.mailers, 0, "HTTP never initializes SMTP or sends a message");
  const delivery = await f.runtime.getProductionMailDelivery();
  assert.ok(delivery.worker instanceof MailDeliveryWorker);
  assert.equal(f.calls.mailers, 1);
});
test("wrong/elevated roles and missing delivery schema fail closed and never silently retry a failed startup", async () => {
  for (const changes of [{ role: { name: "gen_user" } }, { role: { rolsuper: true } },
    { role: { rolcreaterole: true } }, { role: { role_update: true } }, { role: { role_insert: true } }, { role: { temp_create: true } }, { missingSchema: true }]) {
    const f = fixture(changes);
    assert.equal((await f.runtime.handleProductionAccountRequest(request(), "register")).status, 503);
    assert.equal(f.calls.close, 1);
    const queries = f.calls.queries.length;
    assert.equal((await f.runtime.handleProductionAccountRequest(request(), "register")).status, 503);
    assert.equal(f.calls.queries.length, queries);
    assert.equal(f.calls.pools, 1);
    assert.equal(f.calls.mailers, 0);
  }
  delete globalThis.blizhniyProductionAuth;
});

test("production startup refuses the old small rate schema before accepting any account request", async () => {
  for (const changes of [{ role: { rate_schema_missing: true } }, { missingRateSchema: true }]) {
    const f = fixture(changes);
    assert.equal((await f.runtime.handleProductionAccountRequest(request(), "register")).status, 503);
    assert.equal(f.calls.close, 1);
    assert.equal(f.calls.mailers, 0);
    assert.match(f.calls.queries[0], /auth_rate_limits_production_attempts_check/);
  }
  delete globalThis.blizhniyProductionAuth;
});
