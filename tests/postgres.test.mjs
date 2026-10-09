import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { test } from "node:test";
import { readPostgresConfig, createPostgresDatabase, PostgresDatabase, PostgresError } from "../src/lib/postgres.ts";

const local = {
  NODE_ENV: "test", BLIZHNIY_DB_HOST: "127.0.0.1", BLIZHNIY_DB_PORT: "5432",
  BLIZHNIY_DB_NAME: "test_db", BLIZHNIY_DB_USER: "test_user",
  BLIZHNIY_DB_PASSWORD: "synthetic+password)*", BLIZHNIY_DB_SSL_MODE: "disable",
};

test("PostgreSQL configuration is explicit, bounded, and preserves password bytes", () => {
  const config = readPostgresConfig(local);
  assert.equal(config.password, local.BLIZHNIY_DB_PASSWORD);
  assert.equal(config.ssl, false);
  assert.equal(config.max, 5);
  assert.equal(config.connectionTimeoutMillis, 3000);
  assert.equal(config.statement_timeout, 8000);
  assert.equal(config.options, "-c search_path=pg_catalog,public");
  assert.equal(config.query_timeout, undefined, "no client timeout creating ambiguous writes");
  assert.throws(() => readPostgresConfig({ PGHOST: "example.com", PGPASSWORD: "secret" }), /configuration/);
});

for (const [field, value] of [
  ["BLIZHNIY_DB_HOST", "/var/run/postgresql"], ["BLIZHNIY_DB_HOST", "postgres://user:secret@host/db"],
  ["BLIZHNIY_DB_PORT", "0"], ["BLIZHNIY_DB_PORT", "65536"], ["BLIZHNIY_DB_PORT", "5432junk"],
  ["BLIZHNIY_DB_USER", ""], ["BLIZHNIY_DB_PASSWORD", ""], ["BLIZHNIY_DB_SSL_MODE", "require"],
]) {
  test(`invalid ${field} fails closed without echoing its value`, () => {
    assert.throws(() => readPostgresConfig({ ...local, [field]: value }), (error) => {
      assert.equal(error.message, "Invalid PostgreSQL configuration");
      return true;
    });
  });
}

for (const host of ["example.com", "37.252.20.119", "localhost", "192.168.0.4"]) {
  test(`TLS cannot be disabled for ${host}`, () => {
    assert.throws(() => readPostgresConfig({ ...local, BLIZHNIY_DB_HOST: host }), /configuration/);
  });
}

test("even loopback cannot disable TLS in production or an unspecified environment", () => {
  for (const NODE_ENV of ["production", undefined]) {
    assert.throws(() => readPostgresConfig({ ...local, NODE_ENV }), /configuration/);
  }
});

test("remote connections verify the certificate chain and require an explicit CA", () => {
  const directory = mkdtempSync(join(tmpdir(), "blizhniy-pg-ca-test-"));
  const caFile = join(directory, "ca.crt");
  try {
    const remote = { ...local, NODE_ENV: "production", BLIZHNIY_DB_HOST: "db.example.ru", BLIZHNIY_DB_SSL_MODE: "verify-full" };
    assert.throws(() => readPostgresConfig(remote), /configuration/);
    writeFileSync(caFile, rootCertificates[0]);
    const config = readPostgresConfig({ ...remote, BLIZHNIY_DB_CA_FILE: caFile });
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.equal(config.ssl.ca, rootCertificates[0]);
    assert.equal(config.host, "db.example.ru");
    writeFileSync(caFile, "not a certificate");
    assert.throws(() => readPostgresConfig({ ...remote, BLIZHNIY_DB_CA_FILE: caFile }), /configuration/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the module refuses browser use", () => {
  globalThis.window = {};
  try { assert.throws(() => readPostgresConfig(local), /server/); }
  finally { delete globalThis.window; }
});

test("explicit and ambient PG* settings cannot change driver behavior", () => {
  assert.throws(() => readPostgresConfig({ ...local, PGREPLICATION: "database" }), /configuration/);
  const previous = process.env.PGREPLICATION;
  process.env.PGREPLICATION = "database";
  try { assert.throws(() => createPostgresDatabase(local), /configuration/); }
  finally {
    if (previous === undefined) delete process.env.PGREPLICATION;
    else process.env.PGREPLICATION = previous;
  }
});

test("failure acquiring a transaction connection is sanitized", async () => {
  const pool = { on() {}, connect: async () => { throw new Error("password in driver message"); } };
  const db = new PostgresDatabase(pool);
  await assert.rejects(db.transaction(async () => 1), { message: "PostgreSQL operation failed" });
});

function fakePool(failOn) {
  const calls = [];
  const releases = [];
  const query = async (config) => {
    calls.push(config);
    if (config.text === failOn) throw Object.assign(new Error("secret in PostgreSQL detail"), { code: "08006" });
    return { rows: [{ value: 42 }], rowCount: 1 };
  };
  const client = { query, release: (error) => releases.push(error) };
  const pool = { query, connect: async () => client, on() {}, end: async () => { calls.push("end"); } };
  return { db: new PostgresDatabase(pool), calls, releases };
}

test("query uses bound values and extended protocol, including zero parameters", async () => {
  const { db, calls } = fakePool();
  const value = "'); DROP TABLE users; --";
  assert.equal((await db.query("select $1 as value", [value])).rows[0].value, 42);
  await db.query("select 1");
  assert.deepEqual(calls[0], { text: "select $1 as value", values: [value], queryMode: "extended" });
  assert.deepEqual(calls[1], { text: "select 1", values: [], queryMode: "extended" });
});

test("transaction commits on one client and releases it once", async () => {
  const { db, calls, releases } = fakePool();
  assert.equal(await db.transaction(async (tx) => (await tx.query("select 42")).rows[0].value), 42);
  assert.deepEqual(calls.map((call) => call.text), ["BEGIN", "select 42", "COMMIT"]);
  assert.deepEqual(releases, [undefined]);
});

test("read-only transaction explicitly begins READ ONLY", async () => {
  const { db, calls } = fakePool();
  await db.transaction(async (tx) => tx.query("select 1"), { readOnly: true });
  assert.equal(calls[0].text, "BEGIN READ ONLY");
});

test("callback failure rolls back, preserves the failure, and releases the client", async () => {
  const { db, calls, releases } = fakePool();
  const error = new Error("business validation failed");
  await assert.rejects(db.transaction(async () => { throw error; }), (actual) => actual === error);
  assert.deepEqual(calls.map((call) => call.text), ["BEGIN", "ROLLBACK"]);
  assert.deepEqual(releases, [undefined]);
});

for (const failOn of ["BEGIN", "COMMIT", "ROLLBACK"]) {
  test(`${failOn} failure destroys the uncertain connection without retry`, async () => {
    const { db, calls, releases } = fakePool(failOn);
    await assert.rejects(db.transaction(async () => {
      if (failOn === "ROLLBACK") throw new Error("original failure");
    }));
    assert.equal(calls.filter((call) => call.text === "BEGIN").length, 1);
    assert.equal(calls.filter((call) => call.text === "COMMIT").length, failOn === "COMMIT" ? 1 : 0);
    assert.equal(releases.length, 1);
    assert.equal(releases[0], true);
  });
}

test("driver errors are sanitized but retain a safe SQLSTATE", async () => {
  const { db } = fakePool("select broken");
  await assert.rejects(db.query("select broken"), (error) => {
    assert.ok(error instanceof PostgresError);
    assert.equal(error.message, "PostgreSQL operation failed");
    assert.equal(error.code, "08006");
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("close shuts down the pool", async () => {
  const { db, calls } = fakePool();
  await db.close();
  assert.deepEqual(calls, ["end"]);
});

test("only known TLS/network codes and SQLSTATE survive error sanitization", () => {
  assert.equal(new PostgresError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }).code, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.equal(new PostgresError({ code: "ECONNREFUSED" }).code, "ECONNREFUSED");
  assert.equal(new PostgresError({ code: "contains password" }).code, undefined);
});
