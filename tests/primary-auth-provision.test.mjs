import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePrimaryAuthTarget, provisionPrimaryAuth } from "../scripts/provision-primary-auth.mjs";
import * as primary from "../scripts/provision-primary-auth.mjs";

const config = { host: "17e86f80f26733d39ef4b84d.twc1.net", port: 5432, database: "blizhniy_prod", user: "gen_user", ssl: { rejectUnauthorized: true } };
const confirmation = `${config.host}:blizhniy_prod`;
test("primary Auth provisioning is restricted to the confirmed RF target and verified TLS", () => {
  validatePrimaryAuthTarget(config, confirmation, "production");
  for (const change of [{ host: "foreign.invalid" }, { database: "blizhniy_staging" }, { database: "default_db" }, { port: 5433 }, { ssl: false }, { ssl: { rejectUnauthorized: false } }, { user: "blizhniy_runtime" },
    { connectionString: "postgresql://synthetic@foreign.invalid/default_db" }, { stream: () => assert.fail("transport hook must not execute") },
    { ssl: { rejectUnauthorized: true, checkServerIdentity: () => undefined } }]) {
    assert.throws(() => validatePrimaryAuthTarget({ ...config, ...change }, confirmation, "production"));
  }
  assert.throws(() => validatePrimaryAuthTarget(config, "wrong:default_db", "production"));
  const local = { ...config, host: "127.0.0.1", database: "blizhniy_test", ssl: false };
  validatePrimaryAuthTarget(local, "127.0.0.1:blizhniy_test", "test");
  assert.throws(() => validatePrimaryAuthTarget(local, "127.0.0.1:blizhniy_test", "production"));
});
test("unconfirmed provisioning refuses before opening a database connection or saving credentials", async () => {
  await assert.rejects(provisionPrimaryAuth(config, "wrong:default_db", "/must-not-be-written/runtime.json", "production"));
});
test("profile grants require the confirmed primary target and matching restricted runtime credentials before connecting", async () => {
  assert.equal(typeof primary.provisionPrimaryProfiles, "function");
  const credentials = { host: config.host, port: 5432, database: config.database, user: "blizhniy_runtime", password: "a".repeat(64) };
  await assert.rejects(primary.provisionPrimaryProfiles(config, "wrong:default_db", credentials, "production"));
  for (const change of [{ host: "foreign.invalid" }, { database: "blizhniy_staging" }, { port: 5433 },
    { user: "gen_user" }, { password: "" }, { password: "a".repeat(63) }, { password: "Z".repeat(64) },
    { ssl: false }, { connectionString: "postgresql://synthetic@foreign.invalid/default_db" }]) {
    await assert.rejects(primary.provisionPrimaryProfiles(config, confirmation, { ...credentials, ...change }, "production"), /runtime credentials/);
  }
});
