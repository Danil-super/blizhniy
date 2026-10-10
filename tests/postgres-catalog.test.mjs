import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresCatalogRepository } from "./catalog-module.mjs";

const rows = [
  { id: "root", slug: "instrumenty", name: "Инструменты", parent_id: null, sort_order: 10, active: true },
  { id: "late", slug: "late", name: "Пила", parent_id: "root", sort_order: 30, active: true },
  { id: "early", slug: "early", name: "Дрель", parent_id: "root", sort_order: 10, active: true },
  { id: "duplicate", slug: "duplicate", name: "Дрель", parent_id: "root", sort_order: 20, active: true },
  { id: "hidden", slug: "hidden", name: "Скрытый", parent_id: "root", sort_order: 40, active: false },
  { id: "inactive-root", slug: "inactive-root", name: "Неактивный", parent_id: null, sort_order: 1, active: false },
];

function repository(result = rows) {
  const calls = [];
  const db = { async query(sql, values) { calls.push({ sql, values }); return { rows: result }; } };
  return { catalog: new PostgresCatalogRepository(db), calls };
}

test("PostgreSQL categories preserve visible labels and all direct child IDs in one read", async () => {
  const { catalog, calls } = repository();
  assert.deepEqual(await catalog.getPublicCategoriesWithListingScope(), [{
    slug: "instrumenty", name: "Инструменты", children: ["Дрель", "Пила"],
    listingScope: { id: "root", children: [
      { id: "early", name: "Дрель" }, { id: "duplicate", name: "Дрель" },
      { id: "late", name: "Пила" }, { id: "hidden", name: "Скрытый" },
    ] },
  }]);
  assert.equal(calls.length, 1);
});

test("public category projection excludes database IDs, flags and unexpected private columns", async () => {
  const { catalog } = repository(rows.map(row => ({ ...row, phone: "private", secret: "private" })));
  assert.deepEqual(await catalog.getPublicCategories(), [{ slug: "instrumenty", name: "Инструменты", children: ["Дрель", "Пила"] }]);
});

test("single category lookup binds its slug and returns the same scope contract", async () => {
  const { catalog, calls } = repository(rows.slice(0, 5));
  assert.equal((await catalog.getPublicCategoryWithListingScope("instrumenty")).listingScope.id, "root");
  assert.deepEqual(calls[0].values, ["instrumenty"]);
  assert.ok(!calls[0].sql.includes("instrumenty"));
});

test("empty catalog and unknown category stay empty without seeded/demo fallback", async () => {
  const { catalog } = repository([]);
  assert.deepEqual(await catalog.getPublicCategories(), []);
  assert.equal(await catalog.getPublicCategoryWithListingScope("missing"), undefined);
});

test("invalid or SQL-looking category slugs are rejected before database access", async () => {
  const { catalog, calls } = repository();
  for (const value of [undefined, null, "", " ", "A", "a--b", "-a", "a-", "a".repeat(151), "x'; drop table app.categories;--", { toPostgres() { throw new Error("must not execute"); } }]) {
    await assert.rejects(catalog.getPublicCategoryWithListingScope(value), /Invalid catalog input/);
  }
  assert.equal(calls.length, 0);
});

test("database failure is propagated without any fallback or automatic retry", async () => {
  let attempts = 0;
  const error = new Error("synthetic database unavailable");
  const catalog = new PostgresCatalogRepository({ async query() { attempts++; throw error; } });
  await assert.rejects(catalog.getPublicCategories(), actual => actual === error);
  assert.equal(attempts, 1);
});

test("catalog repository refuses browser runtime", () => {
  globalThis.window = {};
  try { assert.throws(() => repository(), /server-only/); }
  finally { delete globalThis.window; }
});
