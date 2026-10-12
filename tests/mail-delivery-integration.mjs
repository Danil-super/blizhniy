import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createPostgresDatabase } from "../src/lib/postgres.ts";
import { MailPayloadCipher, enqueueAuthMail } from "../src/lib/mail-outbox.ts";
import { MailDeliveryWorker } from "../src/lib/mail-delivery.ts";
import { MailError } from "../src/lib/timeweb-mail.ts";

export async function testMailDelivery(suite, db, env, applyMigration) {
  const cipher = new MailPayloadCipher(randomBytes(32));
  const render = (intent, payload) => ({ id: intent.id, to: payload.email, subject: "Synthetic confirmation", text: payload.token ?? "Synthetic notice" });
  const worker = () => new MailDeliveryWorker(db, cipher, render);
  const seed = async (purpose = "confirm", expiresSoon = false) => {
    const user = (await db.query(`insert into app.users(email,password_hash,email_verified_at)
      values($1,$2,$3) returning id,email,auth_version`, [`delivery-${randomUUID()}@example.invalid`, `scrypt$131072$8$1$${"a".repeat(32)}$${"b".repeat(128)}`, purpose === "recover" ? new Date() : null])).rows[0];
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const table = purpose === "confirm" ? "app.email_confirmations" : "app.password_recoveries";
    let source = (await db.query(`insert into ${table}(user_id,token_hash,email,auth_version)
      values($1,$2,$3,$4) returning created_at,expires_at`, [user.id, tokenHash, user.email, user.auth_version])).rows[0];
    if (expiresSoon) source = (await db.query(`update ${table} set
      created_at=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()+interval '1 second'
      where user_id=$1 returning created_at,expires_at`, [user.id])).rows[0];
    const job = { id: randomUUID(), userId: user.id, purpose, createdAt: source.created_at, expiresAt: source.expires_at };
    await db.transaction(tx => enqueueAuthMail(tx, cipher, job, { email: user.email, token }));
    return { user, job, tokenHash };
  };
  const row = async id => (await db.query("select * from app.mail_outbox where id=$1", [id])).rows[0];
  const reset = async () => db.query("delete from app.mail_outbox");

  await suite.test("delivery schema down refuses nonempty queues and empty rollback preserves accounts", async () => {
    await applyMigration("0009-mail-delivery.sql");
    await seed();
    await assert.rejects(applyMigration("0009-mail-delivery.down.sql"), { message: /Command failed/ });
    await reset();
    await applyMigration("0009-mail-delivery.down.sql");
    await applyMigration("0009-mail-delivery.sql");
  });
  await suite.test("concurrent workers claim one winner; SMTP acceptance persists, without delivery claims or secret results", async () => {
    const { job } = await seed();
    let calls = 0;
    const mailer = { send: async message => { calls++; assert.equal(message.id, job.id); } };
    const results = await Promise.all(Array.from({ length: 4 }, () => worker().runOne(mailer)));
    assert.equal(calls, 1);
    assert.equal(results.filter(result => result.state === "accepted").length, 1);
    assert.equal(results.filter(result => result.state === "idle").length, 3);
    assert.deepEqual(Object.keys(results.find(x => x.state === "accepted")).sort(), ["id", "state"]);
    assert.equal((await row(job.id)).state, "accepted");
    assert.equal((await row(job.id)).attempts, 1);
    assert.equal((await row(job.id)).claim_id, null);
    assert.deepEqual(await worker().runOne(mailer), { state: "idle" });
    await reset();
  });
  await suite.test("temporary failures persist retry time across restart; permanent and ambiguous outcomes never resend", async () => {
    const { job } = await seed();
    assert.equal((await worker().runOne({ send: async () => { throw new MailError("TEMPORARY"); } })).state, "ready");
    const first = await row(job.id);
    assert.ok(first.available_at.getTime() >= Date.now()+55000);
    assert.equal(first.last_code, "TEMPORARY");
    assert.deepEqual(await worker().runOne({ send: async () => assert.fail("backoff bypassed") }), { state: "idle" });
    const restarted = createPostgresDatabase(env);
    try {
      await db.query("update app.mail_outbox set available_at=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
      const again = new MailDeliveryWorker(restarted, cipher, render);
      assert.equal((await again.runOne({ send: async () => { throw new Error("synthetic sensitive SMTP response"); } })).state, "unknown");
      assert.equal((await row(job.id)).attempts, 2);
      assert.equal((await row(job.id)).last_code, "UNKNOWN");
      assert.deepEqual(await again.runOne({ send: async () => assert.fail("unknown outcome retried") }), { state: "idle" });
    } finally { await restarted.close(); }
    await reset();
    for (const code of ["AUTH_FAILED", "REJECTED"]) {
      const item = await seed();
      assert.equal((await worker().runOne({ send: async () => { throw new MailError(code); } })).state, "failed");
      assert.equal((await row(item.job.id)).last_code, code);
      assert.deepEqual(await worker().runOne({ send: async () => assert.fail("permanent failure retried") }), { state: "idle" });
      await reset();
    }
  });
  await suite.test("lease expiry before dispatch permits a new owner; stale owners cannot dispatch or acknowledge", async () => {
    const { job } = await seed();
    const old = await worker().claim();
    await db.query("update app.mail_outbox set lease_until=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
    assert.equal(await worker().recoverAbandoned(1), 1);
    const fresh = await worker().claim();
    assert.notEqual(old.claimId, fresh.claimId);
    assert.equal(await worker().prepare(old), null);
    assert.ok(await worker().prepare(fresh));
    assert.equal(await worker().finish(old, "accepted"), null);
    assert.equal(await worker().finish(fresh, "accepted"), "accepted");
    await reset();
  });
  await suite.test("lost worker after dispatch becomes unknown, never an automatic resend", async () => {
    const { job } = await seed();
    const owner = await worker().claim();
    assert.ok(await worker().prepare(owner));
    await db.query("update app.mail_outbox set lease_until=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
    assert.equal(await worker().recoverAbandoned(1), 1);
    assert.equal((await row(job.id)).state, "unknown");
    assert.equal(await worker().finish(owner, "accepted"), null);
    assert.deepEqual(await worker().runOne({ send: async () => assert.fail("abandoned SMTP retried") }), { state: "idle" });
    await reset();
  });
  await suite.test("expired, rotated, consumed, wrong-version/address and corrupt jobs never reach SMTP", async () => {
    const changes = [
      item => db.query("delete from app.email_confirmations where user_id=$1", [item.user.id]),
      item => db.query("update app.email_confirmations set token_hash=$2 where user_id=$1", [item.user.id, "f".repeat(64)]),
      item => db.query("update app.users set auth_version=auth_version+1 where id=$1", [item.user.id]),
      item => db.query("update app.users set email=$2 where id=$1", [item.user.id, `changed-${randomUUID()}@example.invalid`]),
      item => db.query("update app.users set is_blocked=true where id=$1", [item.user.id]),
      item => db.query("update app.users set email_verified_at=clock_timestamp() where id=$1", [item.user.id]),
      item => db.query("update app.email_confirmations set created_at=created_at-interval '2 hours',expires_at=expires_at-interval '2 hours' where user_id=$1", [item.user.id]),
      item => db.query("update app.mail_outbox set key_id=$2 where id=$1", [item.job.id, "0".repeat(32)]),
    ];
    for (const change of changes) {
      const item = await seed();
      await change(item);
      const outcome = await worker().runOne({ send: async () => assert.fail("invalid link sent") });
      assert.ok(["cancelled", "failed"].includes(outcome.state));
      assert.equal((await row(item.job.id)).attempts, 0);
      await reset();
    }
    const item = await seed();
    const owner = await worker().claim();
    await db.query("update app.mail_outbox set created_at=created_at-interval '2 hours',expires_at=expires_at-interval '2 hours' where id=$1", [item.job.id]);
    assert.equal(await worker().prepare(owner), null);
    assert.equal((await row(item.job.id)).state, "cancelled");
    await reset();
    const recovery = await seed("recover");
    assert.equal((await worker().runOne({ send: async () => {} })).state, "accepted");
    assert.equal((await row(recovery.job.id)).attempts, 1);
    await reset();
  });
  await suite.test("source/outbox expiry is rechecked after waiting on user and token row locks", async () => {
    for (const table of ["app.users", "app.email_confirmations"]) {
      const item = await seed("confirm", true);
      const owner = await worker().claim();
      let preparation;
      await db.transaction(async tx => {
        await tx.query(table === "app.users" ? "select id from app.users where id=$1 for update"
          : "select token_hash from app.email_confirmations where user_id=$1 for update", [item.user.id]);
        preparation = worker().prepare(owner).then(value => ({ value }), error => ({ error }));
        const deadline = Date.now()+2000;
        for (;;) {
          const locked = (await db.query("select count(*)::integer as n from pg_stat_activity where wait_event_type='Lock'")).rows[0].n;
          if (locked) break;
          assert.ok(Date.now()<deadline, "worker reached expected lock");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        await tx.query("select pg_sleep(1.1)");
      });
      const outcome = await preparation;
      if (outcome.error) throw outcome.error;
      assert.equal(outcome.value, null);
      assert.equal((await row(item.job.id)).state, "cancelled");
      assert.equal((await row(item.job.id)).attempts, 0);
      await reset();
    }
  });
  await suite.test("retry budget cannot exceed five SMTP attempts; renderer faults never send or leak payload", async () => {
    const item = await seed();
    let calls = 0;
    for (let attempt=1; attempt<=5; attempt++) {
      const outcome = await worker().runOne({ send: async () => { calls++; throw new MailError("TEMPORARY"); } });
      assert.equal(outcome.state, attempt===5 ? "failed" : "ready");
      assert.equal((await row(item.job.id)).attempts, attempt);
      await db.query("update app.mail_outbox set available_at=clock_timestamp()-interval '1 second' where id=$1", [item.job.id]);
    }
    assert.deepEqual(await worker().runOne({ send: async () => assert.fail("sixth attempt") }), { state: "idle" });
    assert.equal(calls, 5);
    await reset();
    for (const badRender of [() => { throw new Error("synthetic plaintext token"); },
      (intent, payload) => ({ ...render(intent,payload), to: "wrong@example.invalid" })]) {
      const bad = await seed();
      const renderer = new MailDeliveryWorker(db, cipher, badRender);
      assert.equal((await renderer.runOne({ send: async () => assert.fail("invalid rendered mail sent") })).state, "failed");
      assert.equal((await row(bad.job.id)).last_code, "INVALID_PAYLOAD");
      assert.equal((await row(bad.job.id)).attempts, 0);
      await reset();
    }
  });
}
