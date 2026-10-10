import assert from "node:assert/strict";
import { PostgresCatalogRepository } from "./catalog-module.mjs";

export async function testCatalog(suite, db) {
  const catalog = new PostgresCatalogRepository(db);
  await suite.test("PostgreSQL catalog reads actual seed IDs without mixing old or demo identities", async () => {
    const categories = await catalog.getPublicCategoriesWithListingScope();
    assert.equal(categories.length, 18);
    assert.equal(categories.reduce((n, row) => n + 1 + row.listingScope.children.length, 0), 105);
    assert.ok(categories.every(row => /^[a-f0-9-]{36}$/.test(row.listingScope.id)));
    assert.deepEqual(await catalog.getPublicCategoryWithListingScope("instrumenty"), categories.find(row => row.slug === "instrumenty"));
    assert.equal(await catalog.getPublicCategoryWithListingScope("unknown-category"), undefined);
    const child = (await db.query("select slug from app.categories where parent_id is not null limit 1")).rows[0];
    assert.equal(await catalog.getPublicCategoryWithListingScope(child.slug), undefined);
    assert.ok((await catalog.getPublicCategories()).every(row => Object.keys(row).sort().join(",") === "children,name,slug"));
  });

  await suite.test("SQL snapshot keeps hidden scope, duplicate labels and deterministic Russian sort", async () => {
    const rollback = new Error("Rollback synthetic catalog fixture");
    await assert.rejects(db.transaction(async tx => {
      const { rows: [root] } = await tx.query("insert into app.categories(slug,name) values('fixture-root','Тестовая категория') returning id");
      const children = [];
      for (const [slug, name, active] of [["fixture-b", "Бета", true], ["fixture-a", "Альфа", true], ["fixture-duplicate", "Альфа", true], ["fixture-hidden", "Скрытый", false]]) {
        const { rows: [row] } = await tx.query("insert into app.categories(parent_id,slug,name,sort_order,active) values($1,$2,$3,10,$4) returning id,name", [root.id, slug, name, active]);
        children.push(row);
      }
      const transactional = new PostgresCatalogRepository(tx);
      const category = await transactional.getPublicCategoryWithListingScope("fixture-root");
      assert.deepEqual(category.children, ["Альфа", "Бета"]);
      assert.equal(category.listingScope.children.length, 4);
      assert.deepEqual(new Set(category.listingScope.children.map(row => row.id)), new Set(children.map(row => row.id)));
      assert.deepEqual(category.listingScope.children.map(row => row.name), ["Альфа", "Альфа", "Бета", "Скрытый"]);
      await tx.query("update app.categories set active=false where id=$1", [root.id]);
      assert.equal(await transactional.getPublicCategoryWithListingScope("fixture-root"), undefined);
      assert.ok(!(await transactional.getPublicCategories()).some(row => row.slug === "fixture-root"));
      throw rollback;
    }), actual => actual === rollback);
    assert.equal(await catalog.getPublicCategoryWithListingScope("fixture-root"), undefined);
  });

  await suite.test("catalog works with SELECT-only grants; identity reads and catalog writes are denied", async () => {
    await db.query("create role catalog_test_reader nologin");
    try {
      await db.query("grant usage on schema app to catalog_test_reader");
      await db.query("grant select on app.categories to catalog_test_reader");
      await db.transaction(async tx => {
        await tx.query("set local role catalog_test_reader");
        assert.equal((await new PostgresCatalogRepository(tx).getPublicCategories()).length, 18);
      }, { readOnly: true });
      for (const sql of ["select id from app.users", "update app.categories set active=false"]) {
        await assert.rejects(db.transaction(async tx => { await tx.query("set local role catalog_test_reader"); await tx.query(sql); }), { code: "42501", message: "PostgreSQL operation failed" });
      }
    } finally {
      await db.query("revoke select on app.categories from catalog_test_reader");
      await db.query("revoke usage on schema app from catalog_test_reader");
      await db.query("drop role catalog_test_reader");
    }
  });
}
