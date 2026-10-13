import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { test } from "node:test";
import pg from "pg";
import { createProductionMailRuntime } from "../src/lib/production-mail-runtime.ts";
import { MailDeliveryWorker } from "../src/lib/mail-delivery.ts";

test("real production mail runtime loads no key/pool until explicit valid configuration, verifies role/schema and owns shutdown", async () => {
  const directory = mkdtempSync(join(tmpdir(), "blizhniy-mail-runtime-fixture-"));
  const keyFile = join(directory, "mail.key"), caFile = join(directory, "root.crt");
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 }); writeFileSync(caFile, rootCertificates[0]);
  const env = { NODE_ENV: "production", BLIZHNIY_AUTH_MODE: "postgres",
    BLIZHNIY_AUTH_ORIGIN: "https://xn----9sbphbgks4a4a.xn--p1ai", BLIZHNIY_DB_HOST: "17e86f80f26733d39ef4b84d.twc1.net",
    BLIZHNIY_DB_PORT: "5432", BLIZHNIY_DB_NAME: "default_db", BLIZHNIY_DB_USER: "blizhniy_runtime", BLIZHNIY_DB_PASSWORD: "synthetic-worker-password",
    BLIZHNIY_DB_SSL_MODE: "verify-full", BLIZHNIY_DB_CA_FILE: caFile, BLIZHNIY_AUTH_MAIL_KEY_FILE: keyFile,
    BLIZHNIY_AUTH_RATE_SECRET: "r".repeat(64), TURNSTILE_SECRET_KEY: "t".repeat(40),
    BLIZHNIY_MAIL_MODE: "timeweb", BLIZHNIY_SMTP_USER: "notifications@xn----9sbphbgks4a4a.xn--p1ai", BLIZHNIY_SMTP_PASSWORD: "synthetic-smtp-password" };
  const Pool = pg.Pool, calls = { pools: 0, closed: 0, sql: [] };
  const role = { name: "blizhniy_runtime", rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false,
    schema_create: false, public_create: false, database_create: false, temp_create: false, role_update: false, role_insert: false, rate_schema_missing: false };
  let change = {}, missingSchema = false;
  pg.Pool = class {
    constructor(config) { calls.pools++; assert.equal(config.user, "blizhniy_runtime"); assert.equal(config.ssl.rejectUnauthorized, true); }
    on() {}
    async query({ text }) {
      calls.sql.push(text);
      if (text.includes("from pg_roles")) return { rows: [{ ...role, ...change }] };
      if (missingSchema) throw new Error("synthetic schema and secret details");
      return { rows: [] };
    }
    async end() { calls.closed++; }
  };
  try {
    await assert.rejects(createProductionMailRuntime({ NODE_ENV: "production" }), /Production mail unavailable/);
    await assert.rejects(createProductionMailRuntime({ ...env, BLIZHNIY_DB_USER: "gen_user" }));
    await assert.rejects(createProductionMailRuntime({ ...env, BLIZHNIY_AUTH_MAIL_KEY_FILE: join(directory, "missing.key") }));
    writeFileSync(keyFile, Buffer.from("a".repeat(64), "hex"));
    await assert.rejects(createProductionMailRuntime({ ...env, BLIZHNIY_AUTH_RATE_SECRET: "a".repeat(64) }), /Invalid mail encryption key/);
    writeFileSync(keyFile, randomBytes(32));
    assert.equal(calls.pools, 0);
    const runtime = await createProductionMailRuntime(env);
    assert.ok(runtime.worker instanceof MailDeliveryWorker); assert.equal(typeof runtime.prune, "function");
    assert.equal(calls.pools, 1); assert.equal(calls.sql.length, 2); assert.equal(calls.closed, 0);
    assert.equal(typeof runtime.mailer.send, "function"); await runtime.close(); assert.equal(calls.closed, 1);
    for (const alteration of [{ name: "gen_user" }, { role_update: true }, { rolsuper: true }, { rate_schema_missing: true }]) {
      change = alteration;
      const before = calls.closed;
      await assert.rejects(createProductionMailRuntime(env), { message: "Production mail unavailable" });
      assert.equal(calls.closed, before+1);
    }
    change = {}; missingSchema = true;
    const before = calls.closed;
    await assert.rejects(createProductionMailRuntime(env), { message: "Production mail unavailable" });
    assert.equal(calls.closed, before+1);
  } finally { pg.Pool = Pool; rmSync(directory, { recursive: true }); }
});
