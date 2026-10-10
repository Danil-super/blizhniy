import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAdminModule } from "./admin-module.mjs";
const { withAppSessionTransaction } = loadAdminModule("app-session-transaction");
test("an ordinary verified account receives its database identity inside a guarded app transaction", async () => {
  const principal = { id: "11111111-1111-4111-8111-111111111111", role: "user", isBlocked: false, verified: true, authVersion: "0" };
  let queries = 0;
  const db = { transaction: work => work({ query: async () => ({ rows: ++queries === 1 ? [principal] : [], rowCount: 1 }) }) };
  assert.equal(await withAppSessionTransaction(db, "a".repeat(64), async (_tx, user) => user.id), principal.id);
  assert.equal(queries, 3);
});
test("user work cannot run for invalid tokens, blocked accounts or expiry after work", async () => {
  for (const state of ["token", "blocked", "expired"]) {
    let queries = 0, entered = 0;
    const db = { transaction: work => work({ query: async () => {
      queries++;
      return { rows: queries === 1 ? [{ id: "id", role: "user", isBlocked: state === "blocked", verified: true, authVersion: "0" }] : [], rowCount: state === "expired" && queries === 3 ? 0 : 1 };
    } }) };
    await assert.rejects(withAppSessionTransaction(db, state === "token" ? "invalid" : "a".repeat(64), async () => { entered++; }), error => error.name === "AppSessionAccessError");
    assert.equal(entered, state === "expired" ? 1 : 0);
  }
});
