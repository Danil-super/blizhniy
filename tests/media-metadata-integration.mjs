// Runs only inside the bootstrap test's newly created, ownership-checked local PG18 fixture.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { hashPassword, hashSessionToken } from "../src/lib/identity.ts";
import { loadMediaModule } from "./media-module.mjs";
import { waitForLock } from "./admin-authorization-integration.mjs";
import { testMediaWrites } from "./media-write-integration.mjs";

const { MediaMetadataRepository } = loadMediaModule("media-metadata");
const { createLocalMediaFileStore } = loadMediaModule("media-files");
const fail = (promise, code) => assert.rejects(promise, error => error.name === "MediaMetadataError" && error.code === code && !error.cause);

export async function testMediaMetadata(suite, db, operator) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "blizhniy-media-sql-"));
  const rootProof = await fs.lstat(root, { bigint: true });
  let users = [], rolesCreated = false;
  const down = readFileSync(new URL("../database/migrations/0006-media-reservations.down.sql", import.meta.url), "utf8");
  const up = readFileSync(new URL("../database/migrations/0006-media-reservations.sql", import.meta.url), "utf8");
  const downAttempts = readFileSync(new URL("../database/migrations/0007-media-write-attempts.down.sql", import.meta.url), "utf8");
  const upAttempts = readFileSync(new URL("../database/migrations/0007-media-write-attempts.sql", import.meta.url), "utf8");
  try {
    const hash = await hashPassword("Synthetic media SQL passphrase 2026!");
    users = (await db.query(`insert into app.users(email,password_hash,role,email_verified_at) values
      ('media-owner@example.invalid',$1,'user',now()),('media-other@example.invalid',$1,'user',now()),
      ('media-admin@example.invalid',$1,'admin',now()) returning id,email`, [hash])).rows;
    const session = async (owner = users[0], scope = "app") => {
      const token = randomBytes(32).toString("hex");
      await db.query("insert into app.sessions(token_hash,user_id,auth_version,scope) select $1,id,auth_version,$2 from app.users where id=$3", [hashSessionToken(token), scope, owner.id]);
      return token;
    };
    let token = await session();
    const otherToken = await session(users[1]), adminToken = await session(users[2]);
    const bytes = await sharp({ create: { width: 16, height: 9, channels: 3, background: "#619a77" } }).webp().toBuffer();
    const image = { mimeType: "image/webp", width: 16, height: 9, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    const store = await createLocalMediaFileStore(root);
    let reads = 0;
    const files = { read: async record => { reads++; return store.read(record); } };
    const repo = new MediaMetadataRepository(db, files);
    const budget = async () => (await db.query("select charged_bytes::integer as bytes,charged_objects as objects from app.media_storage_budget")).rows[0];
    const consistent = async () => assert.deepEqual(await budget(), (await db.query("select coalesce(sum(size),0)::integer as bytes,count(*)::integer as objects from app.media_objects")).rows[0]);
    let ready, readyIntent;

    await suite.test("media: pending cannot be read or completed without a verified private file; ready survives restart", async () => {
      readyIntent = randomUUID();
      const reservation = await repo.reserve(token, readyIntent, image);
      assert.equal(reservation.state, "pending"); assert.match(reservation.id, /^[a-f0-9-]{36}$/);
      assert.equal(await repo.readOwned(token, reservation.id), null);
      await fail(repo.complete(token, reservation.id), "MEDIA_METADATA_UNAVAILABLE");
      assert.equal((await repo.getByIntent(token, readyIntent)).state, "pending");
      await store.write(reservation, bytes);
      ready = await repo.complete(token, reservation.id);
      assert.equal(ready.state, "ready");
      const restarted = new MediaMetadataRepository(db, await createLocalMediaFileStore(root));
      assert.deepEqual((await restarted.readOwned(token, ready.id)).bytes, bytes);
      assert.equal((await restarted.complete(token, ready.id)).id, ready.id);
      await consistent();
    });
    await suite.test("media: other user and administrator cannot read or complete an owner's UUID", async () => {
      const before = reads;
      for (const foreignToken of [otherToken, adminToken]) {
        assert.equal(await repo.getByIntent(foreignToken, readyIntent), null);
        assert.equal(await repo.readOwned(foreignToken, ready.id), null);
        await fail(repo.complete(foreignToken, ready.id), "MEDIA_NOT_FOUND");
      }
      assert.equal(reads, before);
    });
    await suite.test("media: pending duplicate never charges again; a changed payload conflicts", async () => {
      const intent = randomUUID(), pending = await repo.reserve(token, intent, image), before = await budget();
      await fail(repo.reserve(token, intent, image), "MEDIA_IN_PROGRESS");
      await fail(repo.reserve(token, intent, { ...image, sha256: "b".repeat(64) }), "MEDIA_INTENT_CONFLICT");
      assert.deepEqual(await budget(), before);
      assert.equal((await repo.getByIntent(token, intent)).id, pending.id); await consistent();
    });
    await suite.test("media: a committed reservation with a lost response is found by intent without another write", async () => {
      const intent = randomUUID(); let transactions = 0;
      const lost = new MediaMetadataRepository({ transaction: async work => {
        transactions++; await db.transaction(work);
        throw Object.assign(new Error("Synthetic lost COMMIT response"), { code: "ECONNRESET" });
      } }, files);
      const before = await budget();
      await fail(lost.reserve(token, intent, image), "MEDIA_METADATA_UNAVAILABLE");
      assert.equal(transactions, 1);
      assert.equal((await repo.getByIntent(token, intent)).state, "pending");
      await fail(repo.reserve(token, intent, image), "MEDIA_IN_PROGRESS");
      assert.deepEqual(await budget(), { bytes: before.bytes + image.size, objects: before.objects + 1 }); await consistent();
    });
    await suite.test("media: blocked, unverified and stale-version identities cannot read or reserve", async () => {
      for (const state of ["is_blocked=true", "email_verified_at=null", "auth_version=auth_version+1"]) {
        const badToken = await session();
        await db.query(`update app.users set ${state} where id=$1`, [users[0].id]);
        try {
          await fail(repo.readOwned(badToken, ready.id), "MEDIA_ACCESS_DENIED");
          await fail(repo.reserve(badToken, randomUUID(), image), "MEDIA_ACCESS_DENIED");
        } finally { await db.query("update app.users set is_blocked=false,email_verified_at=now() where id=$1", [users[0].id]); }
      }
      token = await session(); await consistent();
    });
    await suite.test("media: expired, idle, revoked, unknown and data-subject sessions are denied before FS", async () => {
      const before = reads;
      for (const state of ["expired", "idle", "revoked", "unknown", "data-subject"]) {
        const badToken = state === "unknown" ? randomBytes(32).toString("hex") : await session(users[0], state === "data-subject" ? state : "app");
        const hash = hashSessionToken(badToken);
        if (state === "expired") await db.query("update app.sessions set created_at=created_at-interval '9 hours',last_seen_at=last_seen_at-interval '9 hours',expires_at=expires_at-interval '9 hours' where token_hash=$1", [hash]);
        if (state === "idle") await db.query("update app.sessions set created_at=now()-interval '1 hour',last_seen_at=now()-interval '31 minutes',expires_at=now()+interval '7 hours' where token_hash=$1", [hash]);
        if (state === "revoked") await db.query("delete from app.sessions where token_hash=$1", [hash]);
        await fail(repo.readOwned(badToken, ready.id), "MEDIA_ACCESS_DENIED");
        await fail(repo.complete(badToken, ready.id), "MEDIA_ACCESS_DENIED");
      }
      assert.equal(reads, before);
    });
    await suite.test("media: session expiry after the FS proof rolls back ready and does not return private bytes", async () => {
      const intent = randomUUID(), pending = await repo.reserve(token, intent, image);
      await store.write(pending, bytes);
      let activeTx, fileProofs = 0;
      const expired = new MediaMetadataRepository({ transaction: work => db.transaction(async tx => {
        activeTx = tx; return work(tx);
      }) }, { read: async record => {
        const value = await store.read(record); fileProofs++;
        // Expire inside this same fixture transaction, deterministically AFTER real FS verification.
        await activeTx.query("update app.sessions set expires_at=clock_timestamp() where token_hash=$1", [hashSessionToken(token)]);
        return value;
      } });
      await fail(expired.complete(token, pending.id), "MEDIA_ACCESS_DENIED");
      assert.equal((await repo.getByIntent(token, intent)).state, "pending");
      await fail(expired.readOwned(token, ready.id), "MEDIA_ACCESS_DENIED");
      assert.equal(fileProofs, 2);
      await consistent();
    });
    await suite.test("media: the last byte capacity serializes different owners; failures do not leave rows", async () => {
      const before = await budget();
      await operator.query("update app.media_storage_budget set byte_limit=charged_bytes+$1", [image.size]);
      try {
        const intents = [randomUUID(), randomUUID()];
        const results = await Promise.allSettled([repo.reserve(token, intents[0], image), repo.reserve(otherToken, intents[1], image)]);
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        assert.equal(results.find(result => result.status === "rejected").reason.code, "MEDIA_QUOTA_EXCEEDED");
        assert.deepEqual(await budget(), { bytes: before.bytes + image.size, objects: before.objects + 1 });
        assert.equal((await repo.reserve(token, readyIntent, image)).id, ready.id);
        const winner = results.findIndex(result => result.status === "fulfilled");
        await fail(repo.reserve(winner === 0 ? token : otherToken, intents[winner], image), "MEDIA_IN_PROGRESS");
        await consistent();
      } finally { await operator.query("update app.media_storage_budget set byte_limit=5000000000"); }
    });
    await suite.test("media: object capacity and old pending records remain charged", async () => {
      await operator.query(`insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256,created_at)
        values($1,$2,$3,$4,$5,$6,$7,clock_timestamp()-interval '30 days')`, [users[0].id, randomUUID(), image.mimeType, image.width, image.height, image.size, image.sha256]);
      const before = await budget();
      await operator.query("update app.media_storage_budget set object_limit=charged_objects");
      try {
        await fail(repo.reserve(token, randomUUID(), image), "MEDIA_QUOTA_EXCEEDED");
        assert.deepEqual(await budget(), before); await consistent();
      } finally { await operator.query("update app.media_storage_budget set object_limit=10000"); }
    });
    await suite.test("media: metadata is immutable, deletion requires cleanup proof and user deletion is RESTRICT", async () => {
      for (const update of ["size=size+1", "owner_id=gen_random_uuid()", "intent_id=gen_random_uuid()", "created_at=created_at-interval '1 day'", "state='pending',ready_at=null", "ready_at=ready_at+interval '1 second'"]) {
        await assert.rejects(operator.query(`update app.media_objects set ${update} where id=$1`, [ready.id]), { code: "23514" });
      }
      await assert.rejects(operator.query("delete from app.media_objects where id=$1", [ready.id]), { code: "BL003" });
      // PG18 reports RESTRICT separately from the general foreign_key_violation.
      await assert.rejects(operator.query("delete from app.users where id=$1", [users[0].id]), { code: "23001" });
      await consistent();
    });
    await suite.test("media: restricted runtime charges through a non-superuser fixed-path trigger but cannot alter budget/auth/DDL", async () => {
      await operator.query("create role media_fixture_runtime nologin;create role media_fixture_budget_owner nologin"); rolesCreated = true;
      await operator.query(`grant usage on schema app to media_fixture_runtime,media_fixture_budget_owner;
        grant create on schema app to media_fixture_budget_owner;
        grant select,update on app.media_storage_budget to media_fixture_budget_owner;
        alter function app.charge_media_reservation() owner to media_fixture_budget_owner;
        revoke create on schema app from media_fixture_budget_owner;
        grant select(id,email,role,is_blocked,email_verified_at,auth_version) on app.users to media_fixture_runtime;
        grant update(auth_version) on app.users to media_fixture_runtime;
        grant select on app.sessions,app.media_objects to media_fixture_runtime;
        grant update(last_seen_at) on app.sessions to media_fixture_runtime;
        grant insert(owner_id,intent_id,mime_type,width,height,size,sha256),update(state,ready_at) on app.media_objects to media_fixture_runtime;
        grant select,insert(media_id) on app.media_write_attempts to media_fixture_runtime`);
      const limitedDb = { transaction: work => db.transaction(async tx => { await tx.query("set local role media_fixture_runtime"); return work(tx); }) };
      for (const sql of ["select password_hash from app.users", "update app.users set role='admin'", "update app.media_storage_budget set charged_bytes=0", "delete from app.media_objects", "truncate app.media_objects", "create table app.runtime_ddl(id int)", "select app.charge_media_reservation()", "update app.media_objects set owner_id=gen_random_uuid()", "insert into app.media_objects(id) values(gen_random_uuid())"]) {
        await assert.rejects(limitedDb.transaction(tx => tx.query(sql)), { code: "42501" });
      }
      const limited = new MediaMetadataRepository(limitedDb, files), intent = randomUUID();
      const reserved = await limited.reserve(token, intent, image);
      await store.write(reserved, bytes); assert.equal((await limited.complete(token, reserved.id)).state, "ready");
      assert.deepEqual((await limited.readOwned(token, reserved.id)).bytes, bytes);
      await db.transaction(async tx => {
        await tx.query("create temporary table media_storage_budget(singleton boolean,charged_bytes bigint,charged_objects integer,byte_limit bigint,object_limit integer)");
        await tx.query("set local search_path=pg_temp,public");
        await tx.query("set local role media_fixture_runtime");
        await tx.query("insert into app.media_objects(owner_id,intent_id,mime_type,width,height,size,sha256) values($1,$2,$3,$4,$5,$6,$7)", [users[0].id, randomUUID(), image.mimeType, image.width, image.height, image.size, image.sha256]);
      });
      const security = (await operator.query("select p.prosecdef,p.proconfig,r.rolsuper from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='app.charge_media_reservation()'::regprocedure")).rows[0];
      assert.equal(security.prosecdef, true); assert.equal(security.rolsuper, false); assert.deepEqual(security.proconfig, ["search_path=pg_catalog, pg_temp"]);
      await consistent();
    });
    await testMediaWrites(suite, db, operator, { repo, store, root, token, otherToken, adminToken, image, bytes, ready });
    await suite.test("media: down refuses reservations and unmatched charges; only empty owned fixture can roll back", async () => {
      await assert.rejects(operator.query(down), /Refusing/); await operator.query("rollback");
      await consistent();
      // Destructive reset is restricted to this test's throwaway DB, never an application operation.
      await operator.query("truncate app.media_write_attempts,app.media_objects");
      await assert.rejects(operator.query(down), /Refusing/); await operator.query("rollback");
      await operator.query("update app.media_storage_budget set charged_bytes=0,charged_objects=0");
      await operator.query(downAttempts);
      // A concurrent reservation must become visible BEFORE down decides it is safe.
      let release, inserted;
      const releaseBarrier = new Promise(resolve => { release = resolve; });
      const insertBarrier = new Promise(resolve => { inserted = resolve; });
      const held = new MediaMetadataRepository({ transaction: work => db.transaction(async tx => {
        const result = await work(tx); inserted(); await releaseBarrier; return result;
      }) }, files);
      const reservation = held.reserve(token, randomUUID(), image);
      let refused;
      try {
        await insertBarrier;
        const pid = (await operator.query("select pg_backend_pid() as pid")).rows[0].pid;
        refused = assert.rejects(operator.query(down), /Refusing/);
        await waitForLock(db, pid);
      } finally { release(); await reservation; }
      await refused; await operator.query("rollback"); await consistent();
      await operator.query("truncate app.media_objects;update app.media_storage_budget set charged_bytes=0,charged_objects=0");
      await operator.query(down);
      assert.equal((await operator.query("select to_regclass('app.media_objects') is null as absent")).rows[0].absent, true);
      await operator.query(up); await operator.query(upAttempts); await consistent();
    });
  } finally {
    try {
      await operator.query("rollback");
      if (rolesCreated) {
        if ((await operator.query("select to_regprocedure('app.charge_media_reservation()') is not null as present")).rows[0].present) await operator.query("alter function app.charge_media_reservation() owner to postgres");
        await operator.query("drop owned by media_fixture_runtime,media_fixture_budget_owner;drop role media_fixture_runtime;drop role media_fixture_budget_owner");
      }
      if ((await operator.query("select to_regclass('app.media_objects') is not null as present")).rows[0].present) {
        const attemptsPresent = (await operator.query("select to_regclass('app.media_write_attempts') is not null as present")).rows[0].present;
        await operator.query(attemptsPresent ? "truncate app.media_write_attempts,app.media_objects" : "truncate app.media_objects");
        await operator.query("update app.media_storage_budget set charged_bytes=0,charged_objects=0");
      }
      if (users.length) await db.query("delete from app.users where id=any($1::uuid[])", [users.map(user => user.id)]);
    } finally {
      const proof = await fs.lstat(root, { bigint: true });
      assert.equal(proof.dev, rootProof.dev); assert.equal(proof.ino, rootProof.ino); assert.equal(proof.uid, BigInt(process.getuid()));
      assert.ok(proof.isDirectory()); assert.ok(path.basename(root).startsWith("blizhniy-media-sql-"));
      await fs.rm(root, { recursive: true });
    }
  }
}
