import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createPostgresDatabase } from "../src/lib/postgres.ts";
import { hashPassword } from "../src/lib/identity.ts";
import { MailPayloadCipher, enqueueAuthMail, pruneExpiredMail } from "../src/lib/mail-outbox.ts";

export async function testMailOutbox(suite, db, env, applyMigration) {
  const cipher = new MailPayloadCipher(randomBytes(32));
  const hash = await hashPassword("Synthetic mailbox passphrase 2026!");
  let serial = 0;
  const seed = async (tx = db) => (await tx.query(`insert into app.users(email,password_hash)
    values($1,$2) returning id,email`, [`outbox-${++serial}@example.invalid`, hash])).rows[0];
  const intent = (user) => {
    const createdAt = new Date();
    return { id: randomUUID(), userId: user.id, purpose: "confirm", createdAt,
      expiresAt: new Date(createdAt.getTime()+3600000) };
  };
  const payload = user => ({ email: user.email, token: "c".repeat(64) });
  const metadata = row => ({ id: row.id, userId: row.user_id, purpose: row.purpose,
    createdAt: row.created_at, expiresAt: row.expires_at });

  await suite.test("outbox migration has an empty down/up path without affecting existing accounts", async () => {
    const before = (await db.query("select count(*) as count from app.users")).rows[0].count;
    await applyMigration("0008-mail-outbox.sql");
    await applyMigration("0008-mail-outbox.down.sql");
    await applyMigration("0008-mail-outbox.sql");
    assert.equal((await db.query("select count(*) as count from app.users")).rows[0].count, before);
  });
  await suite.test("business write and encrypted queue commit together; rollback persists neither", async () => {
    let rolledBackUser;
    let rolledBackJob;
    await assert.rejects(db.transaction(async tx => {
      rolledBackUser = await seed(tx);
      rolledBackJob = intent(rolledBackUser);
      await enqueueAuthMail(tx, cipher, rolledBackJob, payload(rolledBackUser));
      throw new Error("Synthetic business rollback");
    }), { message: "Synthetic business rollback" });
    assert.equal((await db.query("select 1 from app.users where id=$1", [rolledBackUser.id])).rowCount, 0);
    assert.equal((await db.query("select 1 from app.mail_outbox where id=$1", [rolledBackJob.id])).rowCount, 0);
    const user = await seed();
    const job = intent(user);
    await db.transaction(tx => enqueueAuthMail(tx, cipher, job, payload(user)));
    const row = (await db.query("select * from app.mail_outbox where id=$1", [job.id])).rows[0];
    assert.deepEqual(Object.keys(row).sort(), ["id","user_id","purpose","key_id","payload","created_at","expires_at"].sort());
    assert.equal(row.payload.includes(Buffer.from(user.email)), false);
    assert.equal(row.payload.includes(Buffer.from(payload(user).token)), false);
    assert.deepEqual(cipher.open(metadata(row), row.payload, row.key_id), payload(user));
    // A fresh pool represents a restarted producer/reader: state isn't process memory.
    const restarted = createPostgresDatabase(env);
    try {
      const persisted = (await restarted.query("select * from app.mail_outbox where id=$1", [job.id])).rows[0];
      assert.deepEqual(cipher.open(metadata(persisted), persisted.payload, persisted.key_id), payload(user));
    } finally { await restarted.close(); }
    await assert.rejects(applyMigration("0008-mail-outbox.down.sql"), { message: /Command failed/ });
    assert.equal((await db.query("select 1 from app.mail_outbox where id=$1", [job.id])).rowCount, 1);
  });
  await suite.test("duplicate concurrent intent IDs never create multiple jobs or silently adopt another payload", async () => {
    const user = await seed();
    const job = intent(user);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () =>
      db.transaction(tx => enqueueAuthMail(tx, cipher, job, payload(user)))));
    assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
    assert.equal(results.filter(x => x.status === "rejected" && x.reason.code === "23505").length, 3);
    const rows = (await db.query("select * from app.mail_outbox where id=$1", [job.id])).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(cipher.open(metadata(rows[0]), rows[0].payload, rows[0].key_id), payload(user));
  });
  await suite.test("SQL enforces millisecond timestamp precision; changing a representable expiry breaks authentication", async () => {
    const user = await seed();
    const job = intent(user);
    await db.transaction(tx => enqueueAuthMail(tx, cipher, job, payload(user)));
    const original = (await db.query("select * from app.mail_outbox where id=$1", [job.id])).rows[0];
    await db.query("update app.mail_outbox set expires_at=expires_at-interval '1 microsecond' where id=$1", [job.id]);
    const rounded = (await db.query("select *, extract(microseconds from expires_at)::bigint % 1000 as remainder from app.mail_outbox where id=$1", [job.id])).rows[0];
    assert.equal(rounded.remainder, "0");
    assert.equal(rounded.expires_at.getTime(), original.expires_at.getTime(), "unrepresentable changes are rounded by SQL, not hidden by pg decoding");
    assert.deepEqual(cipher.open(metadata(rounded), rounded.payload, rounded.key_id), payload(user));
    await db.query("update app.mail_outbox set key_id=$2 where id=$1", [job.id, "0".repeat(32)]);
    const wrongKey = (await db.query("select * from app.mail_outbox where id=$1", [job.id])).rows[0];
    assert.throws(() => cipher.open(metadata(wrongKey), wrongKey.payload, wrongKey.key_id), { message: "Invalid encrypted mail payload" });
    await db.query("update app.mail_outbox set key_id=$2 where id=$1", [job.id, cipher.keyId]);
    await db.query("update app.mail_outbox set expires_at=expires_at-interval '1 millisecond' where id=$1", [job.id]);
    const altered = (await db.query("select * from app.mail_outbox where id=$1", [job.id])).rows[0];
    assert.throws(() => cipher.open(metadata(altered), altered.payload, altered.key_id), { message: "Invalid encrypted mail payload" });
  });
  await suite.test("SQL restricts purpose/TTL/ciphertext, user deletion cascades and public roles cannot read", async () => {
    const user = await seed();
    const job = intent(user);
    await db.transaction(tx => enqueueAuthMail(tx, cipher, job, payload(user)));
    for (const sql of ["update app.mail_outbox set purpose='marketing' where id=$1",
      "update app.mail_outbox set expires_at=created_at+interval '2 hours' where id=$1",
      "update app.mail_outbox set payload=decode('01','hex') where id=$1"]) {
      await assert.rejects(db.query(sql, [job.id]), { code: "23514" });
    }
    await db.query("create role outbox_test_anonymous nologin");
    try {
      await assert.rejects(db.transaction(async tx => {
        await tx.query("set local role outbox_test_anonymous");
        await tx.query("select * from app.mail_outbox");
      }), { code: "42501" });
    } finally { await db.query("drop role outbox_test_anonymous"); }
    await db.query("delete from app.users where id=$1", [user.id]);
    assert.equal((await db.query("select 1 from app.mail_outbox where user_id=$1", [user.id])).rowCount, 0);
  });
  await suite.test("expiry cleanup is bounded and preserves unexpired encrypted jobs", async () => {
    const user = await seed();
    const live = intent(user);
    await db.transaction(tx => enqueueAuthMail(tx, cipher, live, payload(user)));
    for (let i=0; i<3; i++) {
      const expired = { ...intent(user), createdAt: new Date(Date.now()-7200000), expiresAt: new Date(Date.now()-3600000) };
      // Keep the exact intended interval, independent of two clock reads.
      expired.expiresAt = new Date(expired.createdAt.getTime()+3600000);
      await db.transaction(tx => enqueueAuthMail(tx, cipher, expired, payload(user)));
    }
    assert.equal(await pruneExpiredMail(db, 2), 2);
    assert.equal(await pruneExpiredMail(db, 2), 1);
    assert.equal((await db.query("select 1 from app.mail_outbox where id=$1", [live.id])).rowCount, 1);
  });
}
