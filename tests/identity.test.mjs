import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { hashPassword, verifyPassword, generateSessionToken, hashSessionToken, IdentityStore } from "../src/lib/identity.ts";

const password = "  Тестовая фраза 2026!  ";

test("password hash uses the approved scrypt cost and a fresh salt", async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false, "no silent trim");
  assert.equal(await verifyPassword("Неправильный пароль!", first), false);
});

for (const invalid of ["", "short password", " ".repeat(16), "a".repeat(129), "a".repeat(15) + "\0", "a".repeat(15) + "\ud800", null]) {
  test("invalid password is rejected without including the input in its error", async () => {
    await assert.rejects(hashPassword(invalid), { message: "Invalid password" });
    assert.equal(await verifyPassword(invalid, "broken"), false);
  });
}

test("tampered/expensive hash parameters and malformed encoding fail closed", async () => {
  for (const encoded of ["", null, "broken", "scrypt$999999999$8$1$" + "a".repeat(32) + "$" + "b".repeat(128),
    "scrypt$131072$8$1$" + "a".repeat(31) + "$" + "b".repeat(128)]) {
    assert.equal(await verifyPassword(password, encoded), false);
  }
});

test("hashing is bounded to two active operations instead of an unbounded queue", async () => {
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => hashPassword(password)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  const rejected = results.filter((result) => result.status === "rejected");
  assert.ok(rejected.every((result) => result.reason.message === "Password hashing capacity exceeded"));
  assert.match(await hashPassword(password), /^scrypt\$/, "capacity is released after completion");
});

test("session tokens are independent random 256-bit values; stored hashes cannot authenticate", () => {
  const tokens = Array.from({ length: 100 }, generateSessionToken);
  assert.equal(new Set(tokens).size, 100);
  assert.ok(tokens.every((token) => /^[a-f0-9]{64}$/.test(token)));
  const token = tokens[0];
  const digest = hashSessionToken(token);
  assert.equal(digest, createHash("sha256").update(token, "utf8").digest("hex"));
  assert.notEqual(digest, token);
  assert.notEqual(hashSessionToken(digest), digest);
});

test("malformed session tokens are rejected before database access", () => {
  for (const token of ["", "a".repeat(63), "G".repeat(64), "a".repeat(64) + " ", null]) {
    assert.equal(hashSessionToken(token), null);
  }
});

test("invalid tokens cannot make database calls, including logout and data-subject verification", async () => {
  const store = new IdentityStore({ query() { throw new Error("Unexpected database call"); } });
  assert.equal(await store.resolveSession("malformed"), null);
  assert.equal(await store.resolveDataSubjectSession("malformed"), null);
  await store.revokeSession("malformed");
});

test("a database outage is propagated; it never grants access or falls back to demo auth", async () => {
  const error = new Error("Database unavailable");
  const store = new IdentityStore({ query: async () => { throw error; } });
  await assert.rejects(store.resolveSession("a".repeat(64)), (actual) => actual === error);
  await assert.rejects(store.login("first@example.invalid", password), (actual) => actual === error);
});

test("identity primitives refuse browser execution", async () => {
  globalThis.window = {};
  try {
    assert.throws(() => generateSessionToken(), /server-only/);
    assert.throws(() => hashSessionToken("a".repeat(64)), /server-only/);
    assert.throws(() => new IdentityStore({}), /server-only/);
    await assert.rejects(hashPassword(password), /server-only/);
    await assert.rejects(verifyPassword(password, "broken"), /server-only/);
  } finally { delete globalThis.window; }
});
