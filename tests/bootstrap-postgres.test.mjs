import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getBootstrapPlan, getReferenceSeed, bootstrapPostgres } from "../scripts/bootstrap-postgres.mjs";

test("plain PostgreSQL bootstrap includes only approved migrations and reference exports", () => {
  const plan = getBootstrapPlan();
  assert.equal(plan.length, 5);
  assert.equal(plan.at(-1).name, "0005-reference-catalog.sql");
  for (const migration of plan) {
    assert.match(migration.sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(migration.sql, /^\s*(?:begin|commit);/im);
    assert.doesNotMatch(migration.sql, /auth\.uid|security definer|create extension/i);
  }
  const seed = getReferenceSeed();
  assert.deepEqual(Object.keys(seed).sort(), ["categories", "cities", "professions", "regions", "tariffs"]);
  assert.equal(seed.categories.length, 105);
  assert.equal(seed.categories.filter(x => x.parent_slug === null).length, 18);
  assert.equal(new Set(seed.categories.map(x => x.slug)).size, 105);
  assert.equal(seed.cities.length, 26);
  assert.equal(seed.professions.length, 14);
  assert.equal(seed.tariffs.length, 7);
  assert.equal(seed.tariffs.find(x => x.action === "ad_marquee").price, 299);
  assert.doesNotMatch(JSON.stringify(seed), /@|contact_phone|provider_payment_id|password_hash/);
});

test("bootstrap rejects an unconfirmed target before any SQL", async () => {
  const client = { connectionParameters: { host: "db.example.invalid", database: "default_db" },
    query() { throw new Error("must not query"); } };
  for (const confirmation of [undefined, "", "db.example.invalid:other", "other:default_db"]) {
    await assert.rejects(bootstrapPostgres(client, confirmation), /target confirmation/);
  }
});

test("operator requires explicit mode and never loads production dotenv or connects for a plan", () => {
  const script = fileURLToPath(new URL("../scripts/bootstrap-postgres.mjs", import.meta.url));
  const run = args => spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], {
    env: { PATH: process.env.PATH, PGHOST: "must-not-connect.example.invalid" }, encoding: "utf8", timeout: 10000,
  });
  const plan = run(["--plan"]);
  assert.equal(plan.status, 0);
  assert.match(plan.stdout, /0005-reference-catalog/);
  for (const args of [[], ["--apply"], ["--plan", "extra"], ["--apply", "wrong", "extra"]]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /must-not-connect/);
  }
});
