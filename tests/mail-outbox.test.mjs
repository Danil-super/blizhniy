import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { MailPayloadCipher, enqueueAuthMail, pruneExpiredMail } from "../src/lib/mail-outbox.ts";

const intent = { id: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000001",
  purpose: "confirm", createdAt: new Date("2026-10-12T11:00:00.000Z"), expiresAt: new Date("2026-10-12T12:00:00.000Z") };
const payload = { email: "synthetic@example.invalid", token: "a".repeat(64) };

test("authenticated encryption round-trips without retaining plaintext, using a new nonce for each seal", () => {
  const key = randomBytes(32);
  const cipher = new MailPayloadCipher(key);
  const first = cipher.seal(intent, payload);
  const second = cipher.seal(intent, payload);
  assert.ok(Buffer.isBuffer(first));
  assert.equal(first[0], 1);
  assert.notDeepEqual(first, second);
  assert.equal(first.includes(Buffer.from(payload.email)), false);
  assert.equal(first.includes(Buffer.from(payload.token)), false);
  assert.deepEqual(cipher.open(intent, first, cipher.keyId), payload);
  const restarted = new MailPayloadCipher(Buffer.from(key));
  assert.equal(restarted.keyId, cipher.keyId);
  assert.deepEqual(restarted.open(intent, first, cipher.keyId), payload);
  assert.equal(JSON.stringify(cipher).includes(key.toString("hex")), false);
  key.fill(0);
  assert.deepEqual(cipher.open(intent, first, cipher.keyId), payload, "caller key mutation cannot alter the copied KeyObject");
});

test("ciphertext, authentication tag, nonce, key and every routing context field are authenticated", () => {
  const cipher = new MailPayloadCipher(randomBytes(32));
  const encrypted = cipher.seal(intent, payload);
  for (const index of [0, 1, 13, encrypted.length-1]) {
    const altered = Buffer.from(encrypted);
    altered[index] ^= 1;
    assert.throws(() => cipher.open(intent, altered, cipher.keyId), { message: "Invalid encrypted mail payload" });
  }
  for (const changes of [{ id: "10000000-0000-4000-8000-000000000002" },
    { userId: "20000000-0000-4000-8000-000000000002" }, { purpose: "recover" },
    { createdAt: new Date(intent.createdAt.getTime()+1) }, { expiresAt: new Date(intent.expiresAt.getTime()+1) }]) {
    assert.throws(() => cipher.open({ ...intent, ...changes }, encrypted, cipher.keyId), { message: "Invalid encrypted mail payload" });
  }
  assert.throws(() => new MailPayloadCipher(randomBytes(32)).open(intent, encrypted, cipher.keyId), { message: "Invalid encrypted mail payload" });
  assert.throws(() => cipher.open(intent, encrypted, "0".repeat(32)), { message: "Invalid encrypted mail payload" });
  assert.throws(() => cipher.open(intent, encrypted), { message: "Invalid encrypted mail payload" });
});

test("configuration, metadata and plaintext are bounded, exact and fail closed", () => {
  for (const key of [undefined, "password", randomBytes(31), randomBytes(33)]) {
    assert.throws(() => new MailPayloadCipher(key), { message: "Invalid mail encryption key" });
  }
  const cipher = new MailPayloadCipher(randomBytes(32));
  for (const changes of [{ id: "bad" }, { userId: "bad" }, { purpose: "marketing" }, { expiresAt: new Date(NaN) }]) {
    assert.throws(() => cipher.seal({ ...intent, ...changes }, payload), { message: "Invalid encrypted mail payload" });
  }
  for (const value of [null, { ...payload, token: "short" }, { ...payload, email: "recipient\r\n@example.invalid" },
    { ...payload, email: "a@example.invalid,b@example.invalid" }, { ...payload, html: "extra" },
    { ...payload, email: "x".repeat(255) }, { ...payload, email: "x@xn--a.example" }]) {
    assert.throws(() => cipher.seal(intent, value), { message: "Invalid encrypted mail payload" });
  }
  for (const bytes of [null, Buffer.alloc(29), Buffer.alloc(2050)]) {
    assert.throws(() => cipher.open(intent, bytes, cipher.keyId), { message: "Invalid encrypted mail payload" });
  }
  assert.throws(() => cipher.seal({ ...intent, purpose: "reset_notice" }, payload), /Invalid/);
  const receipt = { email: payload.email, token: null };
  assert.deepEqual(cipher.open({ ...intent, purpose: "reset_notice" }, cipher.seal({ ...intent, purpose: "reset_notice" }, receipt), cipher.keyId), receipt);
  assert.throws(() => cipher.seal(intent, receipt), /Invalid/);
});

test("browser use is refused, including after creation", () => {
  const cipher = new MailPayloadCipher(randomBytes(32));
  const data = cipher.seal(intent, payload);
  globalThis.window = {};
  try {
    assert.throws(() => new MailPayloadCipher(randomBytes(32)), /server-only/);
    assert.throws(() => cipher.seal(intent, payload), /server-only/);
    assert.throws(() => cipher.open(intent, data, cipher.keyId), /server-only/);
  } finally { delete globalThis.window; }
});

test("enqueue binds only ciphertext to the caller transaction and returns only an intent ID", async () => {
  const cipher = new MailPayloadCipher(randomBytes(32));
  let parameters;
  const tx = { query: async (sql, values) => { parameters = values; return { rows: [{ id: intent.id }], rowCount: 1 }; } };
  assert.equal(await enqueueAuthMail(tx, cipher, intent, payload), intent.id);
  assert.equal(parameters.includes(payload.email), false);
  assert.equal(parameters.includes(payload.token), false);
  assert.equal(parameters[2], intent.purpose);
  assert.equal(parameters[3], cipher.keyId);
  assert.deepEqual(cipher.open(intent, parameters[4], parameters[3]), payload);
});

test("expiry cleanup has a strict batch bound; no unrestricted deletion or hidden retry", async () => {
  let called = 0;
  const db = { query: async () => { called++; return { rowCount: 7 }; } };
  assert.equal(await pruneExpiredMail(db, 20), 7);
  for (const limit of [0, -1, 1001, 1.5, "20"]) await assert.rejects(pruneExpiredMail(db, limit), /Invalid mail cleanup limit/);
  assert.equal(called, 1);
});
