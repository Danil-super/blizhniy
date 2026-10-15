import assert from "node:assert/strict";
import { test } from "node:test";
import * as contract from "../src/lib/listing-draft-contract.ts";
import { PostgresListingDraftStore, ListingDraftAccessError } from "./listing-draft-module.mjs";
import { loadAdminModule } from "./admin-module.mjs";
const { AppSessionAccessError } = loadAdminModule("app-session-transaction");
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
function fixture(missing = false) {
  const calls = [];
  const store = new PostgresListingDraftStore({ transaction: async work => work({ query: async (sql, values) => {
    calls.push(sql);
    if (sql.startsWith("select u.id")) return { rows: missing ? [] : [{ id: owner, role: "user", isBlocked: false, verified: true, authVersion: "0" }], rowCount: missing ? 0 : 1 };
    if (sql.startsWith("select token_hash")) return { rows: [{ token_hash: values[0] }], rowCount: 1 };
    throw new Error("Unexpected SQL in denial fixture");
  } }) });
  return { store, calls };
}
test("draft collection and empty creation reject invalid sessions and owner changes before resource SQL", async () => {
  for (const missing of [true, false]) {
    const f = fixture(missing), expected = missing ? AppSessionAccessError : ListingDraftAccessError;
    await assert.rejects(f.store.createEmpty("a".repeat(64), missing ? owner : other, key), expected);
    await assert.rejects(f.store.list("a".repeat(64), missing ? owner : other, null), expected);
    assert.equal(f.calls.some(sql => sql.includes("app.listings")), false);
  }
});
test("draft cursor preserves PostgreSQL microseconds and rejects invalid envelopes or dates", () => {
  const value = { id: key.toUpperCase(), updatedAt: "2026-10-15T12:13:14.123456Z" };
  assert.deepEqual(contract.parseListingDraftCursor(value), { id: key, updatedAt: value.updatedAt });
  assert.equal(contract.parseListingDraftCursor(null), null);
  for (const bad of [undefined, "", [], {}, { ...value, ownerId: owner }, { ...value, id: "bad" },
    { ...value, updatedAt: "2026-02-30T12:13:14.123456Z" }, { ...value, updatedAt: "2026-10-15T25:13:14.123456Z" },
    { ...value, updatedAt: "2026-10-15T12:13:14.123Z" }, { ...value, updatedAt: "0000-01-01T12:13:14.123456Z" }, { ...value, updatedAt: "infinity" }]) {
    assert.throws(() => contract.parseListingDraftCursor(bad), contract.ListingDraftInputError);
  }
});
test("stable blank creation keeps its versioned UUID namespace compatible across process versions", async () => {
  const expectedId = "e616dfde-3758-8d15-a2d0-c99b2cb20dd7";
  const store = new PostgresListingDraftStore({ transaction: async work => work({ query: async (sql, values) => {
    if (sql.startsWith("select u.id")) return { rows: [{ id: owner, role: "user", isBlocked: false, verified: true, authVersion: "0" }], rowCount: 1 };
    if (sql.startsWith("select token_hash")) return { rows: [{ token_hash: values[0] }], rowCount: 1 };
    if (sql.startsWith("insert into app.listings")) {
      assert.deepEqual(values, [expectedId, owner]);
      return { rows: [{ id: expectedId, revision: "1", listingType: "sell", title: "", description: "", categoryId: null, cityId: null, price: null }], rowCount: 1 };
    }
    if (sql.startsWith("update app.sessions")) return { rows: [], rowCount: 1 };
    throw new Error("Unexpected SQL in stable UUID fixture");
  } }) });
  const saved = await store.createEmpty("a".repeat(64), owner, key);
  assert.equal(saved.id, expectedId);assert.equal(saved.revision, "1");
});
