import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresTariffRepository } from "../src/lib/postgres-tariffs.ts";

const row = { id: "listing-publication", action: "listing_publication", name: "Размещение", price: "123.45", duration_days: 30, active: true };
function repository(rows = [row]) {
  const calls = [];
  const tariffs = new PostgresTariffRepository({ async query(sql, values) { calls.push({ sql, values }); return { rows }; } });
  return { tariffs, calls };
}

test("PostgreSQL tariffs preserve stored identity, numeric display price and nullable duration", async () => {
  const { tariffs } = repository([{ ...row, duration_days: null, active: false, password_hash: "private" }]);
  assert.deepEqual(await tariffs.getPublicTariffs(), [{ id: row.id, action: row.action, name: row.name, price: 123.45, durationDays: null, active: false }]);
});

test("tariff lookup binds canonical ID and distinguishes active-only lookup", async () => {
  const { tariffs, calls } = repository();
  assert.equal((await tariffs.getStoredTariffById(row.id)).id, row.id);
  assert.equal((await tariffs.getActiveStoredTariffById(row.id)).price, 123.45);
  assert.deepEqual(calls.map(call => call.values), [[row.id, false], [row.id, true]]);
  assert.ok(calls.every(call => !call.sql.includes(row.id)));
});

test("empty tariffs and missing active tariff never use static prices or demo fallback", async () => {
  const { tariffs } = repository([]);
  assert.deepEqual(await tariffs.getStoredTariffs(), []);
  assert.deepEqual(await tariffs.getPublicTariffs(), []);
  assert.equal(await tariffs.getStoredTariffById("missing"), undefined);
  assert.equal(await tariffs.getActiveStoredTariffById("missing"), undefined);
});

test("invalid tariff identifiers do not reach PostgreSQL or call object conversion hooks", async () => {
  const { tariffs, calls } = repository();
  for (const id of [null, undefined, "", " X ", "a--b", "-a", "a-", "a".repeat(101), "x';drop table app.tariffs;--", { toPostgres() { throw new Error("must not execute"); } }]) {
    await assert.rejects(tariffs.getStoredTariffById(id), /Invalid tariff input/);
    await assert.rejects(tariffs.getActiveStoredTariffById(id), /Invalid tariff input/);
  }
  assert.equal(calls.length, 0);
});

test("numeric display mapping covers zero, kopecks and maximum numeric(12,2)", async () => {
  for (const [price, expected] of [["0.00", 0], ["0.01", 0.01], ["0.29", 0.29], ["9999999999.99", 9999999999.99]]) {
    const { tariffs } = repository([{ ...row, price }]);
    assert.equal((await tariffs.getPublicTariffs())[0].price, expected);
  }
});

test("malformed monetary data fails closed instead of turning into zero or NaN", async () => {
  for (const price of ["", " ", "NaN", "Infinity", "-1.00", "1e3", "1.234", "10000000000.00", null]) {
    const { tariffs } = repository([{ ...row, price }]);
    await assert.rejects(tariffs.getPublicTariffs(), { message: "Invalid tariff price" });
  }
});

test("database read failure propagates once without legacy fallback", async () => {
  let attempts = 0;
  const error = new Error("synthetic read failure");
  const tariffs = new PostgresTariffRepository({ async query() { attempts++; throw error; } });
  await assert.rejects(tariffs.getPublicTariffs(), actual => actual === error);
  assert.equal(attempts, 1);
});

test("tariff repository refuses a browser runtime", () => {
  globalThis.window = {};
  try { assert.throws(() => repository(), /server-only/); }
  finally { delete globalThis.window; }
});
