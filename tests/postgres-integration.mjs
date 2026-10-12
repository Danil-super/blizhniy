// Opt-in, synthetic data only. Never reads .env or a remote PostgreSQL endpoint.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rootCertificates } from "node:tls";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createPostgresDatabase } from "../src/lib/postgres.ts";
import { AuthRateLimiter } from "../src/lib/auth-http.ts";

const run = promisify(execFile);
const image = "postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873";
const name = `blizhniy-pg-test-${randomBytes(8).toString("hex")}`;
const label = "blizhniy.postgres-integration";
const password = randomBytes(24).toString("hex");
const dockerEnv = { PATH: process.env.PATH, LANG: "C.UTF-8", POSTGRES_PASSWORD: password };
const docker = async (args) => (await run("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
  env: dockerEnv, timeout: 20000, maxBuffer: 1024 * 1024,
})).stdout.trim();

test("isolated PostgreSQL 18.6: parameters, transactions, limits and cleanup", { timeout: 180000 }, async (suite) => {
  let id;
  let db;
  const certificates = mkdtempSync(join(tmpdir(), "blizhniy-pg-tls-test-"));
  try {
    id = await docker(["run", "--detach", "--pull", "never", "--name", name,
      "--label", `${label}=${name}`, "--memory", "512m", "--cpus", "1",
      "--tmpfs", "/var/lib/postgresql:rw,size=268435456", "--publish", "127.0.0.1::5432",
      "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=blizhniy_test", image]);
    assert.match(id, /^[a-f0-9]{64}$/);
    const inspect = JSON.parse(await docker(["inspect", id]))[0];
    assert.equal(inspect.Config.Labels[label], name);
    const binding = inspect.NetworkSettings.Ports["5432/tcp"][0];
    assert.equal(binding.HostIp, "127.0.0.1");
    const env = {
      NODE_ENV: "test", BLIZHNIY_DB_HOST: "127.0.0.1", BLIZHNIY_DB_PORT: binding.HostPort,
      BLIZHNIY_DB_NAME: "blizhniy_test", BLIZHNIY_DB_USER: "postgres",
      BLIZHNIY_DB_PASSWORD: password, BLIZHNIY_DB_SSL_MODE: "disable",
    };
    const deadline = Date.now() + 20000;
    for (;;) {
      // initdb temporarily starts a socket-only server; wait for the final TCP server.
      try { await docker(["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "blizhniy_test"]); break; }
      catch { if (Date.now() > deadline) throw new Error("Isolated PostgreSQL did not start"); }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    db = createPostgresDatabase(env);
    await suite.test("exact target version and server-side limits", async () => {
      const { rows: [row] } = await db.query("select current_setting('server_version') as version, current_setting('statement_timeout') as timeout, current_setting('search_path') as path");
      assert.match(row.version, /^18\.6/);
      assert.equal(row.timeout, "8s");
      assert.equal(row.path, "pg_catalog,public");
    });
    await db.query("create table public.integration_probe (id integer primary key, value text not null)");
    await suite.test("SQL-looking values are stored literally; multiple statements are rejected", async () => {
      const value = "'); DROP TABLE public.integration_probe; --";
      await db.query("insert into public.integration_probe values ($1, $2)", [1, value]);
      assert.equal((await db.query("select value from public.integration_probe where id = $1", [1])).rows[0].value, value);
      await assert.rejects(db.query("select 1; drop table public.integration_probe"), { code: "42601" });
      assert.equal((await db.query("select count(*)::integer as count from public.integration_probe")).rows[0].count, 1);
    });
    await suite.test("commit persists; failure rolls back every write", async () => {
      await db.transaction(async (tx) => tx.query("insert into public.integration_probe values ($1, $2)", [2, "committed"]));
      await assert.rejects(db.transaction(async (tx) => {
        await tx.query("insert into public.integration_probe values ($1, $2)", [3, "rolled back"]);
        await tx.query("insert into public.integration_probe values ($1, $2)", [2, "duplicate"]);
      }), { code: "23505" });
      assert.deepEqual((await db.query("select id from public.integration_probe order by id")).rows.map((row) => row.id), [1, 2]);
    });
    await suite.test("read-only transactions reject writes and leave a reusable connection", async () => {
      await assert.rejects(db.transaction(async (tx) => tx.query("delete from public.integration_probe"), { readOnly: true }), { code: "25006" });
      assert.equal((await db.query("select count(*)::integer as count from public.integration_probe")).rows[0].count, 2);
    });
    await suite.test("a statement timeout rolls back and returns the connection to the pool", async () => {
      await assert.rejects(db.transaction(async (tx) => {
        await tx.query("set local statement_timeout = '50ms'");
        await tx.query("select pg_sleep(1)");
      }), { code: "57014" });
      const results = await Promise.all(Array.from({ length: 12 }, () => db.query("select 42 as value")));
      assert.ok(results.every((result) => result.rows[0].value === 42));
    });
    await suite.test("wrong password fails safely without exposing credentials", async () => {
      const wrong = createPostgresDatabase({ ...env, BLIZHNIY_DB_PASSWORD: "synthetic-wrong-password" });
      try { await assert.rejects(wrong.query("select 1"), { message: "PostgreSQL operation failed", code: "28P01" }); }
      finally { await wrong.close(); }
    });
    const applyMigration = async (filename) => {
      if (!["0001-identity.sql", "0001-identity.down.sql", "0002-registration.sql", "0002-registration.down.sql",
        "0003-auth-rate-limits.sql", "0003-auth-rate-limits.down.sql", "0004-password-recovery.sql",
        "0004-password-recovery.down.sql", "0005-reference-catalog.sql", "0008-mail-outbox.sql",
        "0008-mail-outbox.down.sql"].includes(filename)) throw new Error("Unapproved migration fixture");
      const source = fileURLToPath(new URL(`../database/migrations/${filename}`, import.meta.url));
      await docker(["cp", source, `${id}:/tmp/blizhniy-identity.sql`]);
      await docker(["exec", id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "blizhniy_test", "-f", "/tmp/blizhniy-identity.sql"]);
    };
    const { testIdentity } = await import("./identity-integration.mjs");
    await testIdentity(suite, db, applyMigration);
    const { testRegistration } = await import("./registration-integration.mjs");
    await testRegistration(suite, db, applyMigration);
    const { testPasswordRecovery } = await import("./password-recovery-integration.mjs");
    await testPasswordRecovery(suite, db, applyMigration);
    const { testMailOutbox } = await import("./mail-outbox-integration.mjs");
    await testMailOutbox(suite, db, env, applyMigration);
    await suite.test("shared auth limiter migration up/down, concurrent instances and no plaintext PII", async () => {
      await applyMigration("0003-auth-rate-limits.sql");
      await applyMigration("0003-auth-rate-limits.down.sql");
      await applyMigration("0003-auth-rate-limits.sql");
      const secret = randomBytes(32).toString("hex");
      const first = new AuthRateLimiter(db, secret);
      const second = new AuthRateLimiter(db, secret);
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? first : second).allow(i % 2 ? "limiter@example.invalid" : " LIMITER@example.invalid ")));
      assert.equal(results.filter(Boolean).length, 5);
      const counters = (await db.query("select key_hash, attempts from app.auth_rate_limits")).rows;
      assert.equal(counters.length, 2);
      assert.ok(counters.every((row) => /^[a-f0-9]{64}$/.test(row.key_hash)));
      assert.deepEqual(counters.map((row) => row.attempts).sort((a,b) => a-b), [6, 12]);
      await assert.rejects(applyMigration("0003-auth-rate-limits.down.sql"));
      await assert.rejects(applyMigration("0003-auth-rate-limits.sql"));
      const further = await Promise.all(Array.from({ length: 60 }, () => second.allow()));
      assert.equal(further.filter(Boolean).length, 48);
      assert.equal(await new AuthRateLimiter(db, secret).allow(), false, "process restart does not reset counters");
      // Expire only this test's synthetic counters; cleanup never touches user accounts.
      await db.query("update app.auth_rate_limits set window_start=window_start-interval '25 hours'");
      assert.equal(await first.prune(), 2);
      assert.equal(await second.allow("limiter@example.invalid"), true);
      await db.query("create role rate_test_anonymous nologin");
      await assert.rejects(db.transaction(async (tx) => {
        await tx.query("set local role rate_test_anonymous");
        await tx.query("select * from app.auth_rate_limits");
      }), { code: "42501" });
      await db.query("drop role rate_test_anonymous");
    });
    await applyMigration("0005-reference-catalog.sql");
    const { testRegistrationWeb } = await import("./registration-web-integration.mjs");
    await testRegistrationWeb(suite, db, env);
    const cert = join(certificates, "server.crt");
    const key = join(certificates, "server.key");
    const installCertificate = async (subjectAltName) => {
      await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=blizhniy-integration", "-addext", `subjectAltName=${subjectAltName}`,
        "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", key, "-out", cert], { timeout: 10000 });
      // docker cp writes to the container layer, not a live tmpfs mount.
      await docker(["cp", cert, `${id}:/tmp/blizhniy-server.crt`]);
      await docker(["cp", key, `${id}:/tmp/blizhniy-server.key`]);
      await docker(["exec", "--user", "0", id, "cp", "/tmp/blizhniy-server.crt", "/var/lib/postgresql/server.crt"]);
      await docker(["exec", "--user", "0", id, "cp", "/tmp/blizhniy-server.key", "/var/lib/postgresql/server.key"]);
      await docker(["exec", "--user", "0", id, "chown", "postgres:postgres", "/var/lib/postgresql/server.key"]);
      await docker(["exec", "--user", "0", id, "chmod", "600", "/var/lib/postgresql/server.key"]);
    };
    await installCertificate("IP:127.0.0.1");
    await db.query("alter system set ssl_cert_file = '/var/lib/postgresql/server.crt'");
    await db.query("alter system set ssl_key_file = '/var/lib/postgresql/server.key'");
    await db.query("alter system set ssl = 'on'");
    await db.query("select pg_reload_conf()");
    const tlsEnv = { ...env, NODE_ENV: "production", BLIZHNIY_DB_SSL_MODE: "verify-full", BLIZHNIY_DB_CA_FILE: cert };
    const tlsDb = createPostgresDatabase(tlsEnv);
    try {
      await suite.test("production-mode client verifies CA and IP identity over real PostgreSQL TLS", async () => {
        // Reload happens asynchronously; wait on the existing local connection.
        for (let attempt = 0; attempt < 20; attempt++) {
          if ((await db.query("select current_setting('ssl') as ssl")).rows[0].ssl === "on") break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const result = await tlsDb.query("select ssl from pg_catalog.pg_stat_ssl where pid = pg_backend_pid()");
        assert.equal(result.rows[0].ssl, true);
      });
    } finally { await tlsDb.close(); }
    await suite.test("an unrelated CA cannot authenticate the server", async () => {
      const wrongCa = join(certificates, "wrong-ca.crt");
      writeFileSync(wrongCa, rootCertificates[0]);
      const invalid = createPostgresDatabase({ ...tlsEnv, BLIZHNIY_DB_CA_FILE: wrongCa });
      try { await assert.rejects(invalid.query("select 1"), { message: "PostgreSQL operation failed", code: "DEPTH_ZERO_SELF_SIGNED_CERT" }); }
      finally { await invalid.close(); }
    });
    await suite.test("a trusted CA with the wrong server identity is still rejected", async () => {
      await installCertificate("DNS:not-this-database.invalid");
      await db.query("select pg_reload_conf()");
      // SIGHUP certificate reload is asynchronous; this wait stays inside the test.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const invalid = createPostgresDatabase(tlsEnv);
      try { await assert.rejects(invalid.query("select 1"), { message: "PostgreSQL operation failed", code: "ERR_TLS_CERT_ALTNAME_INVALID" }); }
      finally { await invalid.close(); }
    });
  } finally {
    try { if (db) await db.close(); }
    finally {
      rmSync(certificates, { recursive: true, force: true });
      if (id) {
        const inspect = JSON.parse(await docker(["inspect", id]))[0];
        if (inspect.Id !== id || inspect.Name !== `/${name}` || inspect.Config.Labels[label] !== name) {
          throw new Error("Refusing to remove a foreign container");
        }
        await docker(["rm", "--force", id]); // Only this test's synthetic, tmpfs-backed container.
      }
    }
  }
});
