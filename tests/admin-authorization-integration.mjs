import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { hashPassword, hashSessionToken, IdentityStore } from "../src/lib/identity.ts";
import { loadAdminModule } from "./admin-module.mjs";

const { withAdminTransaction } = loadAdminModule("admin-authorization");

export async function createAdminFixture(db) {
  const password = "Synthetic administrator passphrase 2026!";
  const hash = await hashPassword(password);
  const { rows } = await db.query("insert into app.users(email,password_hash,role,email_verified_at) values('admin-fixture@example.invalid',$1,'admin',now()),('user-fixture@example.invalid',$1,'user',now()) returning id,email,role", [hash]);
  const admin = rows.find(row => row.role === "admin");
  const user = rows.find(row => row.role === "user");
  const identity = new IdentityStore(db);
  const adminSession = await identity.login(admin.email, password);
  const userSession = await identity.login(user.email, password);
  assert.ok(adminSession && userSession);
  return { admin, user, adminToken: adminSession.token, userToken: userSession.token,
    async session(scope = "app") {
      const token = randomBytes(32).toString("hex");
      await db.query("insert into app.sessions(token_hash,user_id,auth_version,scope) select $1,id,auth_version,$2 from app.users where id=$3", [hashSessionToken(token), scope, admin.id]);
      return token;
    },
    async cleanup() { await db.query("delete from app.users where id=any($1::uuid[])", [rows.map(row => row.id)]); },
  };
}

export async function waitForLock(db, pid) {
  for (let n = 0; n < 100; n++) {
    const { rows: [row] } = await db.query("select wait_event_type from pg_stat_activity where pid=$1", [pid]);
    if (row?.wait_event_type === "Lock") return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Owned admin fixture did not reach its lock barrier");
}

export async function testAdminAuthorization(suite, db, operator, fixture) {
  await suite.test("real identity session authorizes an admin but denies an ordinary user", async () => {
    assert.equal(await withAdminTransaction(db, fixture.adminToken, async () => "authorized"), "authorized");
    await assert.rejects(withAdminTransaction(db, fixture.userToken, async () => { throw new Error("must not work"); }), /Admin access required/);
  });
  await suite.test("blocked/unverified/demoted admins and stale auth versions cannot write", async () => {
    for (const sql of ["role='user'", "is_blocked=true", "email_verified_at=null", "auth_version=auth_version+1"]) {
      const token = await fixture.session();
      // Only fixed, fixture-owned account state changes; no remote database access.
      await db.query(`update app.users set ${sql} where id=$1`, [fixture.admin.id]);
      try { await assert.rejects(withAdminTransaction(db, token, async tx => tx.query("update app.tariffs set price=0")), /Admin access required/); }
      finally { await db.query("update app.users set role='admin',is_blocked=false,email_verified_at=now() where id=$1", [fixture.admin.id]); }
    }
    fixture.adminToken = await fixture.session();
    assert.equal((await db.query("select price::text from app.tariffs where id='listing-publication'")).rows[0].price, "199.00");
  });
  await suite.test("expired, idle, revoked, fabricated and data-subject tokens are not admin authority", async () => {
    for (const state of ["expired", "idle", "revoked", "unknown", "data-subject"]) {
      const token = state === "unknown" ? randomBytes(32).toString("hex") : await fixture.session(state === "data-subject" ? state : "app");
      const hash = hashSessionToken(token);
      if (state === "expired") await db.query("update app.sessions set created_at=created_at-interval '9 hours',expires_at=expires_at-interval '9 hours',last_seen_at=last_seen_at-interval '9 hours' where token_hash=$1", [hash]);
      if (state === "idle") await db.query("update app.sessions set created_at=now()-interval '1 hour',last_seen_at=now()-interval '31 minutes',expires_at=now()+interval '7 hours' where token_hash=$1", [hash]);
      if (state === "revoked") await new IdentityStore(db).revokeSession(token);
      await assert.rejects(withAdminTransaction(db, token, async () => { throw new Error("must not work"); }), /Admin access required/);
    }
  });
  await suite.test("work failure rolls back both reference changes and session refresh", async () => {
    const before = (await db.query("select last_seen_at from app.sessions where token_hash=$1", [hashSessionToken(fixture.adminToken)])).rows[0];
    const error = new Error("Synthetic failure after reference write");
    await assert.rejects(withAdminTransaction(db, fixture.adminToken, async tx => { await tx.query("update app.tariffs set price=0 where id='listing-publication'"); throw error; }), actual => actual === error);
    assert.equal((await db.query("select price::text from app.tariffs where id='listing-publication'")).rows[0].price, "199.00");
    assert.deepEqual((await db.query("select last_seen_at from app.sessions where token_hash=$1", [hashSessionToken(fixture.adminToken)])).rows[0], before);
  });
  await suite.test("demotion winning the user lock is rechecked before work", async () => {
    let pid, entered;
    const barrier = new Promise(resolve => { entered = resolve; });
    const tracked = { transaction: work => db.transaction(async tx => { pid = (await tx.query("select pg_backend_pid() as pid")).rows[0].pid; entered(); return work(tx); }) };
    await operator.query("begin");
    let pending;
    try {
      await operator.query("update app.users set role='user' where id=$1", [fixture.admin.id]);
      pending = assert.rejects(withAdminTransaction(tracked, fixture.adminToken, async () => { throw new Error("must not work"); }), /Admin access required/);
      await barrier; await waitForLock(db, pid);
      await operator.query("commit"); await pending;
    } finally { await operator.query("rollback"); if(pending)await pending; await db.query("update app.users set role='admin' where id=$1", [fixture.admin.id]); }
  });
  await suite.test("session revocation winning its row lock cannot be bypassed by a stale snapshot", async () => {
    const token = await fixture.session();
    let pid, entered;
    const barrier = new Promise(resolve => { entered = resolve; });
    const tracked = { transaction: work => db.transaction(async tx => { pid = (await tx.query("select pg_backend_pid() as pid")).rows[0].pid; entered(); return work(tx); }) };
    await operator.query("begin");
    let pending;
    try {
      await operator.query("delete from app.sessions where token_hash=$1", [hashSessionToken(token)]);
      pending = assert.rejects(withAdminTransaction(tracked, token, async () => { throw new Error("must not work"); }), /Admin access required/);
      await barrier; await waitForLock(db, pid);
      await operator.query("commit"); await pending;
    } finally { await operator.query("rollback"); if(pending)await pending; }
  });
}
