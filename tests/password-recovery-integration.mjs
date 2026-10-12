import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as identity from "../src/lib/identity.ts";
import * as outbox from "../src/lib/mail-outbox.ts";

const ts = createRequire(import.meta.url)("typescript");
const exports = {};
const source = readFileSync(new URL("../src/lib/password-recovery.ts", import.meta.url), "utf8");
new Function("require", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)((path) => {
  if (path === "./identity") return identity;
  if (path === "./mail-outbox") return outbox;
  if (path === "node:crypto") return createRequire(import.meta.url)("node:crypto");
  throw new Error("Unapproved password recovery import");
}, exports);

export async function testPasswordRecovery(suite, db, applyMigration) {
  const store = new exports.PasswordRecoveryStore(db);
  const login = new identity.IdentityStore(db);
  const password = "Synthetic original recovery passphrase 2026!";
  const replacement = "  Synthetic replacement recovery passphrase 2026!  ";
  const encoded = await identity.hashPassword(password);
  let serial = 0;
  const seed = async () => (await db.query(`insert into app.users (email, password_hash, email_verified_at)
    values ($1,$2,now()) returning id,email,auth_version`, [`recovery-${++serial}@example.invalid`, encoded])).rows[0];
  const reset = (token, nextPassword = replacement) => store.resetPassword({ token, password: nextPassword });
  const row = async (id) => (await db.query("select * from app.users where id=$1", [id])).rows[0];
  const links = async (id) => (await db.query("select * from app.password_recoveries where user_id=$1", [id])).rows;

  await suite.test("recovery is server-only; malformed input is refused without database access", async () => {
    const noDb = new exports.PasswordRecoveryStore({ query() { throw new Error("Unexpected DB call"); }, transaction() { throw new Error("Unexpected DB transaction"); } });
    for (const email of [null, "not-email", "x@@example.invalid", "a".repeat(255), "a\r\n@example.invalid", "a\0@example.invalid"]) await assert.rejects(noDb.requestRecovery(email), { name: "RecoveryInputError" });
    for (const input of [null, [], {}, { token: "a".repeat(64), password, role: "admin" }, { token: "a".repeat(64), password: null },
      Object.assign(Object.create({ token: "a".repeat(64), password }), { role: "admin", scope: "app" })]) await assert.rejects(noDb.resetPassword(input), { name: "RecoveryInputError" });
    for (const token of ["bad", "F".repeat(64), "a".repeat(64) + " "]) assert.equal(await noDb.resetPassword({ token, password }), null);
    for (const next of ["short", " ".repeat(20), "a".repeat(129), "a".repeat(15) + "\0", "a".repeat(15) + "\ud800"]) await assert.rejects(noDb.resetPassword({ token: "a".repeat(64), password: next }), { message: "Invalid password" });
    globalThis.window = {};
    try { assert.throws(() => new exports.PasswordRecoveryStore(db), /server-only/); }
    finally { delete globalThis.window; }
    assert.doesNotMatch(source, /console\.|supabase|fetch\(|localStorage|sessionStorage/);
  });
  await suite.test("recovery migration round-trips empty data without deleting accounts or sessions", async () => {
    await applyMigration("0004-password-recovery.sql");
    await applyMigration("0004-password-recovery.down.sql");
    await applyMigration("0004-password-recovery.sql");
    assert.equal((await db.query("select to_regclass('app.users') as users, to_regclass('app.sessions') as sessions")).rows[0].sessions, "app.sessions");
  });
  await suite.test("request binds a hashed thirty-minute token to a confirmed account without changing credentials or sessions", async () => {
    const user = await seed();
    const session = await login.login(user.email, password);
    const before = await row(user.id);
    const issued = await store.requestRecovery(" " + user.email.toUpperCase() + " ");
    assert.deepEqual(Object.keys(issued).sort(), ["email", "expiresAt", "token"]);
    assert.equal(issued.email, user.email);
    const [stored] = await links(user.id);
    assert.equal(stored.token_hash, identity.hashSessionToken(issued.token));
    assert.notEqual(stored.token_hash, issued.token);
    assert.equal(stored.auth_version, user.auth_version);
    assert.equal(stored.expires_at - stored.created_at, 30 * 60000);
    assert.equal(issued.expiresAt.getTime(), stored.expires_at.getTime());
    assert.deepEqual(await row(user.id), before);
    assert.ok(await login.resolveSession(session.token));
    assert.equal(await reset(stored.token_hash), null, "database digest is not a usable link");
    assert.equal(await reset(session.token), null, "session token has no recovery purpose");
  });
  await suite.test("unknown and unconfirmed addresses cannot reset credentials or create users", async () => {
    const user = await seed();
    await db.query("update app.users set email_verified_at=null where id=$1", [user.id]);
    const before = await row(user.id);
    const count = (await db.query("select count(*)::integer as count from app.users")).rows[0].count;
    assert.equal(await store.requestRecovery(user.email), null);
    assert.equal(await store.requestRecovery("missing-recovery@example.invalid"), null);
    assert.deepEqual(await links(user.id), []);
    assert.deepEqual(await row(user.id), before);
    assert.equal((await db.query("select count(*)::integer as count from app.users")).rows[0].count, count);
  });
  await suite.test("new request rotates the link; a failed insert preserves the previous valid link", async () => {
    const user = await seed();
    const first = await store.requestRecovery(user.email);
    const second = await store.requestRecovery(user.email);
    assert.notEqual(first.token, second.token);
    assert.equal((await links(user.id)).length, 1);
    assert.equal(await reset(first.token), null);
    await db.query(`create function app.test_recovery_insert_fault() returns trigger language plpgsql as $$
      begin raise exception 'Synthetic recovery insert failure' using errcode='23514'; end; $$`);
    await db.query("create trigger test_recovery_insert_fault before insert on app.password_recoveries for each row execute function app.test_recovery_insert_fault()");
    try { await assert.rejects(store.requestRecovery(user.email), { code: "23514" }); }
    finally {
      await db.query("drop trigger test_recovery_insert_fault on app.password_recoveries");
      await db.query("drop function app.test_recovery_insert_fault()");
    }
    assert.equal((await links(user.id))[0].token_hash, identity.hashSessionToken(second.token));
    assert.deepEqual(await reset(second.token), { email: user.email });
  });
  await suite.test("password reset atomically revokes every scope, leaves the other account alone and never logs in automatically", async () => {
    const user = await seed();
    const other = await seed();
    const first = await login.login(user.email, password);
    const second = await login.login(user.email, password);
    const limited = await login.loginForDataSubject(user.email, password);
    const unrelated = await login.login(other.email, password);
    const before = await row(user.id);
    const issued = await store.requestRecovery(user.email);
    assert.deepEqual(await reset(issued.token), { email: user.email });
    assert.equal(await reset(issued.token), null, "single-use replay");
    const after = await row(user.id);
    assert.equal(await identity.verifyPassword(replacement, after.password_hash), true);
    assert.equal(await identity.verifyPassword(replacement.trim(), after.password_hash), false, "password whitespace retained");
    assert.equal(after.auth_version, (BigInt(before.auth_version) + 1n).toString());
    for (const field of ["id", "email", "role", "is_blocked", "email_verified_at", "created_at"]) assert.deepEqual(after[field], before[field]);
    for (const session of [first, second]) assert.equal(await login.resolveSession(session.token), null);
    assert.equal(await login.resolveDataSubjectSession(limited.token), null);
    assert.ok(await login.resolveSession(unrelated.token));
    assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [user.id])).rows[0].count, 0);
    assert.deepEqual(await links(user.id), []);
    assert.equal(await login.login(user.email, password), null);
    assert.ok(await login.login(user.email, replacement));
  });
  await suite.test("two concurrent resets have exactly one winner", async () => {
    const user = await seed();
    const issued = await store.requestRecovery(user.email);
    const results = await Promise.all([reset(issued.token), reset(issued.token)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await row(user.id)).auth_version, "1");
    assert.deepEqual(await links(user.id), []);
  });
  await suite.test("concurrent requests leave only the last committed link valid", async () => {
    const user = await seed();
    const issued = await Promise.all([store.requestRecovery(user.email), store.requestRecovery(user.email.toUpperCase())]);
    const [stored] = await links(user.id);
    const valid = issued.find((link) => identity.hashSessionToken(link.token) === stored.token_hash);
    const obsolete = issued.find((link) => link !== valid);
    assert.ok(valid && obsolete);
    assert.equal(await reset(obsolete.token), null);
    assert.deepEqual(await reset(valid.token), { email: user.email });
  });
  await suite.test("email, password, global revocation and lost confirmation invalidate outstanding links", async () => {
    const changed = await identity.hashPassword("Direct synthetic changed passphrase 2026!");
    const changes = [
      ["update app.users set email=$2 where id=$1", "recovery-changed@example.invalid"],
      ["update app.users set password_hash=$2 where id=$1", changed],
      ["update app.users set auth_version=auth_version+$2 where id=$1", 1],
      ["update app.users set email_verified_at=$2 where id=$1", null],
    ];
    for (const [sql, value] of changes) {
      const user = await seed();
      const issued = await store.requestRecovery(user.email);
      await db.query(sql, [user.id, value]);
      const before = await row(user.id);
      assert.equal(await reset(issued.token), null);
      assert.deepEqual(await row(user.id), before);
    }
  });
  await suite.test("expired links are rejected, including expiry while reset waits for the user lock", async () => {
    const user = await seed();
    const expired = await store.requestRecovery(user.email);
    await db.query("update app.password_recoveries set created_at=clock_timestamp()-interval '2 minutes', expires_at=clock_timestamp()-interval '1 minute' where user_id=$1", [user.id]);
    assert.equal(await reset(expired.token), null);
    const pending = await store.requestRecovery(user.email);
    let outcome;
    await db.transaction(async (tx) => {
      await tx.query("select id from app.users where id=$1 for update", [user.id]);
      await tx.query("update app.password_recoveries set created_at=clock_timestamp()-interval '1 second', expires_at=clock_timestamp()+interval '1 second' where user_id=$1", [user.id]);
      outcome = reset(pending.token).then((value) => ({ value }), (error) => ({ error }));
      const deadline = Date.now() + 2000;
      for (;;) {
        const blocked = (await db.query("select count(*)::integer as count from pg_stat_activity where wait_event_type='Lock' and query like 'select%app.users%for update'")).rows[0].count;
        if (blocked) break;
        assert.ok(Date.now() < deadline, "reset reached user lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal((await tx.query("select expires_at > clock_timestamp() as valid from app.password_recoveries where user_id=$1", [user.id])).rows[0].valid, true);
      await tx.query("select pg_sleep(1.1)");
    });
    const result = await outcome;
    if (result.error) throw result.error;
    assert.equal(result.value, null);
    assert.equal((await row(user.id)).password_hash, encoded);
    assert.equal((await row(user.id)).auth_version, "0");
  });
  await suite.test("expiry is checked after waiting for the token row lock, not just the user lock", async () => {
    const user = await seed();
    const issued = await store.requestRecovery(user.email);
    const tokenHash = identity.hashSessionToken(issued.token);
    let outcome;
    await db.transaction(async (tx) => {
      await tx.query("update app.password_recoveries set created_at=clock_timestamp()-interval '1 second', expires_at=clock_timestamp()+interval '1 second' where token_hash=$1", [tokenHash]);
    });
    await db.transaction(async (tx) => {
      await tx.query("select token_hash from app.password_recoveries where token_hash=$1 for update", [tokenHash]);
      outcome = reset(issued.token).then((value) => ({ value }), (error) => ({ error }));
      const deadline = Date.now() + 2000;
      for (;;) {
        const blocked = (await db.query("select count(*)::integer as count from pg_stat_activity where wait_event_type='Lock' and query like '%app.password_recoveries%'")).rows[0].count;
        if (blocked) break;
        assert.ok(Date.now() < deadline, "reset reached token lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal((await tx.query("select expires_at > clock_timestamp() as valid from app.password_recoveries where token_hash=$1", [tokenHash])).rows[0].valid, true);
      await tx.query("select pg_sleep(1.1)");
    });
    const result = await outcome;
    if (result.error) throw result.error;
    assert.equal(result.value, null);
    assert.equal((await row(user.id)).password_hash, encoded);
  });
  await suite.test("blocked confirmed owners can recover without unblocking or obtaining ordinary access", async () => {
    const user = await seed();
    await db.query("update app.users set is_blocked=true, role='admin' where id=$1", [user.id]);
    const previous = await login.loginForDataSubject(user.email, password);
    const issued = await store.requestRecovery(user.email);
    assert.deepEqual(await reset(issued.token), { email: user.email });
    const current = await row(user.id);
    assert.equal(current.is_blocked, true);
    assert.equal(current.role, "admin");
    assert.equal(await login.resolveDataSubjectSession(previous.token), null);
    assert.equal(await login.login(user.email, replacement), null);
    assert.ok(await login.loginForDataSubject(user.email, replacement));
  });
  await suite.test("faults after token consumption and credential update roll back the link, password, version and sessions", async () => {
    const user = await seed();
    const session = await login.login(user.email, password);
    const issued = await store.requestRecovery(user.email);
    const before = await row(user.id);
    for (const table of ["users", "sessions"]) {
      await db.query(`create function app.test_recovery_reset_fault() returns trigger language plpgsql as $$
        begin raise exception 'Synthetic recovery reset failure' using errcode='23514'; end; $$`);
      const event = table === "users" ? "update" : "delete";
      await db.query(`create trigger test_recovery_reset_fault before ${event} on app.${table} for each row execute function app.test_recovery_reset_fault()`);
      try { await assert.rejects(reset(issued.token), { code: "23514" }); }
      finally {
        await db.query(`drop trigger test_recovery_reset_fault on app.${table}`);
        await db.query("drop function app.test_recovery_reset_fault()");
      }
      assert.deepEqual(await row(user.id), before);
      assert.equal((await links(user.id))[0].token_hash, identity.hashSessionToken(issued.token));
      assert.ok(await login.resolveSession(session.token));
    }
    assert.deepEqual(await reset(issued.token), { email: user.email });
    assert.equal(await login.resolveSession(session.token), null);
  });
  await suite.test("SQL constraints, PUBLIC denial, populated rollback and replay protect recovery data", async () => {
    const user = await seed();
    const values = [user.id, "a".repeat(64), user.email];
    await assert.rejects(db.query("insert into app.password_recoveries (user_id,token_hash,email,auth_version) values ($1,$2,$3,0)", [user.id, "plaintext", user.email]), { code: "23514" });
    await assert.rejects(db.query("insert into app.password_recoveries (user_id,token_hash,email,auth_version,expires_at) values ($1,$2,$3,0,statement_timestamp()+interval '31 minutes')", values), { code: "23514" });
    await assert.rejects(db.query("insert into app.password_recoveries (user_id,token_hash,email,auth_version) values ($1,$2,$3,-1)", values), { code: "23514" });
    const issued = await store.requestRecovery(user.email);
    await assert.rejects(db.query("insert into app.password_recoveries (user_id,token_hash,email,auth_version) values ($1,$2,$3,0)", values), { code: "23505" });
    await db.query("create role recovery_test_anonymous nologin");
    await db.query("grant usage on schema app to recovery_test_anonymous");
    try {
      await assert.rejects(db.transaction(async (tx) => {
        await tx.query("set local role recovery_test_anonymous");
        await tx.query("select * from app.password_recoveries");
      }), { code: "42501" });
    } finally {
      await db.query("revoke usage on schema app from recovery_test_anonymous");
      await db.query("drop role recovery_test_anonymous");
    }
    await assert.rejects(applyMigration("0004-password-recovery.down.sql"));
    await assert.rejects(applyMigration("0004-password-recovery.sql"));
    assert.equal((await links(user.id))[0].token_hash, identity.hashSessionToken(issued.token));
    await db.query("delete from app.users where id=$1", [user.id]);
    assert.deepEqual(await links(user.id), []);
    assert.equal(await reset(issued.token), null, "account deletion cascades recovery data");
  });
  await suite.test("bounded pruning skips locked hashes and preserves active accounts, credentials and links", async () => {
    const active = await seed();
    const valid = await store.requestRecovery(active.email);
    const locked = await seed();
    await store.requestRecovery(locked.email);
    await db.query("update app.password_recoveries set created_at=clock_timestamp()-interval '2 minutes', expires_at=clock_timestamp()-interval '1 minute' where user_id=$1", [locked.id]);
    const bulk = (await db.query(`insert into app.users (email,password_hash,email_verified_at)
      select 'cleanup-recovery-'||g||'@example.invalid',$1,now() from generate_series(1,1001) g returning id`, [encoded])).rows.map(({ id }) => id);
    try {
      await db.query(`insert into app.password_recoveries (user_id,token_hash,email,auth_version,created_at,expires_at)
        select id,md5(email)||md5(id::text),email,auth_version,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute'
        from app.users where id=any($1::uuid[])`, [bulk]);
      await db.transaction(async (tx) => {
        await tx.query("select token_hash from app.password_recoveries where user_id=$1 for update", [locked.id]);
        assert.equal(await store.pruneRecoveries(), 1000);
        assert.equal((await links(locked.id)).length, 1, "locked expired row skipped");
      });
      assert.ok(await store.pruneRecoveries() >= 1);
      assert.deepEqual(await links(locked.id), []);
      assert.equal((await links(active.id))[0].token_hash, identity.hashSessionToken(valid.token));
      assert.equal((await row(active.id)).password_hash, encoded);
      assert.equal((await db.query("select count(*)::integer as count from app.users where id=any($1::uuid[])", [bulk])).rows[0].count, 1001, "pruning tokens never deletes users");
    } finally { await db.query("delete from app.users where id=any($1::uuid[])", [bulk]); }
  });
}
