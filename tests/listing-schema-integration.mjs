import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { bootstrapPostgres, getBootstrapPlan } from "../scripts/bootstrap-postgres.mjs";

// Called only inside the owned loopback PG18 fixture. Never reads an operator environment.
export async function testListingSchema(suite, admin, config, credentials) {
  const target = `${config.host}:${config.database}`;
  const prior = (await admin.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
  const down = readFileSync(new URL("../database/migrations/0012-listings.down.sql", import.meta.url), "utf8");
  const limited = new pg.Client({ ...config, ...credentials });
  await limited.connect();
  try {
    await suite.test("listing upgrade is empty, additive, journaled and explicitly repeatable", async () => {
      assert.equal((await bootstrapPostgres(admin, target, { includeListings: true })).applied, 1);
      const journal = (await admin.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
      assert.deepEqual(journal.slice(0, 11), prior);
      assert.deepEqual(journal, getBootstrapPlan({ includeListings: true }).map(({ name, sha256 }) => ({ name, sha256 })));
      assert.equal((await admin.query("select count(*)::integer as n from app.listings")).rows[0].n, 0);
      assert.equal((await bootstrapPostgres(admin, target, { includeListings: true })).applied, 0);
      await assert.rejects(bootstrapPostgres(admin, target, { includeProfiles: true }), /journal differs/);
    });
    await suite.test("empty listing rollback can be reapplied without changing earlier migrations", async () => {
      await admin.query(down);
      assert.equal((await admin.query("select to_regclass('app.listings') as table_name")).rows[0].table_name, null);
      await admin.query("delete from blizhniy_meta.migrations where name='0012-listings.sql'");
      assert.equal((await bootstrapPostgres(admin, target, { includeListings: true })).applied, 1);
      assert.deepEqual((await admin.query("select name,sha256 from blizhniy_meta.migrations where name<>'0012-listings.sql' order by name")).rows, prior);
    });
    await suite.test("migration does not silently grant runtime or PUBLIC listing access", async () => {
      for (const sql of ["select * from app.listings limit 0", "delete from app.listings where false",
        "update app.listings set is_paid=true where false", "truncate app.listings"]) {
        await assert.rejects(limited.query(sql), { code: "42501" });
      }
      const acl = (await admin.query(`select exists(select 1 from pg_class c,
        lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where c.oid='app.listings'::regclass and a.grantee=0) as public_access`)).rows[0];
      assert.equal(acl.public_access, false);
    });
    const owner = (await admin.query(`insert into app.users(email,password_hash) values($1,$2) returning id`,
      [`listing-${randomBytes(8).toString("hex")}@example.invalid`, `scrypt$131072$8$1$${"a".repeat(32)}$${"b".repeat(128)}`])).rows[0].id;
    const category = (await admin.query("select id from app.categories where active and parent_id is null limit 1")).rows[0].id;
    const city = (await admin.query("select id from app.cities limit 1")).rows[0].id;
    let draft;
    await suite.test("partial drafts default to unpaid and cannot accidentally become public", async () => {
      draft = (await admin.query("insert into app.listings(author_id,listing_type) values($1,'sell') returning *", [owner])).rows[0];
      assert.equal(draft.author_id, owner);
      assert.equal(draft.status, "draft");
      assert.equal(draft.is_paid, false);
      assert.equal(draft.title, "");
      assert.equal(draft.price, null);
      assert.equal(draft.revision, "1");
      assert.equal(draft.view_count, 0);
      assert.equal(draft.published_at, null);
      assert.equal(draft.expires_at, null);
      assert.equal((await admin.query("select count(*)::integer as n from app.listings where status='published'")).rows[0].n, 0);
    });
    await suite.test("invalid identities, reference IDs, types, lengths and counters are rejected by PostgreSQL", async () => {
      const cases = [
        ["author_id", "00000000-0000-4000-8000-000000000000", "23503"],
        ["category_id", "00000000-0000-4000-8000-000000000000", "23503"],
        ["city_id", "00000000-0000-4000-8000-000000000000", "23503"],
        ["listing_type", "vacancy", "23514"], ["status", "admin", "23514"],
        ["title", "t".repeat(161), "23514"], ["title", " spaced ", "23514"],
        ["description", "d".repeat(10001), "23514"], ["address", "a".repeat(301), "23514"],
        ["contact_phone", "p".repeat(41), "23514"], ["messenger_url", "m".repeat(501), "23514"],
        ["price", "-0.01", "23514"], ["price", "NaN", "23514"], ["price", "Infinity", "22003"],
        ["view_count", -1, "23514"], ["revision", 0, "23514"],
        ["booking", JSON.stringify([]), "23514"], ["booking", JSON.stringify({ text: "b".repeat(20001) }), "23514"],
        ["created_at", "infinity", "23514"], ["updated_at", "-infinity", "23514"],
      ];
      for (const [column, value, code] of cases) {
        // Column names are fixed test-owned literals, values are always parameters.
        await assert.rejects(admin.query(`update app.listings set ${column}=$1 where id=$2`, [value, draft.id]), { code });
      }
      assert.equal((await admin.query("select title from app.listings where id=$1", [draft.id])).rows[0].title, "");
    });
    await suite.test("exact locations require a finite coordinate pair, including valid zero coordinates", async () => {
      for (const sql of ["latitude=1", "show_exact_address=true", "latitude=91,longitude=0",
        "latitude=0,longitude=-181", "latitude='NaN',longitude=0", "latitude=0,longitude='Infinity'"]) {
        await assert.rejects(admin.query(`update app.listings set ${sql} where id=$1`, [draft.id]), { code: "23514" });
      }
      const row = (await admin.query(`update app.listings set latitude=0,longitude=0,show_exact_address=true,
        price=0 where id=$1 returning latitude,longitude,price`, [draft.id])).rows[0];
      assert.deepEqual(row, { latitude: "0", longitude: "0", price: "0.00" });
    });
    await suite.test("published rows require complete references, paid state and an ordered finite date pair", async () => {
      await assert.rejects(admin.query("update app.listings set status='published' where id=$1", [draft.id]), { code: "23514" });
      await assert.rejects(admin.query("update app.listings set is_paid=true where id=$1", [draft.id]), { code: "23514" });
      const insert = `insert into app.listings(author_id,listing_type,title,description,category_id,city_id,status,is_paid,published_at,expires_at)
        values($1,'sell',$2,$3,$4,$5,'published',$6,$7,$8) returning id`;
      const good = [owner, "Test publication", "Synthetic description", category, city, true, "2026-01-01", "2026-02-01"];
      for (const [index, value] of [[1, ""], [2, " "], [3, null], [4, null], [5, false],
        [6, null], [7, null], [7, "2026-01-01"], [7, "2025-12-01"], [6, "-infinity"], [7, "infinity"]]) {
        const invalid = [...good]; invalid[index] = value;
        await assert.rejects(admin.query(insert, invalid), { code: "23514" });
      }
      assert.equal((await admin.query(insert, good)).rowCount, 1);
      // SQL consistency is not payment-provider verification or public authorization.
    });
    await suite.test("owner/reference/public read indexes exist and are valid", async () => {
      const rows = (await admin.query(`select i.relname,x.indisvalid from pg_index x
        join pg_class i on i.oid=x.indexrelid where x.indrelid='app.listings'::regclass order by i.relname`)).rows;
      assert.deepEqual(rows.map(row => row.relname), ["listings_author_updated_idx", "listings_category_idx",
        "listings_city_idx", "listings_pkey", "listings_public_created_idx"]);
      assert.equal(rows.every(row => row.indisvalid), true);
    });
    await suite.test("nonempty rollback refuses data loss and owner erasure finds every listing", async () => {
      const before = (await admin.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows;
      try { await assert.rejects(admin.query(down), /Refusing to remove nonempty listings/); }
      finally { await admin.query("rollback"); }
      assert.equal((await admin.query("select count(*)::integer as n from app.listings where author_id=$1", [owner])).rows[0].n, 2);
      assert.deepEqual((await admin.query("select name,sha256 from blizhniy_meta.migrations order by name")).rows, before);
      await admin.query("delete from app.users where id=$1", [owner]);
      assert.equal((await admin.query("select count(*)::integer as n from app.listings where author_id=$1", [owner])).rows[0].n, 0);
    });
  } finally { await limited.end(); }
}
