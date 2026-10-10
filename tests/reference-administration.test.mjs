import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAdminModule } from "./admin-module.mjs";

const { CatalogAdministration } = loadAdminModule("catalog-administration");
const { TariffAdministration } = loadAdminModule("tariff-administration");
const token = "a".repeat(64);
const id = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
function database(roots = [id, second], found = true) {
  const calls = [];
  let transactions = 0;
  const db = { async transaction(work) {
    transactions++;
    return work({ async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("from app.users")) return { rows: [{ id, role: "admin", isBlocked: false, verified: true, authVersion: "0" }], rowCount: 1 };
      if (sql.includes("app.sessions")) return { rows: [{ token_hash: "hash" }], rowCount: 1 };
      if (sql.startsWith("select id from app.categories")) return { rows: roots.map(id => ({ id })), rowCount: roots.length };
      return { rows: found ? [{ id }] : [], rowCount: found ? 1 : 0 };
    } });
  } };
  return { db, calls, transactionCount: () => transactions };
}

test("category edits reject malformed and overposting inputs before SQL", async () => {
  const fixture = database();
  const admin = new CatalogAdministration(fixture.db);
  for (const input of [null, [], {}, { id }, { id: "bad", name: "Name" },
    { id, name: "" }, { id, name: " ", active: true }, { id, name: "x".repeat(201) },
    { id, name: "bad\nname" }, { id, name: "\ud800" }, { id, active: 1 }, { id, active: undefined },
    { id, sortOrder: -1 }, { id, sortOrder: 1.5 }, { id, sortOrder: 1000001 },
    { id, slug: "new", name: "Name" }, { id, parentId: second, active: true }, { id, role: "admin", active: true }]) {
    await assert.rejects(admin.updateCategory(token, input), /Invalid category edit/);
  }
  assert.equal(fixture.transactionCount(), 0);
});

test("category edit binds a trimmed name, zero rank and false without altering stable IDs", async () => {
  const fixture = database();
  assert.deepEqual(await new CatalogAdministration(fixture.db).updateCategory(token, { id, name: "  Ремонт  ", sortOrder: 0, active: false }), { id });
  const write = fixture.calls.find(call => call.sql.startsWith("update app.categories"));
  assert.deepEqual(write.values, [id, "Ремонт", 0, false]);
  assert.ok(!write.sql.includes("slug=") && !write.sql.includes("parent_id="));
  assert.equal(fixture.transactionCount(), 1);
});

test("unknown category returns undefined, not an implicit insertion", async () => {
  const fixture = database([], false);
  assert.equal(await new CatalogAdministration(fixture.db).updateCategory(token, { id, active: false }), undefined);
});

test("invalid root reorder is rejected before SQL and incomplete order rolls back", async () => {
  const fixture = database();
  const admin = new CatalogAdministration(fixture.db);
  for (const ids of [null, [], [id, id], ["bad"], Array(1), Array(1001).fill(id)]) await assert.rejects(admin.reorderCategories(token, ids), /Invalid category edit/);
  assert.equal(fixture.transactionCount(), 0);
  await assert.rejects(admin.reorderCategories(token, [id]), /Invalid category edit/);
  assert.ok(!fixture.calls.some(call => call.sql.startsWith("update app.categories")));
});

test("full root reorder takes stable locks and writes one ordered array atomically", async () => {
  const fixture = database();
  await new CatalogAdministration(fixture.db).reorderCategories(token, [second, id]);
  assert.ok(fixture.calls.some(call => /order by id for update/.test(call.sql)));
  const writes = fixture.calls.filter(call => call.sql.startsWith("update app.categories"));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].values, [[second, id]]);
  assert.equal(fixture.transactionCount(), 1);
});

test("tariff edits reject implicit coercion, fractional kopeks and protected fields before SQL", async () => {
  const fixture = database();
  const admin = new TariffAdministration(fixture.db);
  const base = { id: "listing-publication" };
  for (const input of [null, [], {}, base, { ...base, price: undefined },
    ...["199", NaN, Infinity, -1, 0.001, 1e-7, 10000000000, {}, null].map(price => ({ ...base, price })),
    ...[0, -1, 1.5, 3651, "30", undefined].map(durationDays => ({ ...base, durationDays })),
    { ...base, active: "false" }, { ...base, name: " " }, { ...base, name: "\ud800" },
    { ...base, action: "job-response", price: 0 }, { ...base, role: "admin", price: 0 },
    { id: "invalid'id", price: 0 }]) await assert.rejects(admin.updateTariff(token, input), /Invalid tariff edit/);
  assert.equal(fixture.transactionCount(), 0);
});

test("tariff edits bind exact decimal text and explicit nullable duration", async () => {
  const fixture = database();
  assert.equal(await new TariffAdministration(fixture.db).updateTariff(token, { id: "listing-publication", name: "  Публикация  ", price: 0.29, active: false, durationDays: null }), true);
  const write = fixture.calls.find(call => call.sql.startsWith("update app.tariffs"));
  assert.deepEqual(write.values, ["listing-publication", "Публикация", "0.29", false, true, null]);
  assert.ok(!write.sql.includes("action=") && !write.sql.includes("insert"));
});

test("omitted tariff duration differs from null; zero and maximum prices are valid", async () => {
  for (const price of [0, 9999999999.99]) {
    const fixture = database();
    await new TariffAdministration(fixture.db).updateTariff(token, { id: "listing-publication", price });
    const write = fixture.calls.find(call => call.sql.startsWith("update app.tariffs"));
    assert.deepEqual(write.values, ["listing-publication", null, price.toFixed(2), null, false, null]);
  }
});

test("unknown tariff returns false instead of creating a tariff or retrying", async () => {
  const fixture = database([], false);
  assert.equal(await new TariffAdministration(fixture.db).updateTariff(token, { id: "unknown", active: false }), false);
  assert.equal(fixture.transactionCount(), 1);
});

test("admin repositories refuse browser construction", () => {
  globalThis.window = {};
  try {
    assert.throws(() => new CatalogAdministration(database().db), /server-only/);
    assert.throws(() => new TariffAdministration(database().db), /server-only/);
  } finally { delete globalThis.window; }
});
