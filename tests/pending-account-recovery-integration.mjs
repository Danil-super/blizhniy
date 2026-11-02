// Explicit isolated fixture: no dotenv, existing databases, shared containers or SMTP.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { promisify } from "node:util";
import pg from "pg";
import { bootstrapPostgres } from "../scripts/bootstrap-postgres.mjs";
import { provisionPrimaryAuth, provisionPrimaryProfiles } from "../scripts/provision-primary-auth.mjs";
import { createPostgresDatabase } from "../src/lib/postgres.ts";
import { MailPayloadCipher, pruneExpiredMail } from "../src/lib/mail-outbox.ts";
import { MailDeliveryWorker } from "../src/lib/mail-delivery.ts";
import { IdentityStore, hashSessionToken } from "../src/lib/identity.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { RegistrationStore, PasswordRecoveryStore } from "./auth-mail-module.mjs";
import { verifyProductionAuthDatabase } from "../src/lib/production-auth-database.ts";

const run = promisify(execFile);
const image = "postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873";
const name = `blizhniy-pending-recovery-${randomBytes(8).toString("hex")}`;
const label = "blizhniy.pending-recovery-integration";
const password = randomBytes(24).toString("hex");
const docker = async args => (await run("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
  env: { PATH: process.env.PATH, LANG: "C.UTF-8", POSTGRES_PASSWORD: password }, timeout: 20000, maxBuffer: 1024 * 1024,
})).stdout.trim();
const originalPassword = "Synthetic pending registration passphrase!";
const replacementPassword = "Synthetic mailbox owner replacement passphrase!";
const input = () => ({ email: `pending-${randomUUID()}@example.invalid`, password: originalPassword,
  acceptedAgreement: true, acknowledgedPrivacy: true,
  agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy });

test("pending mailbox recovery: real restricted PostgreSQL 18.6 transactions", { timeout: 180000 }, async suite => {
  const directory = mkdtempSync(join(tmpdir(), "blizhniy-pending-recovery-"));
  let id, admin, db;
  try {
    id = await docker(["run", "--detach", "--pull", "never", "--name", name, "--label", `${label}=${name}`,
      "--memory", "512m", "--cpus", "1", "--tmpfs", "/var/lib/postgresql:rw,size=268435456",
      "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=blizhniy_test", image]);
    assert.match(id, /^[a-f0-9]{64}$/);
    const metadata = JSON.parse(await docker(["inspect", id]))[0];
    assert.equal(metadata.Config.Labels[label], name);
    assert.equal(metadata.Config.Image, image);
    const binding = metadata.NetworkSettings.Ports["5432/tcp"][0];
    assert.equal(binding.HostIp, "127.0.0.1");
    const config = { host: "127.0.0.1", port: Number(binding.HostPort), database: "blizhniy_test", user: "postgres", password, ssl: false };
    const deadline = Date.now() + 20000;
    for (;;) {
      try { await docker(["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "blizhniy_test"]); break; }
      catch { if (Date.now() > deadline) throw new Error("Owned PostgreSQL fixture did not start"); }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    admin = new pg.Client(config); await admin.connect();
    assert.match((await admin.query("show server_version")).rows[0].server_version, /^18\.6/);
    await bootstrapPostgres(admin, "127.0.0.1:blizhniy_test", { includeMail: true });
    const credentialFile = join(directory, "runtime.json");
    await provisionPrimaryAuth(config, "127.0.0.1:blizhniy_test", credentialFile, "test");
    const credentials = JSON.parse(readFileSync(credentialFile, "utf8"));
    await bootstrapPostgres(admin, "127.0.0.1:blizhniy_test", { includeProfiles: true });
    await provisionPrimaryProfiles(config, "127.0.0.1:blizhniy_test", credentials, "test");
    await bootstrapPostgres(admin, "127.0.0.1:blizhniy_test", { includeConfirmationNotice: true });
    db = createPostgresDatabase({ NODE_ENV: "test", BLIZHNIY_DB_HOST: config.host, BLIZHNIY_DB_PORT: String(config.port),
      BLIZHNIY_DB_NAME: config.database, BLIZHNIY_DB_USER: credentials.user,
      BLIZHNIY_DB_PASSWORD: credentials.password, BLIZHNIY_DB_SSL_MODE: "disable" });
    const cipherKey = randomBytes(32);
    const cipher = new MailPayloadCipher(cipherKey);
    const registration = new RegistrationStore(db, cipher, { confirmationNotice: true });
    const recovery = new PasswordRecoveryStore(db, cipher, { pendingAccounts: true });
    const identity = new IdentityStore(db);
    const renderer = (intent, payload) => ({ id: intent.id, to: payload.email, subject: "Synthetic recovery", text: payload.token ?? "Changed" });
    const worker = new MailDeliveryWorker(db, cipher, renderer, { pendingAccounts: true });
    const user = async email => (await admin.query("select * from app.users where email=$1", [email])).rows[0];
    const clear = async account => admin.query("delete from app.users where id=$1", [account.id]);
    const snapshot = async account => ({
      user: (await admin.query("select * from app.users where id=$1", [account.id])).rows[0],
      legal: (await admin.query("select * from app.registration_legal where user_id=$1 order by document", [account.id])).rows,
      profile: (await admin.query("select * from app.cabinet_profiles where user_id=$1", [account.id])).rows,
      confirmations: (await admin.query("select * from app.email_confirmations where user_id=$1", [account.id])).rows,
      sessions: (await admin.query("select * from app.sessions where user_id=$1 order by token_hash", [account.id])).rows,
    });
    const fixture = async work => {
      const request = { ...input(), name: "Synthetic mailbox owner" };
      const confirmation = await registration.register(request);
      assert.ok(confirmation);
      const account = await user(request.email);
      try { await work({ request, confirmation, account }); }
      finally { await clear(account); }
    };
    const jobs = async account => (await db.query("select * from app.mail_outbox where user_id=$1 order by available_at,id", [account.id])).rows;
    const removeJobs = account => admin.query("delete from app.mail_outbox where user_id=$1", [account.id]);
    const recoverySource = async account => (await db.query("select * from app.password_recoveries where user_id=$1", [account.id])).rows[0];

    await suite.test("explicit opt-in issues recovery for an unblocked pending mailbox without confirming it", async () => {
      const request = input();
      const confirmation = await registration.register(request);
      assert.ok(confirmation);
      const before = await user(request.email);
      const link = await recovery.requestRecovery(request.email);
      assert.ok(link, "pendingAccounts:true must issue a recovery link for an unblocked pending account");
      assert.deepEqual(await user(request.email), before);
      assert.equal(await identity.resolveSession(link.token), null);
      assert.equal((await db.query("select token_hash from app.password_recoveries where user_id=$1", [before.id])).rows[0].token_hash, hashSessionToken(link.token));
      await clear(before);
    });

    await suite.test("pending request preserves password, legal marks, profile, confirmation and sessions; uses existing 256-bit/30-minute encrypted recovery", async () => fixture(async ({ request, account }) => {
      const before = await snapshot(account);
      assert.equal(await new PasswordRecoveryStore(db, cipher).requestRecovery(request.email), null);
      const link = await recovery.requestRecovery(` ${request.email.toUpperCase()} `);
      assert.ok(link); assert.match(link.token, /^[a-f0-9]{64}$/);
      assert.deepEqual(await snapshot(account), before);
      const source = await recoverySource(account);
      assert.equal(source.expires_at.getTime() - source.created_at.getTime(), 30 * 60 * 1000);
      assert.equal(source.token_hash, hashSessionToken(link.token));
      assert.equal(source.email, request.email); assert.equal(source.auth_version, account.auth_version);
      const queued = (await jobs(account)).find(row => row.purpose === "recover");
      assert.ok(queued); assert.equal(queued.payload.includes(Buffer.from(link.token)), false);
      assert.equal(queued.payload.includes(Buffer.from(request.email)), false);
      assert.equal(await identity.login(request.email, originalPassword), null);
      assert.equal(await identity.resolveSession(link.token), null);
      assert.equal(await identity.resolveDataSubjectSession(link.token), null);
    }));

    await suite.test("opt-in worker delivers pending recovery only after source validation; default worker remains verified-only", async () => fixture(async ({ request, account }) => {
      await removeJobs(account);
      const first = await recovery.requestRecovery(request.email);
      const legacyWorker = new MailDeliveryWorker(db, cipher, renderer);
      assert.equal((await legacyWorker.runOne({ send: async () => assert.fail("legacy worker sent pending recovery") })).state, "cancelled");
      const link = await recovery.requestRecovery(request.email);
      assert.notEqual(first.token, link.token);
      const messages = [];
      assert.equal((await worker.runOne({ send: async message => messages.push(message) })).state, "accepted");
      assert.equal(messages.length, 1); assert.equal(messages[0].to, request.email); assert.equal(messages[0].text, link.token);
      assert.equal((await user(request.email)).email_verified_at, null);
    }));

    await suite.test("mailbox owner resets and confirms atomically; duplicate signup, old password, old confirmation and all sessions lose authority", async () => fixture(async ({ request, confirmation, account }) => {
      const before = await snapshot(account);
      const link = await recovery.requestRecovery(request.email);
      assert.equal(await registration.register({ ...request, password: replacementPassword, name: "Attempted duplicate override" }), null);
      assert.deepEqual(await snapshot(account), before);
      const staleSessions = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];
      for (let index = 0; index < staleSessions.length; index++) await admin.query(
        "insert into app.sessions(token_hash,user_id,auth_version,scope) values($1,$2,$3,$4)",
        [hashSessionToken(staleSessions[index]), account.id, account.auth_version, index ? "data-subject" : "app"]);
      const receipt = await recovery.resetPassword({ token: link.token, password: replacementPassword });
      assert.deepEqual(receipt, { email: request.email });
      const after = await snapshot(account);
      assert.ok(after.user.email_verified_at instanceof Date);
      assert.notEqual(after.user.password_hash, before.user.password_hash);
      assert.equal(BigInt(after.user.auth_version), BigInt(before.user.auth_version) + 1n);
      assert.equal(after.user.role, before.user.role); assert.equal(after.user.is_blocked, false);
      assert.equal(after.user.created_at.getTime(), before.user.created_at.getTime());
      assert.deepEqual(after.legal, before.legal); assert.deepEqual(after.profile, before.profile);
      assert.deepEqual(after.confirmations, []); assert.deepEqual(after.sessions, []);
      assert.equal(await registration.confirmEmail(confirmation.token), false);
      assert.equal(await registration.resendConfirmation(request.email, originalPassword), null);
      assert.equal(await registration.resendConfirmation(request.email, replacementPassword), null);
      assert.equal(await recovery.resetPassword({ token: link.token, password: originalPassword }), null);
      assert.equal(await identity.login(request.email, originalPassword), null);
      assert.equal(await identity.loginForDataSubject(request.email, originalPassword), null);
      for (const token of staleSessions) {
        assert.equal(await identity.resolveSession(token), null);
        assert.equal(await identity.resolveDataSubjectSession(token), null);
      }
      assert.equal(await identity.resolveSession(link.token), null);
      assert.ok(await identity.login(request.email, replacementPassword));
      assert.equal((await jobs(account)).filter(row => row.purpose === "reset_notice").length, 1);
    }));

    await suite.test("enabled confirmed recovery preserves verification timestamp; blocked confirmed reset preserves block and subject-only access", async () => {
      for (const blocked of [false, true]) await fixture(async ({ request, confirmation, account }) => {
        assert.equal(await registration.confirmEmail(confirmation.token), true);
        if (blocked) await admin.query("update app.users set is_blocked=true where id=$1", [account.id]);
        await removeJobs(account);
        const before = await user(request.email);
        const oldSession = blocked ? await identity.loginForDataSubject(request.email, originalPassword) : await identity.login(request.email, originalPassword);
        const link = await recovery.requestRecovery(request.email);
        assert.ok(link);
        assert.equal((await worker.runOne({ send: async message => assert.equal(message.text, link.token) })).state, "accepted");
        assert.deepEqual(await recovery.resetPassword({ token: link.token, password: replacementPassword }), { email: request.email });
        const after = await user(request.email);
        assert.equal(after.email_verified_at.getTime(), before.email_verified_at.getTime());
        assert.equal(after.is_blocked, blocked);
        assert.equal(await identity.resolveDataSubjectSession(oldSession.token), null);
        assert.equal(Boolean(await identity.login(request.email, replacementPassword)), !blocked);
        assert.ok(await identity.loginForDataSubject(request.email, replacementPassword));
      });
    });

    await suite.test("recovery, confirmation and session tokens cannot substitute for each other; weak reset and legacy pending reset consume nothing", async () => fixture(async ({ request, confirmation, account }) => {
      const link = await recovery.requestRecovery(request.email);
      const before = await snapshot(account);
      assert.equal(await registration.confirmEmail(link.token), false);
      assert.equal(await recovery.resetPassword({ token: confirmation.token, password: replacementPassword }), null);
      assert.equal(await recovery.resetPassword({ token: hashSessionToken(link.token), password: replacementPassword }), null);
      assert.equal(await recovery.resetPassword({ token: "malformed", password: replacementPassword }), null);
      assert.equal(await new PasswordRecoveryStore(db, cipher).resetPassword({ token: link.token, password: replacementPassword }), null);
      await assert.rejects(recovery.resetPassword({ token: link.token, password: "weak" }), /Invalid password/);
      const session = randomBytes(32).toString("hex");
      await admin.query("insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,$3)", [hashSessionToken(session), account.id, account.auth_version]);
      assert.equal(await recovery.resetPassword({ token: session, password: replacementPassword }), null);
      await admin.query("delete from app.sessions where user_id=$1", [account.id]);
      assert.deepEqual(await snapshot(account), before);
      assert.equal((await recoverySource(account)).token_hash, hashSessionToken(link.token));
      assert.ok(await recovery.resetPassword({ token: link.token, password: replacementPassword }));
    }));

    await suite.test("blocked pending accounts cannot request, confirm or redeem; a block introduced after issue also cancels delivery", async () => fixture(async ({ request, confirmation, account }) => {
      await removeJobs(account);
      const link = await recovery.requestRecovery(request.email);
      await admin.query("update app.users set is_blocked=true where id=$1", [account.id]);
      const before = await snapshot(account);
      assert.equal(await recovery.requestRecovery(request.email), null);
      assert.equal(await registration.confirmEmail(confirmation.token), false);
      assert.equal(await recovery.resetPassword({ token: link.token, password: replacementPassword }), null);
      assert.equal((await worker.runOne({ send: async () => assert.fail("blocked pending recovery delivered") })).state, "cancelled");
      assert.deepEqual(await snapshot(account), before);
      assert.equal(await identity.loginForDataSubject(request.email, originalPassword), null);
    }));

    await suite.test("rotated, expired, stale-email, stale-version and demoted-confirmed links cannot reset or dispatch", async () => {
      for (const mutation of ["rotation", "expired", "email", "version", "demotion", "source-missing", "source-expiry-mismatch"]) await fixture(async ({ request, confirmation, account }) => {
        if (mutation === "demotion") assert.equal(await registration.confirmEmail(confirmation.token), true);
        await removeJobs(account);
        const link = await recovery.requestRecovery(request.email);
        if (mutation === "rotation") await recovery.requestRecovery(request.email);
        if (mutation === "expired") await admin.query("update app.password_recoveries set created_at=clock_timestamp()-interval '30 minutes',expires_at=clock_timestamp()-interval '1 minute' where user_id=$1", [account.id]);
        if (mutation === "email") await admin.query("update app.users set email=$2 where id=$1", [account.id, `changed-${randomUUID()}@example.invalid`]);
        if (mutation === "version") await admin.query("update app.users set auth_version=auth_version+1 where id=$1", [account.id]);
        if (mutation === "demotion") {
          const version = (await user(request.email)).auth_version;
          await admin.query("update app.users set email_verified_at=null where id=$1", [account.id]);
          assert.equal(BigInt((await user(request.email)).auth_version), BigInt(version) + 1n);
        }
        if (mutation === "source-missing") await admin.query("delete from app.password_recoveries where user_id=$1", [account.id]);
        if (mutation === "source-expiry-mismatch") await admin.query("update app.password_recoveries set expires_at=expires_at-interval '1 minute' where user_id=$1", [account.id]);
        const before = await snapshot(account);
        assert.equal((await worker.runOne({ send: async () => assert.fail(`${mutation} stale recovery delivered`) })).state, "cancelled", mutation);
        // A changed source expiry remains a valid token for redemption, but cannot authenticate the queued payload.
        if (mutation !== "source-expiry-mismatch") assert.equal(await recovery.resetPassword({ token: link.token, password: replacementPassword }), null, mutation);
        assert.deepEqual(await snapshot(account), before, mutation);
      });
    });

    await suite.test("bounded prune retains live pending recovery and removes expired, stale-version and blocked pending links", async () => {
      const owned = [];
      try {
        for (const kind of ["valid", "expired", "version", "blocked"]) {
          const request = input(); await registration.register(request);
          const account = await user(request.email); owned.push(account);
          await recovery.requestRecovery(request.email);
          if (kind === "expired") await admin.query("update app.password_recoveries set created_at=clock_timestamp()-interval '30 minutes',expires_at=clock_timestamp()-interval '1 minute' where user_id=$1", [account.id]);
          if (kind === "version") await admin.query("update app.users set auth_version=auth_version+1 where id=$1", [account.id]);
          if (kind === "blocked") await admin.query("update app.users set is_blocked=true where id=$1", [account.id]);
        }
        assert.equal(await recovery.pruneRecoveries(), 3);
        assert.ok(await recoverySource(owned[0]));
        for (const account of owned.slice(1)) assert.equal(await recoverySource(account), undefined);
      } finally { for (const account of owned) await clear(account); }
    });

    await suite.test("database outbox failures roll back pending request rotation and every reset effect", async () => fixture(async ({ request, confirmation, account }) => {
      const first = await recovery.requestRecovery(request.email);
      for (const scope of ["app", "data-subject"]) await admin.query(
        "insert into app.sessions(token_hash,user_id,auth_version,scope) values($1,$2,$3,$4)",
        [hashSessionToken(randomBytes(32).toString("hex")), account.id, account.auth_version, scope]);
      const before = await snapshot(account), sourceBefore = await recoverySource(account), jobsBefore = await jobs(account);
      await admin.query("create function app.pending_recovery_failure_probe() returns trigger language plpgsql as $$ begin if new.user_id=TG_ARGV[0]::uuid and new.purpose=TG_ARGV[1] then raise exception 'Synthetic pending recovery outbox failure' using errcode='23514'; end if; return new; end $$");
      const installFailure = async purpose => {
        await admin.query(`create trigger pending_recovery_failure_probe before insert on app.mail_outbox for each row execute function app.pending_recovery_failure_probe('${account.id}','${purpose}')`);
      };
      try {
        await installFailure("recover");
        await assert.rejects(recovery.requestRecovery(request.email), { code: "23514" });
        assert.deepEqual(await snapshot(account), before); assert.deepEqual(await recoverySource(account), sourceBefore);
        assert.deepEqual(await jobs(account), jobsBefore);
        await admin.query("drop trigger pending_recovery_failure_probe on app.mail_outbox");
        await installFailure("reset_notice");
        await assert.rejects(recovery.resetPassword({ token: first.token, password: replacementPassword }), { code: "23514" });
        assert.deepEqual(await snapshot(account), before); assert.deepEqual(await recoverySource(account), sourceBefore);
        assert.deepEqual(await jobs(account), jobsBefore);
      } finally {
        await admin.query("drop trigger if exists pending_recovery_failure_probe on app.mail_outbox");
        await admin.query("drop function app.pending_recovery_failure_probe()");
      }
      assert.equal(await registration.confirmEmail(confirmation.token), true, "failed reset preserved old confirmation");
      assert.ok(await recovery.resetPassword({ token: first.token, password: replacementPassword }));
    }));

    await suite.test("actual standalone production mail composition delivers pending recovery through the real worker and restricted database", async () => fixture(async ({ request, account }) => {
      await removeJobs(account);
      const link = await recovery.requestRecovery(request.email);
      const messages = [], exports = {};
      const require = createRequire(import.meta.url), ts = require("typescript");
      const source = readFileSync(new URL("../src/lib/production-mail-runtime.ts", import.meta.url), "utf8");
      const dependencies = {
        "./postgres.ts": { createPostgresDatabase: () => db },
        "./mail-outbox.ts": { MailPayloadCipher, pruneExpiredMail },
        "./mail-delivery.ts": { MailDeliveryWorker },
        "./timeweb-mail.ts": { createTimewebMailer: () => ({ send: async message => messages.push(message) }) },
        "./production-auth-config.ts": { readProductionAuthConfig: () => ({ mailKeyFile: "synthetic-owned-key", rateSecret: "f".repeat(64) }),
          readMailEncryptionKey: () => Buffer.from(cipherKey), renderProductionAuthMail: renderer },
        "./production-auth-database.ts": { verifyProductionAuthDatabase },
      };
      new Function("require", "exports", ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText)(specifier => {
        if (!Object.hasOwn(dependencies, specifier)) throw new Error("Unapproved standalone runtime test dependency");
        return dependencies[specifier];
      }, exports);
      const runtime = await exports.createProductionMailRuntime({ NODE_ENV: "test" });
      assert.ok(runtime.worker instanceof MailDeliveryWorker);
      assert.equal((await runtime.worker.runOne(runtime.mailer)).state, "accepted");
      assert.equal(messages.length, 1); assert.equal(messages[0].text, link.token);
      assert.equal((await user(request.email)).email_verified_at, null);
      // The dependency adapter lends this suite's pool; the suite closes it in its own finally.
    }));

    const waitBlocked = async pid => {
      const deadline = Date.now() + 2500;
      for (;;) {
        if ((await admin.query("select cardinality(pg_blocking_pids($1::int))>0 as blocked", [pid])).rows[0].blocked) return;
        if (Date.now() > deadline) throw new Error("Expected operation did not wait for the owned user lock");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    const beginObserved = action => {
      let entered;
      const began = new Promise(resolve => { entered = resolve; });
      const observed = { query: db.query.bind(db), transaction: work => db.transaction(async tx => {
        entered((await tx.query("select pg_backend_pid() as pid")).rows[0].pid);
        return work(tx);
      }) };
      const result = action(observed);
      // Start handling rejection immediately while the orchestrator observes locks.
      const settled = result.then(value => ({ value }), error => ({ error }));
      return { began: Promise.race([began, settled.then(row => { throw row.error ?? new Error("Operation completed without a transaction"); })]), settled };
    };
    const orderedUnderUserLock = async (account, first, second) => {
      await admin.query("begin");
      let one, two;
      try {
        await admin.query("select id from app.users where id=$1 for update", [account.id]);
        one = beginObserved(first); await waitBlocked(await one.began);
        two = beginObserved(second); await waitBlocked(await two.began);
        await admin.query("commit");
        const results = await Promise.all([one.settled, two.settled]);
        for (const row of results) if (row.error) throw row.error;
        return results.map(row => row.value);
      } finally {
        await admin.query("rollback");
        if (one) await one.settled;
        if (two) await two.settled;
      }
    };

    await suite.test("user locks serialize reset before confirmation and confirmation before reset without deadlock or password revival", async () => {
      for (const resetFirst of [true, false]) await fixture(async ({ request, confirmation, account }) => {
        const link = await recovery.requestRecovery(request.email);
        const reset = observed => new PasswordRecoveryStore(observed, cipher, { pendingAccounts: true }).resetPassword({ token: link.token, password: replacementPassword });
        const confirm = observed => new RegistrationStore(observed, cipher, { confirmationNotice: true }).confirmEmail(confirmation.token);
        const results = await orderedUnderUserLock(account, resetFirst ? reset : confirm, resetFirst ? confirm : reset);
        assert.deepEqual(results[resetFirst ? 0 : 1], { email: request.email });
        assert.equal(results[resetFirst ? 1 : 0], !resetFirst);
        assert.equal(await identity.login(request.email, originalPassword), null);
        assert.ok(await identity.login(request.email, replacementPassword));
        assert.equal(await registration.confirmEmail(confirmation.token), false);
        assert.equal(await recoverySource(account), undefined);
        assert.equal((await jobs(account)).filter(row => row.purpose === "reset_notice").length, 1);
      });
    });

    await suite.test("user locks serialize reset and password-gated resend in both orders; reset deletes whichever confirmation exists", async () => {
      for (const resetFirst of [true, false]) await fixture(async ({ request, confirmation, account }) => {
        const link = await recovery.requestRecovery(request.email);
        const reset = observed => new PasswordRecoveryStore(observed, cipher, { pendingAccounts: true }).resetPassword({ token: link.token, password: replacementPassword });
        const resend = observed => new RegistrationStore(observed, cipher).resendConfirmation(request.email, originalPassword);
        const results = await orderedUnderUserLock(account, resetFirst ? reset : resend, resetFirst ? resend : reset);
        const resent = results[resetFirst ? 1 : 0];
        assert.deepEqual(results[resetFirst ? 0 : 1], { email: request.email });
        if (resetFirst) assert.equal(resent, null);
        else { assert.ok(resent); assert.equal(await registration.confirmEmail(resent.token), false); }
        assert.equal(await registration.confirmEmail(confirmation.token), false);
        assert.deepEqual((await snapshot(account)).confirmations, []);
        assert.equal(await identity.login(request.email, originalPassword), null);
        assert.ok(await identity.login(request.email, replacementPassword));
      });
    });

    await suite.test("concurrent reset attempts consume a pending link once and create exactly one reset notice", async () => fixture(async ({ request, account }) => {
      const link = await recovery.requestRecovery(request.email);
      const reset = observed => new PasswordRecoveryStore(observed, cipher, { pendingAccounts: true }).resetPassword({ token: link.token, password: replacementPassword });
      const results = await orderedUnderUserLock(account, reset, reset);
      assert.deepEqual(results, [{ email: request.email }, null]);
      assert.equal((await user(request.email)).auth_version, "1");
      assert.equal((await jobs(account)).filter(row => row.purpose === "reset_notice").length, 1);
      assert.deepEqual((await snapshot(account)).sessions, []);
    }));

    await suite.test("reset rechecks expiry and account state after waiting for the user lock, without holding recovery rows first", async () => {
      for (const mutation of ["expired", "blocked", "email", "version"]) await fixture(async ({ request, account }) => {
        const link = await recovery.requestRecovery(request.email);
        let operation;
        await admin.query("begin");
        try {
          await admin.query("select id from app.users where id=$1 for update", [account.id]);
          operation = beginObserved(observed => new PasswordRecoveryStore(observed, cipher, { pendingAccounts: true }).resetPassword({ token: link.token, password: replacementPassword }));
          await waitBlocked(await operation.began);
          // If reset locked its source before its user, this write deadlocks instead of succeeding.
          await admin.query("set local lock_timeout='1s'");
          if (mutation === "expired") {
            await admin.query("update app.password_recoveries set created_at=clock_timestamp()-interval '29 minutes',expires_at=clock_timestamp()+interval '250 milliseconds' where user_id=$1", [account.id]);
            await admin.query("select pg_sleep(0.35)");
          }
          if (mutation === "blocked") await admin.query("update app.users set is_blocked=true where id=$1", [account.id]);
          if (mutation === "email") await admin.query("update app.users set email=$2 where id=$1", [account.id, `wait-${randomUUID()}@example.invalid`]);
          if (mutation === "version") await admin.query("update app.users set auth_version=auth_version+1 where id=$1", [account.id]);
          await admin.query("commit");
          const result = await operation.settled;
          if (result.error) throw result.error;
          assert.equal(result.value, null, mutation);
          const after = (await snapshot(account)).user;
          assert.equal(after.email_verified_at, null); assert.equal(after.password_hash, account.password_hash);
        } finally {
          await admin.query("rollback");
          if (operation) await operation.settled;
        }
      });
    });

    await suite.test("lost reset COMMIT acknowledgement is not automatically retried or converted to login; committed token remains single use", async () => fixture(async ({ request, account }) => {
      const link = await recovery.requestRecovery(request.email);
      let transactions = 0;
      const ambiguous = { query: db.query.bind(db), transaction: async work => {
        transactions++;
        await db.transaction(work);
        throw new Error("Synthetic lost COMMIT acknowledgement");
      } };
      await assert.rejects(new PasswordRecoveryStore(ambiguous, cipher, { pendingAccounts: true }).resetPassword({ token: link.token, password: replacementPassword }), /Synthetic lost COMMIT acknowledgement/);
      assert.equal(transactions, 1);
      assert.equal(await recovery.resetPassword({ token: link.token, password: originalPassword }), null);
      assert.equal((await user(request.email)).auth_version, "1");
      assert.deepEqual((await snapshot(account)).sessions, []);
      assert.equal((await jobs(account)).filter(row => row.purpose === "reset_notice").length, 1);
      assert.ok(await identity.login(request.email, replacementPassword));
    }));
  } finally {
    try { await db?.close(); await admin?.end(); }
    finally {
      rmSync(directory, { recursive: true, force: true });
      if (id) {
        const metadata = JSON.parse(await docker(["inspect", id]))[0];
        if (metadata.Id !== id || metadata.Name !== `/${name}` || metadata.Config.Labels[label] !== name) throw new Error("Refusing foreign container cleanup");
        await docker(["rm", "--force", id]);
      }
    }
  }
});
