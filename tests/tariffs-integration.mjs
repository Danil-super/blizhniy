import assert from "node:assert/strict";
import { PostgresTariffRepository } from "../src/lib/postgres-tariffs.ts";

export async function testTariffs(suite, db) {
  const tariffs = new PostgresTariffRepository(db);
  await suite.test("SQL tariffs preserve seven seeded actions and sort numeric prices, not text", async () => {
    const rows = await tariffs.getPublicTariffs();
    assert.equal(rows.length, 7);
    assert.equal(new Set(rows.map(row => row.action)).size, 7);
    assert.deepEqual(rows.map(row => row.price), [99, 199, 199, 299, 299, 499, 1000]);
    assert.equal((await tariffs.getActiveStoredTariffById("listing-publication")).durationDays, 30);
    assert.equal((await tariffs.getStoredTariffById("job-response")).durationDays, null);
    assert.equal(await tariffs.getStoredTariffById("unknown-tariff"), undefined);
  });

  await suite.test("manual tariff identity/price/duration/activity changes are read fresh without seed synthesis", async () => {
    const rollback = new Error("Rollback synthetic tariff changes");
    await assert.rejects(db.transaction(async tx => {
      await tx.query("update app.tariffs set id='custom-listing',name='Новая цена',price=0.29,duration_days=null,active=false where id=$1", ["listing-publication"]);
      const transactional = new PostgresTariffRepository(tx);
      const expected = { id: "custom-listing", action: "listing_publication", name: "Новая цена", price: 0.29, durationDays: null, active: false };
      assert.deepEqual(await transactional.getStoredTariffById("custom-listing"), expected);
      assert.equal(await transactional.getStoredTariffById("listing-publication"), undefined);
      assert.equal(await transactional.getActiveStoredTariffById("custom-listing"), undefined);
      assert.deepEqual((await transactional.getPublicTariffs()).find(row => row.id === "custom-listing"), expected);
      await tx.query("update app.tariffs set price=9999999999.99,duration_days=3650,active=true where id='custom-listing'");
      const updated = await transactional.getActiveStoredTariffById("custom-listing");
      assert.equal(updated.price, 9999999999.99);
      assert.equal(updated.durationDays, 3650);
      throw rollback;
    }), actual => actual === rollback);
    assert.equal((await tariffs.getStoredTariffById("listing-publication")).price, 199);
    assert.equal(await tariffs.getStoredTariffById("custom-listing"), undefined);
  });

  await suite.test("an empty tariff table stays empty without restoring prices during reads", async () => {
    const rollback = new Error("Rollback empty tariff fixture");
    await assert.rejects(db.transaction(async tx => {
      await tx.query("delete from app.tariffs");
      const transactional = new PostgresTariffRepository(tx);
      assert.deepEqual(await transactional.getPublicTariffs(), []);
      assert.equal(await transactional.getActiveStoredTariffById("listing-publication"), undefined);
      throw rollback;
    }), actual => actual === rollback);
    assert.equal((await tariffs.getPublicTariffs()).length, 7);
  });

  await suite.test("tariff SELECT-only role cannot change prices or read user credentials", async () => {
    await db.query("create role tariffs_test_reader nologin");
    try {
      await db.query("grant usage on schema app to tariffs_test_reader");
      await db.query("grant select on app.tariffs to tariffs_test_reader");
      await db.transaction(async tx => {
        await tx.query("set local role tariffs_test_reader");
        assert.equal((await new PostgresTariffRepository(tx).getPublicTariffs()).length, 7);
      }, { readOnly: true });
      for (const sql of ["select password_hash from app.users", "update app.tariffs set price=0", "delete from app.tariffs"]) {
        await assert.rejects(db.transaction(async tx => { await tx.query("set local role tariffs_test_reader"); await tx.query(sql); }), { code: "42501", message: "PostgreSQL operation failed" });
      }
    } finally {
      await db.query("revoke select on app.tariffs from tariffs_test_reader");
      await db.query("revoke usage on schema app from tariffs_test_reader");
      await db.query("drop role tariffs_test_reader");
    }
  });
}
