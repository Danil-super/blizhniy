import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createPostgresDatabase } from "../src/lib/postgres.ts";
import { hashSessionToken } from "../src/lib/identity.ts";
import { ListingDraftInputError } from "../src/lib/listing-draft-contract.ts";
import { PostgresListingDraftStore, ListingDraftAccessError, ListingDraftConflictError } from "./listing-draft-module.mjs";
import { loadAdminModule } from "./admin-module.mjs";
import { AuthRateLimiter } from "../src/lib/auth-http.ts";
import { createProductionListingDraftHandler } from "./listing-draft-http-module.mjs";
const { AppSessionAccessError } = loadAdminModule("app-session-transaction");

// Only the owned PG18 fixture supplies config/credentials. No operator files or remote DB access.
export async function testListingDrafts(suite, operator, config, credentials) {
  assert.equal(config.host, "127.0.0.1");
  const env = { NODE_ENV: "test", BLIZHNIY_DB_HOST: config.host, BLIZHNIY_DB_PORT: String(config.port),
    BLIZHNIY_DB_NAME: config.database, BLIZHNIY_DB_USER: credentials.user,
    BLIZHNIY_DB_PASSWORD: credentials.password, BLIZHNIY_DB_SSL_MODE: "disable" };
  let db = createPostgresDatabase(env);
  let store = new PostgresListingDraftStore(db);
  const hash = `scrypt$131072$8$1$${"c".repeat(32)}$${"d".repeat(128)}`;
  const users = (await operator.query(`insert into app.users(email,password_hash,role,email_verified_at)
    select x.email,$1,x.role,now() from jsonb_to_recordset($2::jsonb) x(email text,role text) returning id,role,email`,
  [hash, JSON.stringify(["owner", "other", "admin"].map(name => ({ email: `${name}-${randomBytes(6).toString("hex")}@example.invalid`, role: name === "admin" ? "admin" : "user" })))])).rows;
  const owner = users.find(u => u.email.startsWith("owner-")), other = users.find(u => u.email.startsWith("other-")), admin = users.find(u => u.role === "admin");
  const session = async (userId, scope = "app", short = false) => {
    const token = randomBytes(32).toString("hex");
    await operator.query(`insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at)
      select $1,id,auth_version,$2,clock_timestamp()+$3::interval from app.users where id=$4`,
    [hashSessionToken(token), scope, short ? "0.4 seconds" : "7 hours", userId]);
    return token;
  };
  let ownerToken = await session(owner.id);
  const otherToken = await session(other.id), adminToken = await session(admin.id);
  let draft;
  try {
    await suite.test("owned fixture grants only draft core columns, not billing, owner changes or private extras", async () => {
      await operator.query(`grant select(id,author_id,listing_type,category_id,city_id,title,description,price,revision,status),
        insert(author_id,listing_type,category_id,city_id,title,description,price),
        update(listing_type,category_id,city_id,title,description,price,revision,updated_at) on app.listings to blizhniy_runtime`);
      for (const sql of ["update app.listings set author_id=author_id where false", "update app.listings set is_paid=true where false",
        "update app.listings set status='published' where false", "delete from app.listings where false", "truncate app.listings",
        "select contact_phone from app.listings limit 0", "insert into app.listings(author_id,listing_type,status) select $1,'sell','paid' where false"]) {
        await assert.rejects(db.query(sql, sql.includes("$1") ? [owner.id] : undefined), { code: "42501" });
      }
    });
    await suite.test("restricted store persists a partial unpaid draft with a server-generated ID and narrow DTO", async () => {
      draft = await store.create(ownerToken, owner.id, { kind: "prodam", title: "  Synthetic draft  ", price: "0" });
      assert.match(draft.id, /^[a-f0-9-]{36}$/);
      assert.deepEqual(draft, { id: draft.id, revision: "1", draft: { kind: "prodam", title: "Synthetic draft", description: "", categoryId: null, cityId: null, price: "0.00" } });
      assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
      const row = (await operator.query("select author_id,status,is_paid,published_at,expires_at from app.listings where id=$1", [draft.id])).rows[0];
      assert.deepEqual(row, { author_id: owner.id, status: "draft", is_paid: false, published_at: null, expires_at: null });
    });
    await suite.test("another account and an admin cannot read or replace someone else's draft", async () => {
      for (const [token, user] of [[otherToken, other], [adminToken, admin]]) {
        await assert.rejects(store.read(token, user.id, draft.id), ListingDraftAccessError);
        await assert.rejects(store.update(token, user.id, draft.id, draft.revision, { kind: "kuplyu", title: "forged" }), ListingDraftAccessError);
        await assert.rejects(store.create(token, owner.id, { kind: "prodam" }), ListingDraftAccessError);
      }
      await assert.rejects(store.read(ownerToken, owner.id, randomUUID()), ListingDraftAccessError);
      assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
    });
    await suite.test("draft replacement increments the exact revision and preserves unexposed fields", async () => {
      await operator.query("update app.listings set contact_phone='synthetic-private',address='Synthetic private address',latitude=0,longitude=0 where id=$1", [draft.id]);
      const category = (await operator.query("select id from app.categories where active limit 1")).rows[0].id;
      const city = (await operator.query("select id from app.cities limit 1")).rows[0].id;
      draft = await store.update(ownerToken, owner.id, draft.id, draft.revision,
        { kind: "arenda", title: "Updated draft", description: "Line 1\nLine 2", categoryId: category, cityId: city, price: "12.1" });
      assert.equal(draft.revision, "2");assert.equal(draft.draft.price, "12.10");assert.equal(draft.draft.categoryId, category);
      assert.deepEqual((await operator.query("select contact_phone,address,latitude::text,longitude::text,status,is_paid from app.listings where id=$1", [draft.id])).rows[0],
        { contact_phone: "synthetic-private", address: "Synthetic private address", latitude: "0", longitude: "0", status: "draft", is_paid: false });
      assert.equal(JSON.stringify(draft).includes("synthetic-private"), false);
      assert.equal(JSON.stringify(draft).includes(owner.id), false);
    });
    await suite.test("unknown reference IDs abort creation/update without losing the saved version", async () => {
      const before = (await operator.query("select count(*)::integer as n from app.listings where author_id=$1", [owner.id])).rows[0].n;
      await assert.rejects(store.create(ownerToken, owner.id, { kind: "prodam", categoryId: randomUUID() }), ListingDraftInputError);
      await assert.rejects(store.update(ownerToken, owner.id, draft.id, draft.revision, { kind: "prodam", cityId: randomUUID() }), ListingDraftInputError);
      assert.equal((await operator.query("select count(*)::integer as n from app.listings where author_id=$1", [owner.id])).rows[0].n, before);
      assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
    });
    await suite.test("two sessions updating the same revision have exactly one winner", async () => {
      const another = await session(owner.id);
      const results = await Promise.allSettled([store.update(ownerToken, owner.id, draft.id, draft.revision, { kind: "prodam", title: "winner A" }),
        new PostgresListingDraftStore(db).update(another, owner.id, draft.id, draft.revision, { kind: "prodam", title: "winner B" })]);
      const winners = results.filter(r => r.status === "fulfilled"), failures = results.filter(r => r.status === "rejected");
      assert.equal(winners.length, 1);assert.equal(failures.length, 1);assert.ok(failures[0].reason instanceof ListingDraftConflictError);
      draft = winners[0].value;assert.equal(draft.revision, "3");assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
      await assert.rejects(store.update(ownerToken, owner.id, draft.id, "2", { kind: "prodam", title: "stale" }), ListingDraftConflictError);
      assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
    });
    await suite.test("revision arithmetic stays exact above JS precision and refuses bigint exhaustion", async () => {
      await operator.query("update app.listings set revision=9007199254740993 where id=$1", [draft.id]);
      const large = await store.read(ownerToken, owner.id, draft.id);assert.equal(large.revision, "9007199254740993");
      draft = await store.update(ownerToken, owner.id, draft.id, large.revision, { kind: "kuplyu", title: "Exact revision" });
      assert.equal(draft.revision, "9007199254740994");
      await operator.query("update app.listings set revision=9223372036854775807 where id=$1", [draft.id]);
      draft = await store.read(ownerToken, owner.id, draft.id);
      await assert.rejects(store.update(ownerToken, owner.id, draft.id, draft.revision, { kind: "prodam" }), ListingDraftConflictError);
      assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
      await operator.query("update app.listings set revision=4 where id=$1", [draft.id]);draft = await store.read(ownerToken, owner.id, draft.id);
    });
    await suite.test("non-draft states are not editable or disclosed by the draft store", async () => {
      await operator.query("update app.listings set status='archived' where id=$1", [draft.id]);
      try {
        await assert.rejects(store.read(ownerToken, owner.id, draft.id), ListingDraftAccessError);
        await assert.rejects(store.update(ownerToken, owner.id, draft.id, draft.revision, { kind: "prodam" }), ListingDraftAccessError);
      } finally { await operator.query("update app.listings set status='draft' where id=$1", [draft.id]); }
    });
    await suite.test("blocked, unverified, stale, expired, idle, revoked and data-subject sessions fail every operation", async () => {
      for (const state of ["blocked", "unverified", "stale", "expired", "idle", "revoked", "data-subject"]) {
        const token = await session(owner.id, state === "data-subject" ? state : "app");
        if (state === "blocked") await operator.query("update app.users set is_blocked=true where id=$1", [owner.id]);
        if (state === "unverified") await operator.query("update app.users set email_verified_at=null where id=$1", [owner.id]);
        if (state === "stale") await operator.query("update app.users set auth_version=auth_version+1 where id=$1", [owner.id]);
        if (state === "expired") await operator.query("update app.sessions set created_at=created_at-interval '9 hours',last_seen_at=last_seen_at-interval '9 hours',expires_at=expires_at-interval '9 hours' where token_hash=$1", [hashSessionToken(token)]);
        if (state === "idle") await operator.query("update app.sessions set created_at=now()-interval '1 hour',last_seen_at=now()-interval '31 minutes',expires_at=now()+interval '7 hours' where token_hash=$1", [hashSessionToken(token)]);
        if (state === "revoked") await operator.query("delete from app.sessions where token_hash=$1", [hashSessionToken(token)]);
        try {
          await assert.rejects(store.create(token, owner.id, { kind: "prodam" }), AppSessionAccessError);
          await assert.rejects(store.read(token, owner.id, draft.id), AppSessionAccessError);
          await assert.rejects(store.update(token, owner.id, draft.id, draft.revision, { kind: "prodam" }), AppSessionAccessError);
        } finally { await operator.query("update app.users set is_blocked=false,email_verified_at=now() where id=$1", [owner.id]); }
      }
      ownerToken = await session(owner.id);assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
    });
    await suite.test("session expiry after actual INSERT/UPDATE rolls back the draft mutation", async () => {
      for (const operation of ["insert", "update"]) {
        let reachedWrite = false;
        const delayed = new PostgresListingDraftStore({ transaction: work => db.transaction(tx => work({ query: async (sql, values) => {
          const result = await tx.query(sql, values);
          if (sql.startsWith(`${operation} into app.listings`) || (operation === "update" && sql.startsWith("update app.listings"))) {
            reachedWrite = true;await operator.query("select pg_sleep(0.6)");
          }
          return result;
        } })) });
        const short = await session(owner.id, "app", true);
        const before = (await operator.query("select count(*)::integer as n from app.listings where author_id=$1", [owner.id])).rows[0].n;
        await assert.rejects(operation === "insert" ? delayed.create(short, owner.id, { kind: "prodam" })
          : delayed.update(short, owner.id, draft.id, draft.revision, { kind: "prodam", title: "expired write" }), AppSessionAccessError);
        assert.equal(reachedWrite, true);
        assert.equal((await operator.query("select count(*)::integer as n from app.listings where author_id=$1", [owner.id])).rows[0].n, before);
        assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
      }
    });
    await suite.test("a post-commit acknowledgement failure is propagated without a second create", async () => {
      const unknown = new Error("Synthetic post-commit acknowledgement loss");let attempts = 0;
      const uncertain = new PostgresListingDraftStore({ transaction: async work => { attempts++;await db.transaction(work);throw unknown; } });
      const before = (await operator.query("select count(*)::integer as n from app.listings where author_id=$1", [owner.id])).rows[0].n;
      await assert.rejects(uncertain.create(ownerToken, owner.id, { kind: "prodam", title: "Committed once" }), e => e === unknown);
      assert.equal(attempts, 1);
      assert.equal((await operator.query("select count(*)::integer as n from app.listings where author_id=$1", [owner.id])).rows[0].n, before+1);
    });
    await suite.test("a new pool and store can read the committed draft without in-memory state", async () => {
      await db.close();db = createPostgresDatabase(env);store = new PostgresListingDraftStore(db);
      assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
    });
    const origin = "https://app.example.invalid";
    const request = (token, userId, id, method = "POST", extra = {}) => new Request(origin+"/api/account/listing-drafts", {
      method, headers: { host: new URL(origin).host, origin, "x-blizhniy-request": "1", "x-real-ip": "192.0.2.2",
        "content-type": "application/json", cookie: `__Host-blizhniy_session=${token}` },
      body: JSON.stringify({ expectedOwnerId: userId, listingId: id, ...extra }),
    });
    const limiter = new AuthRateLimiter(db, "synthetic-draft-rate-key-"+"x".repeat(32));
    const handle = createProductionListingDraftHandler({ origin }, () => ({ store, limiter }), () => {});
    await suite.test("real draft HTTP, cookie guard, restricted PG and shared limiter persist a read/update", async () => {
      let response = await handle(request(ownerToken, owner.id, draft.id));
      assert.equal(response.status, 200);assert.deepEqual(await response.json(), draft);
      response = await handle(request(ownerToken, owner.id, draft.id, "PUT", {
        expectedRevision: draft.revision, draft: { ...draft.draft, title: "HTTP saved draft" },
      }));
      assert.equal(response.status, 200);draft = await response.json();assert.equal(draft.revision, "5");
      assert.equal((await operator.query("select title from app.listings where id=$1", [draft.id])).rows[0].title, "HTTP saved draft");
      assert.deepEqual(await (await handle(request(ownerToken, owner.id, draft.id))).json(), draft);
      assert.equal(JSON.stringify(draft).includes("synthetic-private"), false);
    });
    await suite.test("real HTTP hides foreign/nonexistent IDs and rejects stale account/revision and revoked sessions", async () => {
      for (const req of [request(otherToken, other.id, draft.id), request(adminToken, admin.id, draft.id),
        request(ownerToken, owner.id, randomUUID()), request(ownerToken, other.id, draft.id)]) {
        const response = await handle(req);assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: { code: "DRAFT_NOT_FOUND" } });
      }
      const conflict = await handle(request(ownerToken, owner.id, draft.id, "PUT", {
        expectedRevision: "4", draft: { kind: "prodam", title: "Stale HTTP write" },
      }));
      assert.equal(conflict.status, 409);assert.deepEqual(await conflict.json(), { error: { code: "DRAFT_CHANGED" } });
      const revoked = await session(owner.id);await operator.query("delete from app.sessions where token_hash=$1", [hashSessionToken(revoked)]);
      assert.equal((await handle(request(revoked, owner.id, draft.id))).status, 401);
      assert.deepEqual(await store.read(ownerToken, owner.id, draft.id), draft);
    });
    await suite.test("HTTP reports unknown post-commit outcome as 503 and readback finds only one applied update", async () => {
      let attempts = 0;
      const uncertain = new PostgresListingDraftStore({ transaction: async work => {
        attempts++;await db.transaction(work);throw new Error("Synthetic lost commit acknowledgement");
      } });
      const uncertainHandle = createProductionListingDraftHandler({ origin }, () => ({ store: uncertain, limiter }), () => {});
      const response = await uncertainHandle(request(ownerToken, owner.id, draft.id, "PUT", {
        expectedRevision: draft.revision, draft: { ...draft.draft, title: "Unknown HTTP result" },
      }));
      assert.equal(response.status, 503);assert.deepEqual(await response.json(), { error: { code: "DRAFT_UNAVAILABLE" } });
      assert.equal(attempts, 1);
      draft = await (await handle(request(ownerToken, owner.id, draft.id))).json();
      assert.equal(draft.revision, "6");assert.equal(draft.draft.title, "Unknown HTTP result");
    });
  } finally {
    await db.close();
    await operator.query("delete from app.users where id=any($1::uuid[])", [users.map(u => u.id)]);
  }
}
