import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MailPayloadCipher } from "../src/lib/mail-outbox.ts";
import { MailDeliveryWorker } from "../src/lib/mail-delivery.ts";
import { IdentityStore, hashSessionToken } from "../src/lib/identity.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { RegistrationStore, PasswordRecoveryStore } from "./auth-mail-module.mjs";

export async function testAuthMailTransactions(suite, db) {
  const cipher = new MailPayloadCipher(randomBytes(32));
  const registration = new RegistrationStore(db, cipher);
  const recovery = new PasswordRecoveryStore(db, cipher);
  const password = "Synthetic durable signup passphrase!";
  const input = () => ({ email: `queued-${randomUUID()}@example.invalid`, password,
    acceptedAgreement: true, acknowledgedPrivacy: true,
    agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy });
  const jobs = async userId => (await db.query("select * from app.mail_outbox where user_id=$1 order by available_at,id", [userId])).rows;
  const user = async email => (await db.query("select * from app.users where email=$1", [email])).rows[0];
  const renderer = (intent, payload) => ({ id: intent.id, to: payload.email, subject: "Synthetic authentication",
    text: payload.token ?? "Synthetic password changed notice" });
  const worker = () => new MailDeliveryWorker(db, cipher, renderer);
  const failQueue = { query: db.query.bind(db), transaction: work => db.transaction(tx => work({
    query: (sql, values) => sql.includes("insert into app.mail_outbox")
      ? Promise.reject(new Error("Synthetic queue insert failure")) : tx.query(sql, values),
  })) };

  await suite.test("signup/resend → durable queue → dispatch → one-time confirmation → login uses the actual source transaction", async () => {
    const request = input();
    const first = await registration.register(request);
    const account = await user(request.email);
    assert.equal((await jobs(account.id)).length, 1);
    assert.equal(await registration.register(request), null);
    assert.equal((await jobs(account.id)).length, 1);
    const resent = await registration.resendConfirmation(request.email, password);
    assert.equal((await jobs(account.id)).length, 2);
    let calls = 0;
    const mailer = { send: async message => { calls++; assert.equal(message.to, request.email); assert.equal(message.text, resent.token); } };
    assert.equal((await worker().runOne(mailer)).state, "cancelled");
    assert.equal((await worker().runOne(mailer)).state, "accepted");
    assert.equal(calls, 1);
    assert.equal(await registration.confirmEmail(first.token), false);
    assert.equal(await registration.confirmEmail(resent.token), true);
    assert.equal(await registration.confirmEmail(resent.token), false);
    const login = await new IdentityStore(db).login(request.email, password);
    assert.ok(login);
    await db.query("delete from app.users where id=$1", [account.id]);
    assert.equal((await jobs(account.id)).length, 0);
  });
  await suite.test("queue failure rolls back signup and resend, preserving existing credentials, legal marks and usable link", async () => {
    const broken = new RegistrationStore(failQueue, cipher);
    const missing = input();
    await assert.rejects(broken.register(missing), /Synthetic queue insert failure/);
    assert.equal(await user(missing.email), undefined);
    const request = input();
    const existing = await registration.register(request);
    const account = await user(request.email);
    const before = await jobs(account.id);
    await assert.rejects(broken.resendConfirmation(request.email, password), /Synthetic queue insert failure/);
    const token = (await db.query("select token_hash from app.email_confirmations where user_id=$1", [account.id])).rows[0];
    assert.equal(token.token_hash, hashSessionToken(existing.token));
    assert.deepEqual((await jobs(account.id)).map(x => x.id), before.map(x => x.id));
    assert.equal((await db.query("select count(*)::integer as n from app.registration_legal where user_id=$1", [account.id])).rows[0].n, 2);
    assert.equal((await user(request.email)).password_hash, account.password_hash);
    assert.equal(await registration.confirmEmail(existing.token), true);
    await db.query("delete from app.users where id=$1", [account.id]);
  });
  await suite.test("recovery/reset queue commits atomically; failed mail insert cannot rotate tokens or partially change a password", async () => {
    const request = input();
    const confirmation = await registration.register(request);
    await registration.confirmEmail(confirmation.token);
    const account = await user(request.email);
    await db.query("delete from app.mail_outbox where user_id=$1", [account.id]);
    const first = await recovery.requestRecovery(request.email);
    const broken = new PasswordRecoveryStore(failQueue, cipher);
    await assert.rejects(broken.requestRecovery(request.email), /Synthetic queue insert failure/);
    assert.equal((await db.query("select token_hash from app.password_recoveries where user_id=$1", [account.id])).rows[0].token_hash, hashSessionToken(first.token));
    const login = await new IdentityStore(db).login(request.email, password);
    const nextPassword = "Synthetic new durable passphrase!";
    await assert.rejects(broken.resetPassword({ token: first.token, password: nextPassword }), /Synthetic queue insert failure/);
    assert.equal((await user(request.email)).password_hash, account.password_hash);
    assert.equal((await user(request.email)).auth_version, account.auth_version);
    assert.ok(await new IdentityStore(db).resolveSession(login.token));
    assert.equal((await jobs(account.id)).length, 1);
    const resent = await recovery.requestRecovery(request.email);
    assert.equal((await worker().runOne({ send: async () => assert.fail("rotated recovery sent") })).state, "cancelled");
    assert.equal((await worker().runOne({ send: async message => assert.equal(message.text, resent.token) })).state, "accepted");
    assert.ok(await recovery.resetPassword({ token: resent.token, password: nextPassword }));
    assert.equal(await recovery.resetPassword({ token: resent.token, password: nextPassword }), null);
    assert.equal(await new IdentityStore(db).resolveSession(login.token), null);
    assert.equal((await jobs(account.id)).filter(x => x.purpose === "reset_notice").length, 1);
    assert.equal((await worker().runOne({ send: async message => assert.equal(message.text, "Synthetic password changed notice") })).state, "accepted");
    await db.query("delete from app.users where id=$1", [account.id]);
  });
}
