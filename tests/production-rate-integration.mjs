import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AuthRateLimiter } from "../src/lib/auth-http.ts";

export async function testProductionRateSchema(suite, db, applyMigration) {
  const owned = async () => {
    // Each burst measures one fixed window on the database clock.
    const { rows: [clock] } = await db.query(
      "select ceil((900 - mod(extract(epoch from clock_timestamp()), 900)) * 1000)::int as remaining_ms"
    );
    if (clock.remaining_ms < 15000) await delay(clock.remaining_ms + 1);
    const keys = new Set();
    const recorded = { query: async (sql, values) => { keys.add(values[0]); return db.query(sql, values); } };
    const secret = randomBytes(32).toString("hex");
    return { keys, first: new AuthRateLimiter(recorded, secret), second: new AuthRateLimiter(recorded, secret),
      clear: () => db.query("delete from app.auth_rate_limits where key_hash=any($1::text[])", [[...keys]]) };
  };
  await suite.test("original PG rate schema reproduces the 62nd-request constraint failure; migration up/down preserves counters", async () => {
    const f = await owned();
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
    const f = await owned();
    try {
      for (let i = 0; i < 300; i++) assert.equal(await (i % 2 ? f.first : f.second).allowProduction("session", "192.0.2.50"), true);
      assert.equal(await f.first.allowProduction("session", "192.0.2.50"), false);
      await assert.rejects(applyMigration("0010-production-rate-limits.down.sql"));
      assert.equal(await f.second.allowProduction("session", "192.0.2.50"), false, "failed rollback neither drops the new schema nor resets a counter");
    } finally { await f.clear(); }
  });
  await suite.test('real PG keeps human-verified login and recovery email/IP counters independent across instances', async () => {
    const f = await owned();
    try {
      for (let i = 0; i < 5; i++) assert.equal(await f.first.allowProductionEmail('login', 'owner@example.invalid'), true);
      assert.equal(await f.second.allowProductionEmail('login', 'owner@example.invalid'), false);
      assert.equal(await f.second.allowProductionEmail('recover', 'owner@example.invalid'), true);
      for (let i = 0; i < 20; i++) assert.equal(await f.first.allowProductionAttempt('login', '192.0.2.90'), true);
      assert.equal(await f.second.allowProductionAttempt('login', '192.0.2.90'), false);
      assert.equal(await f.second.allowProductionAttempt('recover', '192.0.2.90'), true);
    } finally { await f.clear(); }
  });
  await suite.test("a full credential counter in the previous window leaves the current window available", async () => {
    const f = await owned();
    const attempt = () => f.first.allowProductionAttempt("login", "192.0.2.93");
    try {
      for (let i = 0; i < 20; i++) assert.equal(await attempt(), true);
      assert.equal(await attempt(), false);
      await db.query("update app.auth_rate_limits set window_start=window_start-interval '15 minutes' where key_hash=any($1::text[])", [[...f.keys]]);
      assert.equal(await attempt(), true);
      const { rows } = await db.query("select attempts from app.auth_rate_limits where key_hash=any($1::text[]) order by attempts", [[...f.keys]]);
      assert.deepEqual(rows.map(row => row.attempts), [1, 1, 20, 21]);
    } finally { await f.clear(); }
  });
  await suite.test("real shared PG counters enforce production global budgets of 600 and 2000, without constraint errors or PII", async () => {
    for (const [scope, budget] of [["credential", 600], ["session", 2000]]) {
      const f = await owned();
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
  await suite.test('real PG IP-denied bursts preserve credential, session and phone capacity across limiter instances', async () => {
    for (const [method, attempts, allowed] of [
      ['credential', 620, 20], ['session', 2020, 300], ['remembered', 620, 20], ['phone', 120, 10],
    ]) {
      const f = await owned();
      const invoke = (limiter, ip) => method === 'phone' ? limiter.allowPhoneVerification(ip)
        : method === 'remembered' ? limiter.allowProductionAttempt('login', ip) : limiter.allowProduction(method, ip);
      try {
        const outcomes = await Promise.all(Array.from({length: attempts}, (_, i) => invoke(i % 2 ? f.first : f.second, '192.0.2.91')));
        assert.equal(outcomes.filter(Boolean).length, allowed, method);
        assert.equal(await invoke(f.second, '192.0.2.92'), true, `${method}: another source retains capacity`);
      } finally { await f.clear(); }
    }
  });
  await suite.test('real PG email-denied traffic does not consume the global credential budget', async () => {
    const f = await owned();
    try {
      const outcomes = await Promise.all(Array.from({length: 620}, (_, i) =>
        (i % 2 ? f.first : f.second).allowProduction('credential', `2001:db8::${(i+1).toString(16)}`, 'same@example.invalid')));
      assert.equal(outcomes.filter(Boolean).length, 5);
      assert.equal(await f.second.allowProduction('credential', '192.0.2.92', 'other@example.invalid'), true);
    } finally { await f.clear(); }
  });
  await suite.test('real PG distributed concurrent requests retain each aggregate overload cap', async () => {
    for (const [scope, limit] of [['credential', 600], ['session', 2000], ['phone', 100]]) {
      const f = await owned();
      try {
        const outcomes = await Promise.all(Array.from({length: limit+10}, (_, i) => {
          const limiter = i % 2 ? f.first : f.second, ip = `2001:db8::${(i+1).toString(16)}`;
          return scope === 'phone' ? limiter.allowPhoneVerification(ip) : limiter.allowProduction(scope, ip);
        }));
        assert.equal(outcomes.filter(Boolean).length, limit, scope);
      } finally { await f.clear(); }
    }
  });
}
