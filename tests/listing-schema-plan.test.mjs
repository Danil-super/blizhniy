import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { getBootstrapPlan } from "../scripts/bootstrap-postgres.mjs";

test("listings are an explicit additive plan, not an automatic account/mail upgrade", () => {
  const account = getBootstrapPlan({ includeProfiles: true });
  const listings = getBootstrapPlan({ includeListings: true });
  assert.equal(listings.length, 12);
  assert.deepEqual(listings.slice(0, 11), account);
  assert.equal(listings.at(-1).name, "0012-listings.sql");
  assert.equal(getBootstrapPlan().length, 7);
  assert.equal(getBootstrapPlan({ includeMail: true }).length, 10);
  assert.equal(getBootstrapPlan({ includeProfiles: true }).length, 11);
  for (const invalid of ["true", 1, null]) assert.throws(() => getBootstrapPlan({ includeListings: invalid }), /Invalid/);
});

test("operator can inspect the listing plan without environment credentials or a connection", () => {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/bootstrap-postgres.mjs", "--plan-listings"], {
    encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, PGHOST: "never-connect.example.invalid" },
  });
  assert.equal(run.status, 0);
  const plan = JSON.parse(run.stdout);
  assert.equal(plan.migrations.length, 12);
  assert.equal(plan.migrations.at(-1).name, "0012-listings.sql");
});
