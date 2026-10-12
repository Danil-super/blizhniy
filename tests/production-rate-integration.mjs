import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AuthRateLimiter } from "../src/lib/auth-http.ts";

export async function testProductionRateSchema(suite, db, applyMigration) {
  const owned = () => {
    const keys = new Set();
    const recorded = { query: async (sql, values) => { keys.add(values[0]); return db.query(sql, values); } };
    const secret = randomBytes(32).toString("hex");
    return { first: new AuthRateLimiter(recorded, secret), second: new AuthRateLimiter(recorded, secret),
      clear: () => db.query("delete from app.auth_rate_limits where key_hash=any($1::text[])", [[...keys]]) };
  };
  await suite.test("original PG rate schema reproduces the 62nd-request constraint failure; migration up/down preserves counters", async () => {
    const f = owned();
    try {
      for (let i = 0; i < 61; i++) assert.equal(await f.first.allowProduction("session", "192.0.2.50"), true);
      await assert.rejects(f.first.allowProduction("session", "192.0.2.50"), { code: "23514" });
    } finally { await f.clear(); }
    await applyMigration("0010-production-rate-limits.sql");
    const before = (await db.query("select * from app.auth_rate_limits order by key_hash")).rows;
    await applyMigration("0010-production-rate-limits.down.sql");
    assert.deepEqual((await db.query("select * from app.auth_rate_limits order by key_hash")).rows, before);
    await applyMigration("0010-production-rate-limits.sql");
  });
  await suite.test("real PG enforces 300 session requests per IP and refuses narrowing populated production counters", async () => {
    const f = owned();
    try {
      for (let i = 0; i < 300; i++) assert.equal(await (i % 2 ? f.first : f.second).allowProduction("session", "192.0.2.50"), true);
      assert.equal(await f.first.allowProduction("session", "192.0.2.50"), false);
      await assert.rejects(applyMigration("0010-production-rate-limits.down.sql"));
      assert.equal(await f.second.allowProduction("session", "192.0.2.50"), false, "failed rollback neither drops the new schema nor resets a counter");
    } finally { await f.clear(); }
  });
  await suite.test("real shared PG counters enforce production global budgets of 600 and 2000, without constraint errors or PII", async () => {
    for (const [scope, budget] of [["credential", 600], ["session", 2000]]) {
      const f = owned();
      try {
        for (let i = 0; i < budget; i++) assert.equal(await (i % 2 ? f.first : f.second).allowProduction(scope, `2001:db8::${(i + 1).toString(16)}`), true);
        assert.equal(await f.second.allowProduction(scope, "192.0.2.80"), false);
        assert.equal(await f.first.allowProduction(scope, "192.0.2.81"), false);
        const rows = (await db.query("select key_hash,attempts from app.auth_rate_limits where attempts>$1", [budget])).rows;
        assert.ok(rows.length > 0);
        assert.ok(rows.every(row => row.attempts === budget + 1 && /^[a-f0-9]{64}$/.test(row.key_hash)));
      } finally { await f.clear(); }
    }
  });
}
