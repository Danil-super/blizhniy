import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { hashSessionToken } from "../src/lib/identity.ts";
import { AuthRateLimiter } from "../src/lib/auth-http.ts";
import { loadProfileModule } from "./production-profile-module.mjs";
const { PostgresProfileStore, ProfileOwnerChangedError, parseProductionProfile } = loadProfileModule("postgres-profile");
const { createProductionProfileHandler } = loadProfileModule("production-profile-http");

export async function testProfiles(suite, db, applyMigration) {
  await suite.test("profile schema up/down is additive, private and refuses destructive rollback with data", async () => {
    await applyMigration("0011-cabinet-profiles.sql");
    await applyMigration("0011-cabinet-profiles.down.sql");
    await applyMigration("0011-cabinet-profiles.sql");
    assert.equal((await db.query("select count(*)::integer as n from app.cabinet_profiles")).rows[0].n, 0);
  });
  const owners = [];
  const tokens = [];
  for (let i = 0; i < 2; i++) {
    const user = (await db.query(`insert into app.users(email,password_hash,email_verified_at)
      select $1,password_hash,clock_timestamp() from app.users limit 1 returning id`, [`profile-${i}@example.invalid`])).rows[0];
    assert.ok(user);
    owners.push(user.id); tokens.push(randomBytes(32).toString("hex"));
    await db.query("insert into app.sessions(token_hash,user_id,auth_version) values($1,$2,0)", [hashSessionToken(tokens[i]), user.id]);
  }
  const store = new PostgresProfileStore(db);
  await suite.test("cookie profile HTTP with real PostgreSQL enforces owner mismatch without leaking or writing another profile", async () => {
    const origin = "https://xn----9sbphbgks4a4a.xn--p1ai";
    const events = [];
    const handler = createProductionProfileHandler({ origin }, () => ({ store, limiter: new AuthRateLimiter(db, randomBytes(32).toString("hex")) }), event => events.push(event));
    const request = (expectedOwnerId, token, method = "POST", profile) => new Request(origin+"/api/account/profile", {
      method, headers: { host: new URL(origin).host, origin, "x-blizhniy-request": "1", "content-type": "application/json",
        "x-real-ip": "192.0.2.71", cookie: `__Host-blizhniy_session=${token}` },
      body: JSON.stringify({ expectedOwnerId, ...(profile ? { profile } : {}) }),
    });
    const own = await handler(request(owners[0], tokens[0]));
    assert.equal(own.status, 200);
    assert.equal((await own.json()).profile.email, "profile-0@example.invalid");
    const mismatch = await handler(request(owners[0], tokens[1], "PUT", { name: "Must not enter B" }));
    assert.equal(mismatch.status, 409);
    assert.deepEqual(await mismatch.json(), { error: { code: "SESSION_CHANGED" } });
    assert.equal((await db.query("select count(*)::integer as n from app.cabinet_profiles")).rows[0].n, 0);
    assert.equal(JSON.stringify(events).includes(owners[0]), false);
    assert.equal(JSON.stringify(events).includes(tokens[1]), false);
  });
  await suite.test("two independent profile owners round-trip without copying email or phone-verification claims", async () => {
    const initial = await store.read(tokens[0], owners[0]);
    assert.equal(initial.exists, false);
    assert.equal(initial.profile.name, "Пользователь");
    assert.equal(initial.profile.email, "profile-0@example.invalid");
    const profile = parseProductionProfile({ name: "Synthetic A", email: "forged@example.invalid", phoneVerified: true,
      verifiedPhone: "forged", phone: "+7 900 000-00-00", organizationName: "Synthetic company", notifyPayments: false });
    const saved = await store.write(tokens[0], owners[0], profile);
    assert.equal(saved.profile.name, "Synthetic A");
    assert.equal(saved.profile.email, "profile-0@example.invalid");
    assert.equal(saved.profile.phoneVerified, false);
    assert.equal(saved.profile.verifiedPhone, "");
    assert.equal((await store.read(tokens[1], owners[1])).exists, false);
    await store.write(tokens[1], owners[1], parseProductionProfile({ name: "Synthetic B" }));
    assert.equal((await store.read(tokens[0], owners[0])).profile.name, "Synthetic A");
    assert.equal((await store.read(tokens[1], owners[1])).profile.name, "Synthetic B");
    const stored = (await db.query("select profile from app.cabinet_profiles where user_id=$1", [owners[0]])).rows[0].profile;
    assert.equal(Object.hasOwn(stored, "email"), false);
    assert.equal(Object.hasOwn(stored, "phoneVerified"), false);
    await assert.rejects(applyMigration("0011-cabinet-profiles.down.sql"));
    assert.equal((await store.read(tokens[0], owners[0])).profile.name, "Synthetic A");
  });
  await suite.test("expected owner cannot confer authority or redirect stale A data into B", async () => {
    await assert.rejects(store.read(tokens[0], owners[1]), ProfileOwnerChangedError);
    await assert.rejects(store.write(tokens[1], owners[0], parseProductionProfile({ name: "Wrong owner" })), ProfileOwnerChangedError);
    assert.equal((await store.read(tokens[1], owners[1])).profile.name, "Synthetic B");
  });
  await suite.test("blocked, revoked, limited-scope and expired sessions cannot read or write profiles", async () => {
    const input = parseProductionProfile({ name: "Rejected" });
    for (const state of ["blocked", "scope", "expired", "revoked"]) {
      await db.query("update app.users set is_blocked=$2 where id=$1", [owners[0], state === "blocked"]);
      if (state === "scope") await db.query("update app.sessions set scope='data-subject' where token_hash=$1", [hashSessionToken(tokens[0])]);
      if (state === "expired") await db.query(`update app.sessions set scope='app',created_at=clock_timestamp()-interval '2 hours',
        expires_at=clock_timestamp()-interval '1 hour',last_seen_at=clock_timestamp()-interval '90 minutes' where token_hash=$1`, [hashSessionToken(tokens[0])]);
      if (state === "revoked") await db.query("delete from app.sessions where token_hash=$1", [hashSessionToken(tokens[0])]);
      await assert.rejects(store.read(tokens[0], owners[0]), { name: "AppSessionAccessError" });
      await assert.rejects(store.write(tokens[0], owners[0], input), { name: "AppSessionAccessError" });
    }
    assert.equal((await db.query("select profile->>'name' as name from app.cabinet_profiles where user_id=$1", [owners[0]])).rows[0].name, "Synthetic A");
  });
  await suite.test("profile write rolls back when session expires after the resource operation", async () => {
    await db.query(`update app.sessions set created_at=clock_timestamp()-interval '1 hour',
      expires_at=clock_timestamp()+interval '500 milliseconds',last_seen_at=clock_timestamp() where token_hash=$1`, [hashSessionToken(tokens[1])]);
    const delayed = new PostgresProfileStore({ transaction: operation => db.transaction(tx => operation({ query: async (sql, values) => {
      const result = await tx.query(sql, values);
      if (sql.includes("insert into app.cabinet_profiles")) await tx.query("select pg_sleep(0.6)");
      return result;
    } })) });
    await assert.rejects(delayed.write(tokens[1], owners[1], parseProductionProfile({ name: "Must roll back" })), { name: "AppSessionAccessError" });
    assert.equal((await db.query("select profile->>'name' as name from app.cabinet_profiles where user_id=$1", [owners[1]])).rows[0].name, "Synthetic B");
  });
  await suite.test("schema rejects forged authoritative fields and anonymous users cannot read profiles", async () => {
    await assert.rejects(db.query("update app.cabinet_profiles set profile=$2 where user_id=$1", [owners[0], { email: "forged@example.invalid" }]), { code: "23514" });
    await db.query("create role profile_test_anonymous nologin");
    try { await assert.rejects(db.transaction(async tx => { await tx.query("set local role profile_test_anonymous");
      await tx.query("select profile from app.cabinet_profiles"); }), { code: "42501" }); }
    finally { await db.query("drop role profile_test_anonymous"); }
  });
}
