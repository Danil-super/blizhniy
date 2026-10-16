import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as identity from "../src/lib/identity.ts";
import * as outbox from "../src/lib/mail-outbox.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import * as validation from '../src/lib/account-validation.ts';
import * as profile from '../src/lib/cabinet-profile.ts';

// Use the repository's TypeScript test convention without changing runtime resolution.
const ts = createRequire(import.meta.url)("typescript");
const exports = {};
const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/registration.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("require", "exports", compiled)((path) => {
  if (path === "./identity") return identity;
  if (path === './account-validation.ts') return validation;
  if (path === './cabinet-profile') return profile;
  if (path === "./mail-outbox") return outbox;
  if (path === "node:crypto") return createRequire(import.meta.url)("node:crypto");
  if (path === "./registration-legal") return { REGISTRATION_LEGAL_VERSIONS };
  throw new Error("Unapproved registration test import");
}, exports);

export async function testRegistration(suite, db, applyMigration) {
  const store = new exports.RegistrationStore(db);
  const login = new identity.IdentityStore(db);
  const password = "Synthetic registration passphrase 2026!";
  const input = (email) => ({ email, password, acceptedAgreement: true, acknowledgedPrivacy: true,
    agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy });
  let confirmation;
  let userId;
  await suite.test("registration refuses browser construction and malformed tokens never query PostgreSQL", async () => {
    const noDatabase = new exports.RegistrationStore({ query() { throw new Error("Unexpected database call"); } });
    assert.equal(await noDatabase.confirmEmail("invalid"), false);
    globalThis.window = {};
    try { assert.throws(() => new exports.RegistrationStore(db), /server-only/); }
    finally { delete globalThis.window; }
  });
  await suite.test("registration migration round-trips while preserving existing identity tables", async () => {
    await applyMigration("0002-registration.sql");
    await applyMigration("0002-registration.down.sql");
    await applyMigration("0002-registration.sql");
    assert.equal((await db.query("select to_regclass('app.users') as users")).rows[0].users, "app.users");
  });
  await suite.test("registration atomically creates an unverified ordinary user, two legal records and a hashed one-hour token", async () => {
    confirmation = await store.register(input(" NEW@example.invalid "));
    assert.ok(confirmation);
    assert.deepEqual(Object.keys(confirmation).sort(), ["email", "expiresAt", "token"]);
    const user = (await db.query("select * from app.users where email=$1", ["new@example.invalid"])).rows[0];
    userId = user.id;
    assert.equal(user.role, "user");
    assert.equal(user.email_verified_at, null);
    assert.equal(await identity.verifyPassword(password, user.password_hash), true);
    assert.equal(await login.login(user.email, password), null);
    const marks = (await db.query("select document, version, recorded_at from app.registration_legal where user_id=$1 order by document", [userId])).rows;
    assert.deepEqual(marks.map(({ document, version }) => ({ document, version })), [
      { document: "agreement", version: REGISTRATION_LEGAL_VERSIONS.agreement },
      { document: "privacy", version: REGISTRATION_LEGAL_VERSIONS.privacy },
    ]);
    assert.ok(marks.every((mark) => mark.recorded_at instanceof Date));
    const token = (await db.query("select *, extract(epoch from (expires_at-created_at))::integer as ttl from app.email_confirmations where user_id=$1", [userId])).rows[0];
    assert.equal(token.token_hash, identity.hashSessionToken(confirmation.token));
    assert.notEqual(token.token_hash, confirmation.token);
    assert.equal(token.ttl, 3600);
    assert.equal(confirmation.expiresAt.getTime(), token.expires_at.getTime());
  });
  await suite.test("registration rejects missing checks, obsolete documents and privilege/timestamp injections before any write", async () => {
    const baseline = (await db.query("select count(*)::integer as count from app.users")).rows[0].count;
    for (const altered of [{ acceptedAgreement: false }, { acknowledgedPrivacy: false }, { acceptedAgreement: "true" },
      { agreementVersion: "1900-01-01" }, { privacyVersion: "1900-01-01" }, { role: "admin" },
      { emailVerifiedAt: new Date() }, { recordedAt: "1900-01-01" }, { email: "bad\r\n@example.invalid" },
      { email: "a".repeat(255) }, { email: "two@@example.invalid" }, { password: "short" }]) {
      await assert.rejects(store.register({ ...input("rejected@example.invalid"), ...altered }));
    }
    for (const malformed of [null, [], {}, "not an object"]) await assert.rejects(store.register(malformed));
    assert.equal((await db.query("select count(*)::integer as count from app.users")).rows[0].count, baseline);
  });
  await suite.test("duplicate email never overwrites credentials, legal marks or an outstanding token", async () => {
    const before = (await db.query("select password_hash from app.users where id=$1", [userId])).rows[0];
    assert.equal(await store.register({ ...input("NEW@example.invalid"), password: "Attacker different passphrase 2026!" }), null);
    assert.deepEqual((await db.query("select password_hash from app.users where id=$1", [userId])).rows[0], before);
    assert.equal((await db.query("select count(*)::integer as count from app.registration_legal where user_id=$1", [userId])).rows[0].count, 2);
    assert.equal((await db.query("select token_hash from app.email_confirmations where user_id=$1", [userId])).rows[0].token_hash, identity.hashSessionToken(confirmation.token));
  });
  await suite.test("two concurrent registrations for the same canonical email produce only one pending account", async () => {
    const results = await Promise.all([store.register(input("race@example.invalid")), store.register(input("RACE@example.invalid"))]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await db.query("select count(*)::integer as count from app.users where email='race@example.invalid'")).rows[0].count, 1);
  });
  await suite.test("a failure after creating the user rolls back credentials, both legal records and the token", async () => {
    // Local fault injection exercises real transactions, not an in-memory database mock.
    await db.query(`create function app.test_registration_failure() returns trigger language plpgsql as $$
      begin raise exception 'Synthetic registration fault' using errcode='23514'; end; $$`);
    await db.query("create trigger test_registration_failure before insert on app.email_confirmations for each row execute function app.test_registration_failure()");
    try { await assert.rejects(store.register(input("rollback@example.invalid")), { code: "23514" }); }
    finally {
      await db.query("drop trigger test_registration_failure on app.email_confirmations");
      await db.query("drop function app.test_registration_failure()");
    }
    assert.equal((await db.query("select count(*)::integer as count from app.users where email='rollback@example.invalid'")).rows[0].count, 0);
    assert.equal((await db.query("select count(*)::integer as count from app.registration_legal l left join app.users u on u.id=l.user_id where u.id is null")).rows[0].count, 0);
  });
  await suite.test("a stored digest or malformed token cannot confirm the email", async () => {
    assert.equal(await store.confirmEmail(identity.hashSessionToken(confirmation.token)), false);
    for (const token of [null, "bad", "F".repeat(64), confirmation.token + " "]) assert.equal(await store.confirmEmail(token), false);
    assert.equal((await db.query("select email_verified_at from app.users where id=$1", [userId])).rows[0].email_verified_at, null);
  });
  await suite.test("concurrent confirmations have exactly one winner; no session is issued automatically", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => store.confirmEmail(confirmation.token)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await store.confirmEmail(confirmation.token), false);
    assert.ok((await db.query("select email_verified_at from app.users where id=$1", [userId])).rows[0].email_verified_at);
    assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [userId])).rows[0].count, 0);
    const session = await login.login("new@example.invalid", password);
    assert.ok(session);
    assert.equal(await store.confirmEmail(session.token), false, "session token has no confirmation purpose");
    await login.revokeSession(session.token);
  });
  await suite.test("expired tokens cannot confirm or extend their TTL", async () => {
    const expired = await store.register(input("expired@example.invalid"));
    await db.query("update app.email_confirmations set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' where token_hash=$1", [identity.hashSessionToken(expired.token)]);
    assert.equal(await store.confirmEmail(expired.token), false);
    assert.equal((await db.query("select email_verified_at from app.users where email=$1", [expired.email])).rows[0].email_verified_at, null);
  });
  await suite.test("a token that expires while confirmation waits on a user lock is rejected at consumption time", async () => {
    const pending = await store.register(input("expires-under-lock@example.invalid"));
    let outcome;
    await db.transaction(async (tx) => {
      await tx.query("select id from app.users where email=$1 for update", [pending.email]);
      // Start confirmation with a valid token and hold its required user lock past expiry.
      await tx.query("update app.email_confirmations set created_at=clock_timestamp()-interval '1 second', expires_at=clock_timestamp()+interval '1 second' where token_hash=$1", [identity.hashSessionToken(pending.token)]);
      outcome = store.confirmEmail(pending.token).then((value) => ({ value }), (error) => ({ error }));
      const deadline = Date.now() + 2000;
      for (;;) {
        const blocked = (await db.query("select count(*)::integer as count from pg_stat_activity where wait_event_type='Lock' and query like 'select%app.users%for update'")).rows[0].count;
        if (blocked) break;
        assert.ok(Date.now() < deadline, "confirmation reached the user lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal((await tx.query("select expires_at > clock_timestamp() as valid from app.email_confirmations where token_hash=$1", [identity.hashSessionToken(pending.token)])).rows[0].valid, true);
      await tx.query("select pg_sleep(1.1)");
    });
    const result = await outcome;
    if (result.error) throw result.error;
    assert.equal(result.value, false);
    assert.equal((await db.query("select email_verified_at from app.users where email=$1", [pending.email])).rows[0].email_verified_at, null);
  });
  await suite.test("changing email or password invalidates an outstanding confirmation", async () => {
    for (const field of ["email", "password_hash"]) {
      const original = await store.register(input(`${field}@example.invalid`));
      const value = field === "email" ? "changed@example.invalid" : await identity.hashPassword("Changed registration passphrase 2026!");
      await db.query(`update app.users set ${field}=$1 where email=$2`, [value, original.email]);
      assert.equal(await store.confirmEmail(original.token), false);
    }
  });
  await suite.test("resend requires the original password, revokes the old token, and does not change consents or credentials", async () => {
    const original = await store.register(input("resend@example.invalid"));
    assert.equal(await store.resendConfirmation(original.email, "Another registration passphrase 2026!"), null);
    assert.equal(await store.resendConfirmation("absent@example.invalid", password), null);
    const replacement = await store.resendConfirmation(original.email, password);
    assert.ok(replacement);
    assert.notEqual(replacement.token, original.token);
    assert.equal(await store.confirmEmail(original.token), false);
    assert.equal(await store.confirmEmail(replacement.token), true);
    assert.equal(await store.resendConfirmation(original.email, password), null, "verified account does not get another token");
  });
  await suite.test("a failed resend preserves the previous valid link; blocked pending users cannot confirm", async () => {
    const original = await store.register(input("resend-failure@example.invalid"));
    await db.query(`create function app.test_registration_failure() returns trigger language plpgsql as $$
      begin raise exception 'Synthetic resend fault' using errcode='23514'; end; $$`);
    await db.query("create trigger test_registration_failure before insert on app.email_confirmations for each row execute function app.test_registration_failure()");
    try { await assert.rejects(store.resendConfirmation(original.email, password), { code: "23514" }); }
    finally {
      await db.query("drop trigger test_registration_failure on app.email_confirmations");
      await db.query("drop function app.test_registration_failure()");
    }
    await db.query("update app.users set is_blocked=true where email=$1", [original.email]);
    assert.equal(await store.confirmEmail(original.token), false);
    assert.equal(await store.resendConfirmation(original.email, password), null);
    await db.query("update app.users set is_blocked=false where email=$1", [original.email]);
    assert.equal(await store.confirmEmail(original.token), true);
  });
  await suite.test("SQL constraints reject plaintext tokens, excessive TTL and duplicate legal records", async () => {
    await assert.rejects(db.query("insert into app.email_confirmations (user_id, token_hash, email, auth_version) values ($1, $2, $3, 0)", [userId, "plaintext", "new@example.invalid"]), { code: "23514" });
    await assert.rejects(db.query("insert into app.email_confirmations (user_id, token_hash, email, auth_version, expires_at) values ($1,$2,$3,0,now()+interval '2 hours')", [userId, "a".repeat(64), "new@example.invalid"]), { code: "23514" });
    await assert.rejects(db.query("insert into app.registration_legal (user_id, document, version) values ($1,'agreement',$2)", [userId, REGISTRATION_LEGAL_VERSIONS.agreement]), { code: "23505" });
  });
  await suite.test("registration tables cannot be read by PUBLIC; populated rollback and replay fail without data loss", async () => {
    await db.query("create role registration_test_anonymous nologin");
    await assert.rejects(db.transaction(async (tx) => {
      await tx.query("set local role registration_test_anonymous");
      await tx.query("select * from app.email_confirmations");
    }), { code: "42501" });
    await db.query("drop role registration_test_anonymous");
    await assert.rejects(applyMigration("0002-registration.down.sql"));
    await assert.rejects(applyMigration("0002-registration.sql"));
    assert.equal((await db.query("select count(*)::integer as count from app.registration_legal where user_id=$1", [userId])).rows[0].count, 2);
  });
  await suite.test("deleting an account cascades to all its registration data; token pruning removes expired and obsolete hashes", async () => {
    const pending = await store.register(input("delete@example.invalid"));
    await db.query("delete from app.users where email=$1", [pending.email]);
    assert.equal(await store.confirmEmail(pending.token), false);
    assert.ok(await store.pruneConfirmations() >= 3);
    const rows = (await db.query("select count(*)::integer as count from app.registration_legal l left join app.users u on u.id=l.user_id where u.id is null")).rows;
    assert.equal(rows[0].count, 0);
  });
  await suite.test("maintenance deletes stale pending accounts and their data, but preserves confirmed and recent accounts", async () => {
    const pending = await store.register(input("stale-pending@example.invalid"));
    await db.query("update app.users set created_at=now()-interval '25 hours' where email in ($1, 'new@example.invalid')", [pending.email]);
    assert.equal(await store.prunePendingRegistrations(), 1);
    assert.equal(await store.confirmEmail(pending.token), false);
    assert.equal((await db.query("select count(*)::integer as count from app.users where email in ('new@example.invalid','race@example.invalid')")).rows[0].count, 2);
    assert.equal(await store.prunePendingRegistrations(), 0);
  });
}
