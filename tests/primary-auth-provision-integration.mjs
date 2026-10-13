import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { provisionPrimaryAuth, verifyPrimaryAuthRuntime } from "../scripts/provision-primary-auth.mjs";
import { createPostgresDatabase } from "../src/lib/postgres.ts";
import { RegistrationStore, PasswordRecoveryStore } from "./auth-mail-module.mjs";
import { IdentityStore } from "../src/lib/identity.ts";
import { MailPayloadCipher, pruneExpiredMail } from "../src/lib/mail-outbox.ts";
import { MailDeliveryWorker } from "../src/lib/mail-delivery.ts";
import { verifyProductionAuthDatabase } from "../src/lib/production-auth-database.ts";
import { runAuthMailWorker } from "../scripts/auth-mail-worker-runtime.mjs";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { PostgresCatalogRepository } from "./catalog-module.mjs";
import { PostgresTariffRepository } from "../src/lib/postgres-tariffs.ts";
import { testRestrictedReadiness } from "./readiness-postgres-integration.mjs";

export async function testPrimaryAuthProvision(suite, config, administrator) {
  const directory = mkdtempSync(join(tmpdir(), "blizhniy-primary-auth-fixture-"));
  const file = join(directory, "runtime.json");
  const target = `${config.host}:${config.database}`;
  let client, db, credentials, authCipher;
  try {
    await suite.test("primary profile creates a private credential and grants only the Auth/queue surface", async () => {
      assert.deepEqual(await provisionPrimaryAuth(config, target, file, "test"), { database: config.database, runtime: "blizhniy_runtime", restricted: true });
      credentials = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(JSON.stringify(credentials).includes(config.password), false);
      client = new pg.Client({ ...config, ...credentials }); await client.connect();
      assert.equal((await verifyPrimaryAuthRuntime(client, config.user)).restricted, true);
      assert.equal((await client.query("select count(*)::integer as n from app.categories")).rows[0].n, 105);
      await assert.rejects(client.query("select * from blizhniy_meta.migrations limit 0"), { code: "42501" });
      await assert.rejects(client.query("select * from app.media_write_attempts limit 0"), { code: "42501" });
      db = createPostgresDatabase({ NODE_ENV: "test", BLIZHNIY_DB_HOST: config.host, BLIZHNIY_DB_PORT: String(config.port),
        BLIZHNIY_DB_NAME: config.database, BLIZHNIY_DB_USER: credentials.user, BLIZHNIY_DB_PASSWORD: credentials.password, BLIZHNIY_DB_SSL_MODE: "disable" });
    });
    await testRestrictedReadiness(suite, db);
    await suite.test("restricted primary role reads public reference projections without owner credentials or static tariff identities", async () => {
      const catalog = await new PostgresCatalogRepository(db).getPublicCategories();
      const tariffs = await new PostgresTariffRepository(db).getPublicTariffs();
      assert.equal(catalog.length, 18);
      assert.ok(catalog.every(row => Object.keys(row).sort().join() === "children,name,slug"));
      assert.equal(tariffs.length, 7);
      const stored = (await client.query("select id,price::text from app.tariffs order by app.tariffs.price,id")).rows;
      assert.deepEqual(tariffs.map(row => ({ id: row.id, price: row.price })), stored.map(row => ({ id: row.id, price: Number(row.price) })));
      await assert.rejects(client.query("update app.tariffs set price=0 where false"), { code: "42501" });
    });
    await suite.test("real restricted-role signup, queued delivery, confirmation, login and password reset need no INSERT/UPDATE role permission", async () => {
      const cipher = new MailPayloadCipher(randomBytes(32));
      authCipher = cipher;
      const registration = new RegistrationStore(db, cipher), identity = new IdentityStore(db), recovery = new PasswordRecoveryStore(db, cipher);
      const email = "primary-runtime@example.invalid", password = "Synthetic primary runtime passphrase!";
      const receipt = await registration.register({ email, password, acceptedAgreement: true, acknowledgedPrivacy: true,
        agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy });
      assert.ok(receipt);
      const messages = [];
      const worker = new MailDeliveryWorker(db, cipher, (intent, payload) => ({ id: intent.id, to: payload.email, subject: "Owned test mail", text: payload.token ?? "Changed" }));
      await worker.runOne({ send: async message => { messages.push(message); } });
      assert.equal(messages.length, 1);
      assert.equal(messages[0].text, receipt.token);
      assert.equal(await registration.confirmEmail(receipt.token), true);
      const session = await identity.login(email, password);
      assert.ok(session); assert.equal(session.user.role, "user");
      const link = await recovery.requestRecovery(email);
      assert.ok(link);
      await recovery.resetPassword({ token: link.token, password: "Replacement primary runtime passphrase!" });
      assert.equal(await identity.resolveSession(session.token), null);
      assert.equal(await identity.login(email, password), null);
      assert.ok(await identity.login(email, "Replacement primary runtime passphrase!"));
      await assert.rejects(client.query("update app.users set role='admin' where email=$1", [email]), { code: "42501" });
      assert.equal((await client.query("select role from app.users where email=$1", [email])).rows[0].role, "user");
    });
    await suite.test("bounded scheduler runs the real queue with restricted PostgreSQL rights, logs only counts and releases its own pool", async () => {
      const receipt = await new RegistrationStore(db, authCipher).register({ email: "scheduled-runtime@example.invalid", password: "Synthetic scheduler passphrase!",
        acceptedAgreement: true, acknowledgedPrivacy: true, agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement,
        privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy });
      assert.ok(receipt);
      const messages = [], events = [];
      let closed = false, batch;
      try {
        const exitCode = await runAuthMailWorker({ mode: "run", entryPoint: "systemd", report: event => events.push(event), createRuntime: async () => {
          batch = createPostgresDatabase({ NODE_ENV: "test", BLIZHNIY_DB_HOST: config.host, BLIZHNIY_DB_PORT: String(config.port),
            BLIZHNIY_DB_NAME: config.database, BLIZHNIY_DB_USER: credentials.user, BLIZHNIY_DB_PASSWORD: credentials.password, BLIZHNIY_DB_SSL_MODE: "disable" });
          await verifyProductionAuthDatabase(batch);
          return { worker: new MailDeliveryWorker(batch, authCipher, (intent, payload) => ({ id: intent.id, to: payload.email, subject: "Owned scheduler fixture", text: payload.token ?? "Changed" })),
            mailer: { verify: async () => true, send: async message => { messages.push(message); } }, prune: () => pruneExpiredMail(batch, 100),
            close: async () => { await batch.close(); closed = true; } };
        } });
        assert.equal(exitCode, 0); assert.equal(closed, true);
        assert.ok(messages.some(message => message.text === receipt.token));
        assert.equal(events[0].status, "complete"); assert.equal(events[0].entryPoint, "systemd");
        assert.equal(events[0].outcomes.accepted, 2);
        for (const secret of [receipt.token, "scheduled-runtime@example.invalid", credentials.password]) assert.equal(JSON.stringify(events).includes(secret), false);
        assert.equal(await new RegistrationStore(db, authCipher).confirmEmail(receipt.token), true);
      } finally { if (batch && !closed) await batch.close(); }
    });
    await suite.test("future operator-owned functions do not silently inherit PUBLIC EXECUTE", async () => {
      await administrator.query("create function app.primary_future_permission_probe() returns integer language sql as 'select 1'");
      await assert.rejects(client.query("select app.primary_future_permission_probe()"), { code: "42501" });
      assert.equal((await verifyPrimaryAuthRuntime(client, config.user)).restricted, true);
    });
    await suite.test("repeated primary provisioning refuses adoption or secret rotation", async () => {
      const before = readFileSync(file, "utf8");
      await assert.rejects(provisionPrimaryAuth(config, target, file, "test"), /preflight/);
      assert.equal(readFileSync(file, "utf8"), before);
      assert.equal((await verifyPrimaryAuthRuntime(client, config.user)).restricted, true);
    });
    return credentials;
  } finally {
    await db?.close(); await client?.end();
    rmSync(directory, { recursive: true });
    // Role and all synthetic records disappear with the owned parent container.
  }
}

export async function testPrimaryProfileGrants(suite, config, administrator, credentials) {
  const { provisionPrimaryProfiles, verifyPrimaryProfilesRuntime } = await import("../scripts/provision-primary-auth.mjs");
  const target = `${config.host}:${config.database}`;
  let client, db;
  const passwordHash = (await administrator.query("select rolpassword from pg_authid where rolname='blizhniy_runtime'")).rows[0].rolpassword;
  try {
    await suite.test("profile grants reject a mismatched migration hash without changing privileges", async () => {
      const name = "0011-cabinet-profiles.sql";
      const hash = (await administrator.query("select sha256 from blizhniy_meta.migrations where name=$1", [name])).rows[0].sha256;
      await administrator.query("update blizhniy_meta.migrations set sha256=$1 where name=$2", ["0".repeat(64), name]);
      try { await assert.rejects(provisionPrimaryProfiles(config, target, credentials, "test"), /preflight/); }
      finally { await administrator.query("update blizhniy_meta.migrations set sha256=$1 where name=$2", [hash, name]); }
      assert.equal((await administrator.query("select has_table_privilege('blizhniy_runtime','app.cabinet_profiles','SELECT') as allowed")).rows[0].allowed, false);
    });
    await suite.test("explicit profile grants are repeatable without rotating credentials or changing the schema", async () => {
      const journal = (await administrator.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
      for (let i = 0; i < 2; i++) assert.deepEqual(await provisionPrimaryProfiles(config, target, credentials, "test"),
        { database: config.database, runtime: "blizhniy_runtime", profiles: true, restricted: true });
      assert.deepEqual((await administrator.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows, journal);
      assert.equal((await administrator.query("select rolpassword from pg_authid where rolname='blizhniy_runtime'")).rows[0].rolpassword, passwordHash);
      client = new pg.Client({ ...config, ...credentials }); await client.connect();
      assert.deepEqual(await verifyPrimaryProfilesRuntime(client, config.user), { restricted: true });
    });
    await suite.test("unexpected owner-update privileges are refused rather than silently repaired", async () => {
      await administrator.query("grant update(user_id) on app.cabinet_profiles to blizhniy_runtime");
      try {
        await assert.rejects(provisionPrimaryProfiles(config, target, credentials, "test"), /preflight/);
        await assert.rejects(verifyPrimaryProfilesRuntime(client, config.user), /Invalid primary profile privileges/);
        assert.equal((await administrator.query("select has_column_privilege('blizhniy_runtime','app.cabinet_profiles','user_id','UPDATE') as allowed")).rows[0].allowed, true);
      } finally { await administrator.query("revoke update(user_id) on app.cabinet_profiles from blizhniy_runtime"); }
    });
    await suite.test("extra trigger/reference/maintenance and grant-option powers are rejected", async () => {
      for (const privilege of ["TRIGGER", "REFERENCES", "MAINTAIN", "SELECT WITH GRANT OPTION"]) {
        await administrator.query(`grant ${privilege.replace(" WITH GRANT OPTION", "")} on app.cabinet_profiles to blizhniy_runtime${privilege.endsWith(" WITH GRANT OPTION") ? " with grant option" : ""}`);
        try {
          await assert.rejects(provisionPrimaryProfiles(config, target, credentials, "test"), /preflight/);
          await assert.rejects(verifyPrimaryProfilesRuntime(client, config.user), /Invalid primary profile privileges/);
        } finally {
          await administrator.query(privilege.endsWith(" WITH GRANT OPTION")
            ? "revoke grant option for select on app.cabinet_profiles from blizhniy_runtime"
            : `revoke ${privilege} on app.cabinet_profiles from blizhniy_runtime`);
        }
      }
    });
    await suite.test("lost profile-grant COMMIT acknowledgement fails safely without automatic retry", async () => {
      const query = pg.Client.prototype.query;
      let commits = 0;
      pg.Client.prototype.query = async function (sql, ...args) {
        const result = await query.call(this, sql, ...args);
        if (this.connectionParameters.application_name === "blizhniy-primary-profile-grants" && sql === "commit") {
          commits++;
          throw Object.assign(new Error("synthetic transport details must not escape"), { code: "ECONNRESET" });
        }
        return result;
      };
      try {
        await assert.rejects(provisionPrimaryProfiles(config, target, credentials, "test"), error => {
          assert.match(error.message, /during grants/);
          assert.equal(error.message.includes("synthetic transport"), false);
          assert.equal(error.message.includes(credentials.password), false);
          return true;
        });
      } finally { pg.Client.prototype.query = query; }
      assert.equal(commits, 1);
      assert.deepEqual(await verifyPrimaryProfilesRuntime(client, config.user), { restricted: true });
    });
    await suite.test("restricted runtime saves a profile through the real store but cannot change its owner or delete it", async () => {
      db = createPostgresDatabase({ NODE_ENV: "test", BLIZHNIY_DB_HOST: config.host, BLIZHNIY_DB_PORT: String(config.port),
        BLIZHNIY_DB_NAME: config.database, BLIZHNIY_DB_USER: credentials.user, BLIZHNIY_DB_PASSWORD: credentials.password, BLIZHNIY_DB_SSL_MODE: "disable" });
      const { loadProfileModule } = await import("./production-profile-module.mjs");
      const { PostgresProfileStore, parseProductionProfile } = loadProfileModule("postgres-profile");
      const session = await new IdentityStore(db).login("primary-runtime@example.invalid", "Replacement primary runtime passphrase!");
      assert.ok(session);
      const store = new PostgresProfileStore(db);
      assert.equal((await store.read(session.token, session.user.id)).exists, false);
      await store.write(session.token, session.user.id, parseProductionProfile({ name: "Restricted profile", organizationName: "Synthetic company" }));
      await store.write(session.token, session.user.id, parseProductionProfile({ name: "Updated restricted profile" }));
      assert.equal((await store.read(session.token, session.user.id)).profile.name, "Updated restricted profile");
      await assert.rejects(client.query("update app.cabinet_profiles set user_id=user_id where false"), { code: "42501" });
      await assert.rejects(client.query("delete from app.cabinet_profiles where false"), { code: "42501" });
      await assert.rejects(client.query("truncate app.cabinet_profiles"), { code: "42501" });
      assert.equal((await store.read(session.token, session.user.id)).profile.name, "Updated restricted profile");
    });
  } finally { await db?.close(); await client?.end(); }
}
