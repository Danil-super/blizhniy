import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MailPayloadCipher, enqueueAuthMail } from "../src/lib/mail-outbox.ts";
import { MailDeliveryWorker } from "../src/lib/mail-delivery.ts";
import { IdentityStore, hashSessionToken } from "../src/lib/identity.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { RegistrationStore } from "./auth-mail-module.mjs";
import { loadProductionAuth } from "./production-auth-module.mjs";

const { renderProductionAuthMail } = loadProductionAuth("production-auth-config");

export async function testConfirmationNotice(suite, db, applyMigration) {
  await applyMigration("0015-confirmation-notice.sql");
  const cipher = new MailPayloadCipher(randomBytes(32));
  const store = new RegistrationStore(db, cipher, { confirmationNotice: true });
  const password = "Synthetic confirmation notice passphrase!";
  const owned = new Set();
  const input = () => ({ email: `receipt-${randomUUID()}@example.invalid`, password,
    acceptedAgreement: true, acknowledgedPrivacy: true,
    agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy });
  const user = async email => (await db.query("select * from app.users where email=$1", [email])).rows[0];
  const jobs = async id => (await db.query("select * from app.mail_outbox where user_id=$1 order by created_at,id", [id])).rows;
  const create = async () => {
    const request = input();
    const confirmation = await store.register(request);
    const account = await user(request.email);
    owned.add(account.id);
    return { request, confirmation, account };
  };
  const worker = () => new MailDeliveryWorker(db, cipher, renderProductionAuthMail);
  const remove = async id => { await db.query("delete from app.users where id=$1", [id]); owned.delete(id); };
  try {
    await suite.test("expired confirmation and password-gated resend → fresh link → one receipt → login", async () => {
      const { request, confirmation, account } = await create();
      await db.query("update app.email_confirmations set created_at=created_at-interval '2 hours',expires_at=expires_at-interval '2 hours' where user_id=$1", [account.id]);
      assert.equal(await store.confirmEmail(confirmation.token), false);
      assert.equal((await user(request.email)).email_verified_at, null);
      assert.equal(await store.resendConfirmation(request.email, "Synthetic incorrect original password!"), null);
      assert.equal(await store.resendConfirmation(`absent-${randomUUID()}@example.invalid`, password), null);
      assert.equal((await jobs(account.id)).length, 1);
      const fresh = await store.resendConfirmation(request.email, password);
      assert.ok(fresh);
      assert.equal(await store.confirmEmail(confirmation.token), false);
      assert.equal((await worker().runOne({ send: async () => assert.fail("obsolete challenge sent") })).state, "cancelled");
      assert.equal((await worker().runOne({ send: async message => {
        assert.equal(message.to, request.email);
        assert.match(message.text, new RegExp(fresh.token));
      } })).state, "accepted");
      assert.equal(await store.confirmEmail(fresh.token), true);
      assert.equal(await store.confirmEmail(fresh.token), false);
      assert.equal(await store.resendConfirmation(request.email, password), null);
      assert.equal(await store.register(request), null);
      const notices = (await jobs(account.id)).filter(row => row.purpose === "confirm_notice");
      assert.equal(notices.length, 1);
      assert.equal(notices[0].expires_at - notices[0].created_at, 86400000);
      const restartedCipher = new MailPayloadCipher(Buffer.from("00".repeat(32), "hex"));
      assert.throws(() => restartedCipher.open({ id: notices[0].id, userId: account.id, purpose: "confirm_notice",
        createdAt: notices[0].created_at, expiresAt: notices[0].expires_at }, notices[0].payload, notices[0].key_id));
      assert.equal((await worker().runOne({ send: async message => {
        assert.match(message.subject, /почта подтверждена/iu);
        assert.equal(message.to, request.email);
        assert.doesNotMatch(message.text, /token|парол|[a-f0-9]{64}/iu);
      } })).state, "accepted");
      assert.equal((await worker().runOne({ send: async () => assert.fail("receipt delivered twice") })).state, "idle");
      assert.ok(await new IdentityStore(db).login(request.email, password));
      assert.equal((await user(request.email)).password_hash, account.password_hash);
      assert.equal((await user(request.email)).auth_version, account.auth_version);
      await remove(account.id);
    });
    await suite.test("receipt enqueue failure rolls back confirmation; competing consumes create one intent", async () => {
      const { request, confirmation, account } = await create();
      const failQueue = { query: db.query.bind(db), transaction: work => db.transaction(tx => work({
        query: (sql, values) => sql.includes("insert into app.mail_outbox")
          ? Promise.reject(new Error("Synthetic receipt enqueue failure")) : tx.query(sql, values),
      })) };
      await assert.rejects(new RegistrationStore(failQueue, cipher, { confirmationNotice: true }).confirmEmail(confirmation.token),
        /Synthetic receipt enqueue failure/);
      assert.equal((await user(request.email)).email_verified_at, null);
      assert.equal((await db.query("select token_hash from app.email_confirmations where user_id=$1", [account.id])).rows[0].token_hash,
        hashSessionToken(confirmation.token));
      assert.equal((await jobs(account.id)).length, 1);
      const results = await Promise.all([store.confirmEmail(confirmation.token), store.confirmEmail(confirmation.token)]);
      assert.deepEqual(results.sort(), [false, true]);
      assert.equal((await jobs(account.id)).filter(row => row.purpose === "confirm_notice").length, 1);
      assert.equal((await db.query("select count(*)::integer as n from app.registration_legal where user_id=$1", [account.id])).rows[0].n, 2);
      await remove(account.id);
    });
    await suite.test("receipt dispatch cancels unverified, blocked and changed recipients without SMTP", async () => {
      for (const state of ["unverified", "blocked", "changed"]) {
        const { request, account } = await create();
        await db.query("delete from app.mail_outbox where user_id=$1", [account.id]);
        if (state !== "unverified") await db.query("update app.users set email_verified_at=clock_timestamp(),is_blocked=$2 where id=$1", [account.id, state === "blocked"]);
        const { rows: [clock] } = await db.query('select clock_timestamp() as "createdAt"');
        await db.transaction(tx => enqueueAuthMail(tx, cipher, { id: randomUUID(), userId: account.id, purpose: "confirm_notice",
          createdAt: clock.createdAt, expiresAt: new Date(clock.createdAt.getTime() + 86400000) }, { email: request.email, token: null }));
        if (state === "changed") await db.query("update app.users set email=$2 where id=$1", [account.id, `changed-${randomUUID()}@example.invalid`]);
        assert.equal((await worker().runOne({ send: async () => assert.fail(`unsafe ${state} receipt sent`) })).state, "cancelled");
        await remove(account.id);
      }
    });
    await suite.test("disabled producer preserves legacy behaviour and blocked users cannot confirm", async () => {
      const { request, confirmation, account } = await create();
      await db.query("update app.users set is_blocked=true where id=$1", [account.id]);
      assert.equal(await store.confirmEmail(confirmation.token), false);
      assert.equal(await store.resendConfirmation(request.email, password), null);
      assert.equal((await jobs(account.id)).length, 1);
      await db.query("update app.users set is_blocked=false where id=$1", [account.id]);
      assert.equal(await new RegistrationStore(db, cipher).confirmEmail(confirmation.token), true);
      assert.equal((await jobs(account.id)).filter(row => row.purpose === "confirm_notice").length, 0);
      await remove(account.id);
    });
    await suite.test("migration rollback refuses existing notices without losing data or weakening constraints", async () => {
      const { confirmation, account } = await create();
      assert.equal(await store.confirmEmail(confirmation.token), true);
      await assert.rejects(applyMigration("0015-confirmation-notice.down.sql"));
      assert.equal((await jobs(account.id)).filter(row => row.purpose === "confirm_notice").length, 1);
      const { rows: [constraint] } = await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='app.mail_outbox'::regclass and conname='mail_outbox_purpose_check'");
      assert.match(constraint.definition, /confirm_notice/);
      await remove(account.id);
    });
  } finally {
    for (const id of owned) await remove(id);
    await applyMigration("0015-confirmation-notice.down.sql");
  }
  await suite.test("notification migration restores the exact legacy purpose allowlist on clean rollback", async () => {
    const { rows: [constraint] } = await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='app.mail_outbox'::regclass and conname='mail_outbox_purpose_check'");
    assert.match(constraint.definition, /reset_notice/);
    assert.doesNotMatch(constraint.definition, /confirm_notice/);
  });
}
