import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthRateLimiter } from "../src/lib/auth-http.ts";
import { createAccountSessionCookie } from "../src/lib/account-cookie.ts";

function limiter() {
  const counters = new Map();
  const keys = [];
  const db = { query: async (_sql, [key, limit]) => {
    keys.push(key);
    const count = Math.min((counters.get(key) ?? 0)+1, limit+1);
    counters.set(key, count);
    return { rows: [{ allowed: count <= limit }] };
  } };
  return { first: new AuthRateLimiter(db, "s".repeat(64)), second: new AuthRateLimiter(db, "s".repeat(64)), keys };
}
test("production limits share email/IP budgets across instances and do not disclose either identifier", async () => {
  const f = limiter();
  for (let i=0; i<20; i++) assert.equal(await f.first.allowProduction("credential", "192.0.2.1", `synthetic-${i}@example.invalid`), true);
  assert.equal(await f.second.allowProduction("credential", "192.0.2.1", "other@example.invalid"), false);
  const email = limiter();
  for (let i=0; i<5; i++) assert.equal(await email.first.allowProduction("credential", `192.0.2.${i+1}`, "synthetic@example.invalid"), true);
  assert.equal(await email.second.allowProduction("credential", "192.0.2.7", "synthetic@example.invalid"), false);
  assert.ok(email.keys.every(key => /^[a-f0-9]{64}$/.test(key)));
});
test("session namespace remains usable after credential denial; global budget bounds rotating identities", async () => {
  const f = limiter();
  for (let i=0; i<600; i++) assert.equal(await f.first.allowProduction("credential", `2001:db8::${(i+1).toString(16)}`, `synthetic-${i}@example.invalid`), true);
  assert.equal(await f.second.allowProduction("credential", "192.0.2.1", "new@example.invalid"), false);
  assert.equal(await f.second.allowProduction("session", "192.0.2.1"), true);
  const session = limiter();
  for (let i=0; i<300; i++) assert.equal(await session.first.allowProduction("session", "192.0.2.1"), true);
  assert.equal(await session.second.allowProduction("session", "192.0.2.1"), false);
});
test("invalid limiter scope/IP and cookie arguments fail before any database operation or header construction", async () => {
  const noDB = new AuthRateLimiter({ query: async () => assert.fail("invalid production key reached database") }, "s".repeat(64));
  await assert.rejects(noDB.allowProduction("unknown", "192.0.2.1"), /Invalid production rate limit key/);
  await assert.rejects(noDB.allowProduction("credential", "192.0.2.1,192.0.2.2"), /Invalid production rate limit key/);
  await assert.rejects(noDB.allowProduction("credential", "192.0.2.1", "a".repeat(255)), /Invalid production rate limit key/);
  for (const [token, maxAge] of [["", 1], ["bad", 0], ["a".repeat(64), 28801], ["a".repeat(64), -1], ["a".repeat(64), 1.5]]) {
    assert.throws(() => createAccountSessionCookie(token, maxAge), /Invalid session cookie/);
  }
});
