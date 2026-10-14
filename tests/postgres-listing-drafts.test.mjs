import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresListingDraftStore, ListingDraftAccessError } from "./listing-draft-module.mjs";
import { ListingDraftInputError } from "../src/lib/listing-draft-contract.ts";
import { loadAdminModule } from "./admin-module.mjs";
const { AppSessionAccessError } = loadAdminModule("app-session-transaction");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const token = "a".repeat(64);

// Real session guard/store; substitute only SQL rows. Unexpected resource SQL fails the test.
function fixture(options = {}) {
  const calls = [];
  const store = new PostgresListingDraftStore({ transaction: async work => work({ query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.startsWith("select u.id")) return { rows: options.missing ? [] : [{ id: owner, role: "user", isBlocked: false, verified: true, authVersion: "0" }], rowCount: options.missing ? 0 : 1 };
    if (sql.startsWith("select token_hash")) return { rows: [{ token_hash: values[0] }], rowCount: 1 };
    throw new Error("Unexpected resource query in denial fixture");
  } }) });
  return { store, calls };
}

test("fabricated or malformed sessions cannot create, read or update a draft", async () => {
  for (const value of ["", "bad", token]) {
    const f = fixture({ missing: true });
    await assert.rejects(f.store.create(value, owner, { kind: "prodam" }), AppSessionAccessError);
    await assert.rejects(f.store.read(value, owner, id), AppSessionAccessError);
    await assert.rejects(f.store.update(value, owner, id, "1", { kind: "prodam" }), AppSessionAccessError);
    assert.equal(f.calls.some(c => c.sql.includes("app.listings")), false);
  }
});

test("an owner mismatch denies all draft operations before any listing query", async () => {
  const f = fixture();
  await assert.rejects(f.store.create(token, other, { kind: "prodam" }), ListingDraftAccessError);
  await assert.rejects(f.store.read(token, other, id), ListingDraftAccessError);
  await assert.rejects(f.store.update(token, other, id, "1", { kind: "prodam" }), ListingDraftAccessError);
  assert.equal(f.calls.some(c => c.sql.includes("app.listings")), false);
});

test("invalid core input, IDs and revision claims never reach listing SQL", async () => {
  const f = fixture();
  await assert.rejects(f.store.create(token, owner, { kind: "prodam", paid: true }), ListingDraftInputError);
  await assert.rejects(f.store.read(token, owner, "bad"), ListingDraftInputError);
  await assert.rejects(f.store.update(token, owner, id, 1, { kind: "prodam" }), ListingDraftInputError);
  await assert.rejects(f.store.update(token, owner, id, "1", { kind: "prodam", authorId: owner }), ListingDraftInputError);
  assert.equal(f.calls.some(c => c.sql.includes("app.listings")), false);
});

test("listing storage refuses browser construction", () => {
  globalThis.window = {};
  try { assert.throws(() => new PostgresListingDraftStore({}), /server-only/); }
  finally { delete globalThis.window; }
});
