import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { MailPayloadCipher } from "../src/lib/mail-outbox.ts";
import { RegistrationStore } from "./auth-mail-module.mjs";
import { loadProductionAuth } from "./production-auth-module.mjs";

const { renderProductionAuthMail, readConfirmationNoticeEnabled } = loadProductionAuth("production-auth-config");
const noticeIntent = {
  id: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  purpose: "confirm_notice",
  createdAt: new Date("2026-10-16T09:00:00.000Z"),
  expiresAt: new Date("2026-10-17T09:00:00.000Z"),
};
const noticePayload = { email: "confirmation-notice@example.invalid", token: null };

test("confirmation notice uses encrypted recipient-only payloads and survives a cipher restart", () => {
  const key = randomBytes(32);
  const cipher = new MailPayloadCipher(key);
  const encrypted = cipher.seal(noticeIntent, noticePayload);
  const second = cipher.seal(noticeIntent, noticePayload);
  assert.equal(encrypted.includes(Buffer.from(noticePayload.email)), false);
  assert.notDeepEqual(encrypted, second);
  assert.deepEqual(cipher.open(noticeIntent, encrypted, cipher.keyId), noticePayload);
  const restarted = new MailPayloadCipher(Buffer.from(key));
  assert.deepEqual(restarted.open(noticeIntent, encrypted, cipher.keyId), noticePayload);
});

test("confirmation notice accepts only a null token and exact payload fields", () => {
  const cipher = new MailPayloadCipher(randomBytes(32));
  assert.doesNotThrow(() => cipher.seal(noticeIntent, noticePayload));
  for (const payload of [
    { email: noticePayload.email },
    { ...noticePayload, token: "a".repeat(64) },
    { ...noticePayload, token: "" },
    { ...noticePayload, token: undefined },
    { ...noticePayload, password: "synthetic-password-never-mail" },
    { ...noticePayload, email: "victim@example.invalid\r\nBcc: other@example.invalid" },
    { ...noticePayload, email: "first@example.invalid,second@example.invalid" },
  ]) {
    assert.throws(() => cipher.seal(noticeIntent, payload), /Invalid encrypted mail payload/);
  }
  for (const purpose of ["confirm", "recover"]) {
    assert.throws(() => cipher.seal({ ...noticeIntent, purpose,
      expiresAt: new Date(noticeIntent.createdAt.getTime() + 1000) }, noticePayload), /Invalid encrypted mail payload/);
  }
});

test("confirmation notice has a positive lifetime bounded at exactly 24 hours", () => {
  const cipher = new MailPayloadCipher(randomBytes(32));
  const created = noticeIntent.createdAt.getTime();
  for (const lifetime of [1, 86400000]) {
    const intent = { ...noticeIntent, expiresAt: new Date(created + lifetime) };
    assert.deepEqual(cipher.open(intent, cipher.seal(intent, noticePayload), cipher.keyId), noticePayload);
  }
  for (const lifetime of [-1, 0, 86400001]) {
    assert.throws(() => cipher.seal({ ...noticeIntent, expiresAt: new Date(created + lifetime) }, noticePayload),
      /Invalid encrypted mail payload/);
  }
  for (const changes of [{ createdAt: new Date(NaN) }, { expiresAt: new Date(NaN) }]) {
    assert.throws(() => cipher.seal({ ...noticeIntent, ...changes }, noticePayload), /Invalid encrypted mail payload/);
  }
});

test("confirmation notice authenticates its purpose, identity, timestamps, key and ciphertext", () => {
  const cipher = new MailPayloadCipher(randomBytes(32));
  const encrypted = cipher.seal(noticeIntent, noticePayload);
  for (const changes of [
    { purpose: "reset_notice" },
    { purpose: "confirm" },
    { purpose: "recover" },
    { id: "10000000-0000-4000-8000-000000000002" },
    { userId: "20000000-0000-4000-8000-000000000002" },
    { createdAt: new Date(noticeIntent.createdAt.getTime() + 1) },
    { expiresAt: new Date(noticeIntent.expiresAt.getTime() - 1) },
  ]) {
    assert.throws(() => cipher.open({ ...noticeIntent, ...changes }, encrypted, cipher.keyId),
      /Invalid encrypted mail payload/);
  }
  const resetIntent = { ...noticeIntent, purpose: "reset_notice" };
  const resetEncrypted = cipher.seal(resetIntent, noticePayload);
  assert.throws(() => cipher.open(noticeIntent, resetEncrypted, cipher.keyId), /Invalid encrypted mail payload/);
  assert.throws(() => cipher.open(noticeIntent, encrypted, "0".repeat(32)), /Invalid encrypted mail payload/);
  assert.throws(() => new MailPayloadCipher(randomBytes(32)).open(noticeIntent, encrypted, cipher.keyId),
    /Invalid encrypted mail payload/);
  for (const index of [0, 1, 13, encrypted.length - 1]) {
    const changed = Buffer.from(encrypted);
    changed[index] ^= 1;
    assert.throws(() => cipher.open(noticeIntent, changed, cipher.keyId), /Invalid encrypted mail payload/);
  }
});

test("confirmation receipt has a fixed success subject and only the approved login link", () => {
  const message = renderProductionAuthMail(noticeIntent, noticePayload);
  assert.equal(message.id, noticeIntent.id);
  assert.equal(message.to, noticePayload.email);
  assert.match(message.subject, /почта подтверждена/iu);
  assert.deepEqual(message.text.match(/https?:\/\/[^\s<>"']+/gu),
    ["https://xn----9sbphbgks4a4a.xn--p1ai/auth"]);
  assert.doesNotMatch(message.text, /token|password|парол|\/auth\/(?:confirm|reset)|подтвердите|смените|восстановите|[a-f0-9]{64}/iu);
  const other = renderProductionAuthMail({ ...noticeIntent,
    id: "10000000-0000-4000-8000-000000000002", expiresAt: new Date("2026-10-16T10:00:00Z") },
  { email: "other@example.invalid", token: null });
  assert.equal(other.subject, message.subject, "recipient and metadata cannot change the fixed subject");
});

test("confirmation notice rollout is off by default and accepts only exact enabled or disabled values", () => {
  assert.equal(typeof readConfirmationNoticeEnabled, "function");
  assert.equal(readConfirmationNoticeEnabled({}), false);
  assert.equal(readConfirmationNoticeEnabled({ BLIZHNIY_AUTH_CONFIRMATION_NOTICE: undefined }), false);
  assert.equal(readConfirmationNoticeEnabled({ BLIZHNIY_AUTH_CONFIRMATION_NOTICE: "disabled" }), false);
  assert.equal(readConfirmationNoticeEnabled({ BLIZHNIY_AUTH_CONFIRMATION_NOTICE: "enabled" }), true);
  for (const value of ["", "true", "false", "1", "0", "ENABLED", "Disabled", " enabled", "enabled ", "enabled\n", "unexpected"]) {
    assert.throws(() => readConfirmationNoticeEnabled({ BLIZHNIY_AUTH_CONFIRMATION_NOTICE: value }),
      "invalid operator configuration must fail closed");
  }
});

test("confirmation notice opt-in requires the durable outbox cipher before any database access", () => {
  const unusedDatabase = {
    query() { throw new Error("Constructor must not access the database"); },
    transaction() { throw new Error("Constructor must not access the database"); },
  };
  assert.doesNotThrow(() => new RegistrationStore(unusedDatabase));
  assert.doesNotThrow(() => new RegistrationStore(unusedDatabase, undefined, { confirmationNotice: false }));
  const cipher = new MailPayloadCipher(randomBytes(32));
  assert.doesNotThrow(() => new RegistrationStore(unusedDatabase, cipher, { confirmationNotice: true }));
  assert.throws(() => new RegistrationStore(unusedDatabase, undefined, { confirmationNotice: true }),
    "enabling a confirmation notice without an encrypted outbox must reject configuration");
});
