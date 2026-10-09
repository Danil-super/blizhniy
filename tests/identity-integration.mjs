import assert from "node:assert/strict";
import { hashPassword, hashSessionToken, IdentityStore } from "../src/lib/identity.ts";

// Receives only the parent test's explicitly constructed, synthetic local database.
export async function testIdentity(suite, db, applyMigration) {
  const password = "Synthetic test passphrase 2026!";
  const nextPassword = "Another synthetic passphrase 2026!";
  const hash = await hashPassword(password);
  const nextHash = await hashPassword(nextPassword);
  const store = new IdentityStore(db);
  let firstId, secondId;
  let session;

  await suite.test("identity migration round-trips on an empty database and has no Supabase schemas", async () => {
    await applyMigration("0001-identity.sql");
    await applyMigration("0001-identity.down.sql");
    await applyMigration("0001-identity.sql");
    const schemas = (await db.query("select nspname from pg_catalog.pg_namespace where nspname in ('app', 'auth', 'storage')")).rows;
    assert.deepEqual(schemas.map((row) => row.nspname), ["app"]);
    firstId = (await db.query("insert into app.users (email, password_hash, email_verified_at) values ($1, $2, now()) returning id", ["first@example.invalid", hash])).rows[0].id;
    secondId = (await db.query("insert into app.users (email, password_hash, email_verified_at) values ($1, $2, now()) returning id", ["second@example.invalid", hash])).rows[0].id;
  });
  await suite.test("schema rejects plaintext passwords, duplicate emails and malformed token hashes", async () => {
    await assert.rejects(db.query("insert into app.users (email, password_hash) values ($1, $2)", ["bad@example.invalid", password]), { code: "23514" });
    await assert.rejects(db.query("insert into app.users (email, password_hash) values ($1, $2)", ["first@example.invalid", hash]), { code: "23505" });
    await assert.rejects(db.query("insert into app.sessions (token_hash, user_id, auth_version) values ($1, $2, 0)", ["invalid", firstId]), { code: "23514" });
  });
  await suite.test("PUBLIC/anonymous roles cannot read credentials or sessions", async () => {
    await db.query("create role identity_test_anonymous nologin");
    await assert.rejects(db.transaction(async (tx) => {
      await tx.query("set local role identity_test_anonymous");
      await tx.query("select password_hash from app.users");
    }), { code: "42501" });
    await db.query("drop role identity_test_anonymous");
  });
  await suite.test("correct password creates a fresh persisted session with only safe user fields", async () => {
    session = await store.login(" FIRST@example.invalid ", password);
    assert.ok(session);
    assert.deepEqual(Object.keys(session.user).sort(), ["email", "id", "isBlocked", "role"]);
    assert.equal(session.user.id, firstId);
    const stored = (await db.query("select token_hash, extract(epoch from (expires_at-created_at))::integer as seconds from app.sessions where user_id=$1", [firstId])).rows[0];
    assert.equal(stored.token_hash, hashSessionToken(session.token));
    assert.notEqual(stored.token_hash, session.token);
    assert.equal(stored.seconds, 8 * 60 * 60);
    assert.equal((await store.resolveSession(session.token)).id, firstId);
    assert.equal(await store.resolveSession(stored.token_hash), null);
  });
  await suite.test("invalid credentials and SQL-looking email never create a session", async () => {
    assert.equal(await store.login("first@example.invalid", nextPassword), null);
    assert.equal(await store.login("absent@example.invalid", password), null);
    assert.equal(await store.login("' OR true --", password), null);
    assert.equal(await store.resolveSession("malformed"), null);
  });
  await suite.test("two users stay isolated and logout is idempotent", async () => {
    const other = await store.login("second@example.invalid", password);
    assert.equal((await store.resolveSession(other.token)).id, secondId);
    await store.revokeSession(session.token);
    await store.revokeSession(session.token);
    assert.equal(await store.resolveSession(session.token), null);
    assert.equal((await store.resolveSession(other.token)).id, secondId);
    session = await store.login("first@example.invalid", password);
  });
  await suite.test("account switching and re-login replace only the presented app session atomically", async () => {
    const previous = await store.login("first@example.invalid", password);
    const limited = await store.loginForDataSubject("first@example.invalid", password);
    assert.equal(await store.login("second@example.invalid", nextPassword, previous.token), null);
    assert.equal((await store.resolveSession(previous.token)).id, firstId, "failed switch keeps the original login");
    const replacement = await store.login("second@example.invalid", password, previous.token);
    assert.notEqual(replacement.token, previous.token);
    assert.equal(await store.resolveSession(previous.token), null, "old account token is revoked, not just hidden by the new cookie");
    assert.equal((await store.resolveSession(replacement.token)).id, secondId);
    const rotated = await store.login("second@example.invalid", password, replacement.token);
    assert.notEqual(rotated.token, replacement.token);
    assert.equal(await store.resolveSession(replacement.token), null);
    const app = await store.login("first@example.invalid", password, limited.token);
    assert.equal((await store.resolveDataSubjectSession(limited.token)).id, firstId, "app switching does not consume a data-subject session");
    await Promise.all([store.revokeSession(rotated.token), store.revokeSession(limited.token), store.revokeSession(app.token)]);
  });
  await suite.test("failed replacement insertion rolls back revocation of the old browser session", async () => {
    const previous = await store.login("first@example.invalid", password);
    const failing = new IdentityStore({ query: db.query.bind(db), transaction: (operation) => db.transaction((tx) => operation({
      query: async (sql, params) => {
        if (sql.startsWith("insert into app.sessions")) throw new Error("synthetic session insert failure");
        return tx.query(sql, params);
      },
    })) });
    await assert.rejects(failing.login("second@example.invalid", password, previous.token));
    assert.equal((await store.resolveSession(previous.token)).id, firstId);
    await store.revokeSession(previous.token);
  });
  await suite.test("blocked account is denied ordinary access but retains data-subject verification", async () => {
    await db.query("update app.users set is_blocked=true where id=$1", [firstId]);
    assert.equal(await store.resolveSession(session.token), null);
    assert.equal(await store.login("first@example.invalid", password), null);
    const subject = await store.resolveDataSubjectSession(session.token);
    assert.equal(subject.id, firstId);
    assert.equal(subject.isBlocked, true);
    await store.revokeSession(session.token);
    const limited = await store.loginForDataSubject("first@example.invalid", password);
    assert.equal(limited.scope, "data-subject");
    assert.equal((await store.resolveDataSubjectSession(limited.token)).id, firstId);
    assert.equal(await store.resolveSession(limited.token), null);
    await db.query("update app.users set is_blocked=false where id=$1", [firstId]);
    assert.equal(await store.resolveSession(limited.token), null, "privacy-only token cannot become an ordinary session after unblock");
    session = await store.login("first@example.invalid", password);
  });
  await suite.test("unconfirmed email cannot obtain a session", async () => {
    await db.query("insert into app.users (email, password_hash) values ($1, $2)", ["pending@example.invalid", hash]);
    assert.equal(await store.login("pending@example.invalid", password), null);
  });
  await suite.test("expired sessions are rejected, including data-subject access", async () => {
    await db.query("update app.sessions set created_at=now()-interval '9 hours', expires_at=now()-interval '1 hour', last_seen_at=now()-interval '2 hours' where token_hash=$1", [hashSessionToken(session.token)]);
    assert.equal(await store.resolveSession(session.token), null);
    assert.equal(await store.resolveDataSubjectSession(session.token), null);
    session = await store.login("first@example.invalid", password);
  });
  await suite.test("idle timeout cannot be revived by presenting the stale token", async () => {
    await db.query("update app.sessions set created_at=now()-interval '1 hour', expires_at=now()+interval '7 hours', last_seen_at=now()-interval '31 minutes' where token_hash=$1", [hashSessionToken(session.token)]);
    assert.equal(await store.resolveSession(session.token), null);
    assert.equal(await store.resolveSession(session.token), null);
    session = await store.login("first@example.invalid", password);
  });
  await suite.test("logout-all invalidates every old session without affecting the second user", async () => {
    const extra = await store.login("first@example.invalid", password);
    const other = await store.login("second@example.invalid", password);
    await store.revokeAllSessions(firstId);
    assert.equal(await store.resolveSession(session.token), null);
    assert.equal(await store.resolveSession(extra.token), null);
    assert.equal((await store.resolveSession(other.token)).id, secondId);
    session = await store.login("first@example.invalid", password);
  });
  await suite.test("direct password changes invalidate old sessions even if the old hash is restored", async () => {
    await db.query("update app.users set password_hash=$2 where id=$1", [firstId, nextHash]);
    assert.equal(await store.resolveSession(session.token), null);
    assert.equal(await store.login("first@example.invalid", password), null);
    await db.query("update app.users set password_hash=$2 where id=$1", [firstId, hash]);
    assert.equal(await store.resolveSession(session.token), null);
    session = await store.login("first@example.invalid", password);
  });
  await suite.test("a concurrent password change prevents a previously verified login from issuing a session", async () => {
    let pending;
    try {
      await db.transaction(async (tx) => {
        await tx.query("select id from app.users where id=$1 for update", [firstId]);
        // Attach both outcomes immediately so a lock timeout cannot become unhandled.
        pending = store.login("first@example.invalid", password).then(
          (value) => ({ value }), (error) => ({ error }),
        );
        const deadline = Date.now() + 5000;
        for (;;) {
          // pg_stat_activity is cached within a transaction. Poll on an autocommit connection.
          const { rows: [row] } = await db.query("select count(*)::integer as count from pg_catalog.pg_stat_activity where application_name='blizhniy-app' and wait_event_type='Lock' and lower(query) like '%for update%'");
          if (row.count > 0) break;
          assert.ok(Date.now() < deadline, "login must reach the row-lock barrier");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await tx.query("update app.users set password_hash=$2 where id=$1", [firstId, nextHash]);
      });
      assert.deepEqual(await pending, { value: null });
    } finally { if (pending) await pending; }
    await db.query("update app.users set password_hash=$2 where id=$1", [firstId, hash]);
    session = await store.login("first@example.invalid", password);
  });
  await suite.test("email changes and confirmation removal invalidate existing sessions", async () => {
    await db.query("update app.users set email=$2 where id=$1", [firstId, "changed@example.invalid"]);
    assert.equal(await store.resolveSession(session.token), null);
    session = await store.login("changed@example.invalid", password);
    await db.query("update app.users set email_verified_at=null where id=$1", [firstId]);
    assert.equal(await store.resolveSession(session.token), null);
    await db.query("update app.users set email=$2, email_verified_at=now() where id=$1", [firstId, "first@example.invalid"]);
    session = await store.login("first@example.invalid", password);
  });
  await suite.test("parallel valid requests reuse sessions without extending absolute expiry", async () => {
    const expiry = session.expiresAt.getTime();
    const results = await Promise.all(Array.from({ length: 12 }, () => store.resolveSession(session.token)));
    assert.ok(results.every((user) => user.id === firstId));
    assert.equal((await db.query("select expires_at from app.sessions where token_hash=$1", [hashSessionToken(session.token)])).rows[0].expires_at.getTime(), expiry);
  });
  await suite.test("role changes are read from the database rather than cached in the token", async () => {
    await db.query("update app.users set role='admin' where id=$1", [firstId]);
    assert.equal((await store.resolveSession(session.token)).role, "admin");
    await db.query("update app.users set role='user' where id=$1", [firstId]);
    assert.equal((await store.resolveSession(session.token)).role, "user");
  });
  await suite.test("rollback refuses to erase accounts and leaves the entire schema usable", async () => {
    await assert.rejects(applyMigration("0001-identity.down.sql"));
    assert.equal((await store.resolveSession(session.token)).id, firstId);
    await assert.rejects(applyMigration("0001-identity.sql"));
    assert.equal((await store.resolveSession(session.token)).id, firstId, "reapplying a migration cannot erase data");
    await assert.rejects(db.query("update app.users set auth_version=0 where id=$1", [firstId]), { code: "23514" });
  });
  await suite.test("user deletion cascades sessions and expired-session cleanup removes only inactive rows", async () => {
    const other = await store.login("second@example.invalid", password);
    await db.query("delete from app.users where id=$1", [secondId]);
    assert.equal(await store.resolveSession(other.token), null);
    assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [secondId])).rows[0].count, 0);
    assert.ok(await store.pruneSessions() > 0);
    assert.equal((await store.resolveSession(session.token)).id, firstId);
  });
}
