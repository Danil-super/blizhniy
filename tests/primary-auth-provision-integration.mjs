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
import { MailPayloadCipher } from "../src/lib/mail-outbox.ts";
import { MailDeliveryWorker } from "../src/lib/mail-delivery.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";

export async function testPrimaryAuthProvision(suite, config, administrator) {
  const directory = mkdtempSync(join(tmpdir(), "blizhniy-primary-auth-fixture-"));
  const file = join(directory, "runtime.json");
  const target = `${config.host}:${config.database}`;
  let client, db, credentials;
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
    await suite.test("real restricted-role signup, queued delivery, confirmation, login and password reset need no INSERT/UPDATE role permission", async () => {
      const cipher = new MailPayloadCipher(randomBytes(32));
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
  } finally {
    await db?.close(); await client?.end();
    rmSync(directory, { recursive: true });
    // Role and all synthetic records disappear with the owned parent container.
  }
}
