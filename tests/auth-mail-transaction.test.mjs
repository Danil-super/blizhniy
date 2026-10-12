import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { MailPayloadCipher } from "../src/lib/mail-outbox.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { RegistrationStore, PasswordRecoveryStore } from "./auth-mail-module.mjs";

const userId = "30000000-0000-4000-8000-000000000001";
const email = "synthetic-producer@example.invalid";
const createdAt = new Date("2026-10-12T12:00:00.123Z");
const input = { email, password: "Synthetic durable mail passphrase!", acceptedAgreement: true, acknowledgedPrivacy: true,
  agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy };
function fixture(purpose, duplicate=false) {
  const jobs = [];
  let transactions = 0;
  const tx = { query: async (sql, values) => {
    if (sql.includes("insert into app.users")) return { rows: duplicate ? [] : [{ id: userId, authVersion: "0" }] };
    if (sql.includes("from app.users")) return { rows: [{ id: userId, email, authVersion: "0", emailVerifiedAt: createdAt }] };
    if (sql.includes("insert into app.mail_outbox")) { jobs.push(values); return { rows: [{ id: values[0] }], rowCount: 1 }; }
    if (sql.includes("returning expires_at")) return { rows: [{ createdAt, expiresAt: new Date(createdAt.getTime()+(purpose==="confirm" ? 3600000 : 1800000)) }] };
    return { rows: [], rowCount: 1 };
  } };
  return { jobs, db: { query: async () => assert.fail("producer opened an out-of-transaction query"),
    transaction: async work => { transactions++; return work(tx); } }, transactions: () => transactions };
}

test("registration opt-in enqueues encrypted mail on the same business transaction and copies source timestamps", async () => {
  const f = fixture("confirm");
  const cipher = new MailPayloadCipher(randomBytes(32));
  const result = await new RegistrationStore(f.db, cipher).register(input);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.transactions(), 1);
  const [id,user,purpose,keyId,bytes,created,expires] = f.jobs[0];
  assert.equal(user, userId);
  assert.equal(purpose, "confirm");
  assert.deepEqual(created, createdAt);
  assert.deepEqual(expires, result.expiresAt);
  assert.deepEqual(cipher.open({ id,userId:user,purpose,createdAt:created,expiresAt:expires }, bytes, keyId), { email, token: result.token });
  assert.equal(bytes.includes(Buffer.from(result.token)), false);
});
test("duplicate and default-disabled registration never create SMTP jobs", async () => {
  const cipher = new MailPayloadCipher(randomBytes(32));
  const duplicate = fixture("confirm", true);
  assert.equal(await new RegistrationStore(duplicate.db, cipher).register(input), null);
  assert.equal(duplicate.jobs.length, 0);
  const local = fixture("confirm");
  assert.ok(await new RegistrationStore(local.db).register(input));
  assert.equal(local.jobs.length, 0);
});
test("recovery opt-in enqueues on the source transaction; cipher failure fails the business operation", async () => {
  const f = fixture("recover");
  const cipher = new MailPayloadCipher(randomBytes(32));
  const result = await new PasswordRecoveryStore(f.db, cipher).requestRecovery(email);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.transactions(), 1);
  const [id,user,purpose,keyId,bytes,created,expires] = f.jobs[0];
  assert.equal(purpose, "recover");
  assert.deepEqual(cipher.open({ id,userId:user,purpose,createdAt:created,expiresAt:expires }, bytes, keyId), { email, token: result.token });
  const failed = fixture("recover");
  await assert.rejects(new PasswordRecoveryStore(failed.db, { seal: () => { throw new Error("Synthetic cipher failure"); } }).requestRecovery(email), /Synthetic cipher failure/);
  assert.equal(failed.jobs.length, 0);
});
