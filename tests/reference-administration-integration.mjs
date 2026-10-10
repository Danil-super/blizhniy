import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { hashSessionToken } from "../src/lib/identity.ts";
import { loadAdminModule } from "./admin-module.mjs";
import { waitForLock } from "./admin-authorization-integration.mjs";

const { CatalogAdministration } = loadAdminModule("catalog-administration");
const { TariffAdministration } = loadAdminModule("tariff-administration");

export async function testReferenceAdministration(suite, db, operator, fixture) {
  const catalog = new CatalogAdministration(db);
  const tariffs = new TariffAdministration(db);
  const categoryRows = async () => (await db.query("select id,parent_id,slug,name,sort_order,active from app.categories order by id")).rows;
  const tariffRows = async () => (await db.query("select id,action,name,price::text,duration_days,active from app.tariffs order by id")).rows;
  const roots = (await categoryRows()).filter(row => row.parent_id === null);
  const initialTariffs = await tariffRows();

  await suite.test("admin-only lists include hidden references without leaking identity columns", async () => {
    const listed = await catalog.listCategoryRows(fixture.adminToken);
    assert.deepEqual(listed.toSorted((a,b) => a.id.localeCompare(b.id)), await categoryRows());
    const saved = await tariffs.listTariffs(fixture.adminToken);
    assert.deepEqual(saved.toSorted((a,b) => a.id.localeCompare(b.id)), initialTariffs.map(row => ({ id: row.id, action: row.action,
      name: row.name, price: Number(row.price), durationDays: row.duration_days, active: row.active })));
    await assert.rejects(catalog.listCategoryRows(fixture.userToken), /Admin access required/);
    await assert.rejects(tariffs.listTariffs(fixture.userToken), /Admin access required/);
  });

  await suite.test("ordinary users cannot edit category, order or price", async () => {
    const before = await categoryRows();
    await assert.rejects(catalog.updateCategory(fixture.userToken, { id: roots[0].id, active: false }), /Admin access required/);
    await assert.rejects(catalog.reorderCategories(fixture.userToken, roots.map(row => row.id).reverse()), /Admin access required/);
    await assert.rejects(tariffs.updateTariff(fixture.userToken, { id: "listing-publication", price: 0 }), /Admin access required/);
    assert.deepEqual(await categoryRows(), before);
    assert.deepEqual(await tariffRows(), initialTariffs);
  });

  await suite.test("partial category edits preserve stable identity and hierarchy for roots and children", async () => {
    for (const original of [roots[0], (await categoryRows()).find(row => row.parent_id !== null)]) {
      try {
        const edited = await catalog.updateCategory(fixture.adminToken, { id: original.id, name: "  Ручное название  ", active: false, sortOrder: 0 });
        assert.deepEqual(edited, { ...original, name: "Ручное название", active: false, sort_order: 0 });
        assert.equal(await catalog.updateCategory(fixture.adminToken, { id: "00000000-0000-4000-8000-000000000000", active: false }), undefined);
      } finally { await catalog.updateCategory(fixture.adminToken, { id: original.id, name: original.name, active: original.active, sortOrder: original.sort_order }); }
    }
  });

  await suite.test("root order is all-or-nothing and concurrent complete orders never mix", async () => {
    const original = await categoryRows();
    const ids = roots.map(row => row.id);
    const child = original.find(row => row.parent_id !== null).id;
    for (const input of [ids.slice(1), [...ids.slice(1), child], [...ids.slice(1), "00000000-0000-4000-8000-000000000000"]]) {
      await assert.rejects(catalog.reorderCategories(fixture.adminToken, input), /Invalid category edit/);
      assert.deepEqual(await categoryRows(), original);
    }
    try {
      const reversed = [...ids].reverse();
      // Distinct admins exercise the root locks, not just serialization on one identity.
      await db.query("update app.users set role='admin' where id=$1", [fixture.user.id]);
      await Promise.all([catalog.reorderCategories(fixture.adminToken, ids), catalog.reorderCategories(fixture.userToken, reversed)]);
      const rows = (await categoryRows()).filter(row => row.parent_id === null);
      const saved = rows.toSorted((a, b) => a.sort_order - b.sort_order).map(row => row.id);
      assert.ok(JSON.stringify(saved) === JSON.stringify(ids) || JSON.stringify(saved) === JSON.stringify(reversed));
      assert.deepEqual(rows.map(row => row.sort_order).toSorted((a,b) => a-b), ids.map((_,i) => (i+1)*10));
      assert.deepEqual((await categoryRows()).filter(row => row.parent_id !== null), original.filter(row => row.parent_id !== null));
    } finally {
      await db.query("update app.users set role='user' where id=$1", [fixture.user.id]);
      for (const row of roots) await catalog.updateCategory(fixture.adminToken, { id: row.id, sortOrder: row.sort_order });
    }
  });

  await suite.test("tariff edits preserve omitted fields and distinguish null duration from omission", async () => {
    const original = initialTariffs.find(row => row.id === "listing-publication");
    const read = async () => (await tariffRows()).find(row => row.id === original.id);
    try {
      assert.equal(await tariffs.updateTariff(fixture.adminToken, { id: original.id, price: 0.29 }), true);
      assert.deepEqual(await read(), { ...original, price: "0.29" });
      await tariffs.updateTariff(fixture.adminToken, { id: original.id, name: "  Тариф  ", active: false, durationDays: null });
      assert.deepEqual(await read(), { ...original, price: "0.29", name: "Тариф", active: false, duration_days: null });
      await tariffs.updateTariff(fixture.adminToken, { id: original.id, price: 9999999999.99, durationDays: 3650 });
      assert.equal((await read()).price, "9999999999.99");
      assert.equal((await read()).duration_days, 3650);
      assert.equal(await tariffs.updateTariff(fixture.adminToken, { id: "unknown", price: 0 }), false);
      assert.equal((await tariffRows()).length, 7);
    } finally { await tariffs.updateTariff(fixture.adminToken, { id: original.id, name: original.name, price: Number(original.price), active: original.active, durationDays: original.duration_days }); }
    assert.deepEqual(await tariffRows(), initialTariffs);
  });

  await suite.test("expiry while waiting on a tariff row rolls back the entire edit", async () => {
    const token = await fixture.session();
    const hash = hashSessionToken(token);
    await db.query("update app.sessions set expires_at=clock_timestamp()+interval '2 seconds' where token_hash=$1", [hash]);
    let entered, pid;
    const barrier = new Promise(resolve => { entered = resolve; });
    const tracked = { transaction: work => db.transaction(async tx => { pid = (await tx.query("select pg_backend_pid() as pid")).rows[0].pid; entered(); return work(tx); }) };
    await operator.query("begin");
    let pending;
    try {
      await operator.query("select id from app.tariffs where id='listing-publication' for update");
      pending = assert.rejects(new TariffAdministration(tracked).updateTariff(token, { id: "listing-publication", price: 0 }), /Admin access required/);
      await barrier; await waitForLock(db, pid);
      // Database-observed expiry, not a blind delay. Still below runtime's 3s lock timeout.
      await operator.query("select pg_sleep(greatest(0,extract(epoch from expires_at-clock_timestamp()))+0.05) from app.sessions where token_hash=$1", [hash]);
      await operator.query("commit"); await pending;
      assert.deepEqual(await tariffRows(), initialTariffs);
    } finally { await operator.query("rollback"); if (pending) await pending; }
  });

  await suite.test("column-scoped runtime privileges allow edits but not passwords, role elevation or deletion", async () => {
    const role = `admin_fixture_${randomBytes(8).toString("hex")}`;
    // Generated identifier is a fixed prefix plus hex, not user input. Local owned container only.
    await operator.query(`create role ${role} nologin`);
    const grants = [
      `grant usage on schema app to ${role}`,
      `grant select on app.categories,app.tariffs to ${role}`,
      `grant select(id,role,is_blocked,email_verified_at,auth_version),update(auth_version) on app.users to ${role}`,
      `grant select(token_hash,user_id,auth_version,scope,expires_at,last_seen_at),update(last_seen_at) on app.sessions to ${role}`,
      `grant update(name,sort_order,active) on app.categories to ${role}`,
      `grant update(name,price,active,duration_days) on app.tariffs to ${role}`,
    ];
    const restricted = { transaction: work => db.transaction(async tx => { await tx.query(`set local role ${role}`); return work(tx); }) };
    try {
      for (const sql of grants) await operator.query(sql);
      assert.equal(await new TariffAdministration(restricted).updateTariff(fixture.adminToken, { id: "listing-publication", price: 199 }), true);
      assert.ok(await new CatalogAdministration(restricted).updateCategory(fixture.adminToken, { id: roots[0].id, name: roots[0].name }));
      await new CatalogAdministration(restricted).reorderCategories(fixture.adminToken, roots.map(row => row.id));
      for (const sql of ["select password_hash from app.users", "update app.users set role='admin'", "delete from app.users", "delete from app.categories", "create table app.unauthorized(id integer)"]) {
        await assert.rejects(restricted.transaction(tx => tx.query(sql)), { code: "42501", message: "PostgreSQL operation failed" });
      }
    } finally {
      for (const row of roots) await catalog.updateCategory(fixture.adminToken, { id: row.id, sortOrder: row.sort_order });
      await operator.query(`drop owned by ${role}`);
      await operator.query(`drop role ${role}`);
    }
  });
}
