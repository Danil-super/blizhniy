import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { loadAdminModule } from "./admin-module.mjs";

const { withAdminTransaction } = loadAdminModule("admin-authorization");
const token = "a".repeat(64);
const user = { id: "11111111-1111-4111-8111-111111111111", role: "admin", isBlocked: false, verified: true, authVersion: "0" };
function database({ principal = user, session = true, final = true } = {}) {
  const calls = [];
  let transactions = 0;
  const db = { async transaction(work) {
    transactions++;
    return work({ async query(sql, values) {
      calls.push({ sql, values });
      if (calls.length === 1) return { rows: principal ? [principal] : [], rowCount: principal ? 1 : 0 };
      const allowed = calls.length === 2 ? session : final;
      return { rows: allowed ? [{ token_hash: "hash" }] : [], rowCount: allowed ? 1 : 0 };
    } });
  } };
  return { db, calls, transactionCount: () => transactions };
}

test("malformed tokens and forged user objects cannot start an admin transaction", async () => {
  const { db, transactionCount } = database();
  for (const value of [undefined, null, "", "a".repeat(63), "A".repeat(64), { ...user, token }]) {
    await assert.rejects(withAdminTransaction(db, value, () => { throw new Error("must not work"); }), /Admin access required/);
  }
  assert.equal(transactionCount(), 0);
});

test("a verified live admin executes work inside the same transaction with hashed token parameters", async () => {
  const { db, calls, transactionCount } = database();
  const result = await withAdminTransaction(db, token, async tx => {
    assert.equal(typeof tx.query, "function");
    return { saved: true };
  });
  assert.deepEqual(result, { saved: true });
  assert.equal(transactionCount(), 1);
  const hash = createHash("sha256").update(token).digest("hex");
  assert.deepEqual(calls[0].values, [hash]);
  assert.deepEqual(calls[1].values, [hash, user.id, "0"]);
  assert.deepEqual(calls[2].values, [hash, user.id, "0"]);
  assert.ok(calls.every(call => !call.sql.includes(token) && !JSON.stringify(call.values).includes(token)));
});

test("missing, ordinary, blocked or unverified accounts cannot run admin work", async () => {
  for (const principal of [null, { ...user, role: "user" }, { ...user, isBlocked: true }, { ...user, verified: false }]) {
    const { db, calls } = database({ principal });
    await assert.rejects(withAdminTransaction(db, token, () => { throw new Error("must not work"); }), /Admin access required/);
    assert.equal(calls.length, 1);
  }
});

test("expired, idle, revoked or wrong-scope sessions cannot run work", async () => {
  const { db } = database({ session: false });
  await assert.rejects(withAdminTransaction(db, token, () => { throw new Error("must not work"); }), /Admin access required/);
});

test("expiry during work rejects the entire transaction instead of returning success", async () => {
  const { db } = database({ final: false });
  await assert.rejects(withAdminTransaction(db, token, () => "saved"), /Admin access required/);
});

test("callback failure is preserved and not automatically retried", async () => {
  const { db, transactionCount } = database();
  const error = new Error("synthetic write failure");
  await assert.rejects(withAdminTransaction(db, token, () => { throw error; }), actual => actual === error);
  assert.equal(transactionCount(), 1);
});

test("admin authorization refuses browser execution", async () => {
  const { db, transactionCount } = database();
  globalThis.window = {};
  try { await assert.rejects(withAdminTransaction(db, token, () => "saved"), /server-only/); }
  finally { delete globalThis.window; }
  assert.equal(transactionCount(), 0);
});
