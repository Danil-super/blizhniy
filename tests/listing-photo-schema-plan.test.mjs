import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { getBootstrapPlan } from "../scripts/bootstrap-postgres.mjs";

test("photo links require a separate additive plan and preserve every approved migration prefix", () => {
  const prior = getBootstrapPlan({ includeListings: true });
  const plan = getBootstrapPlan({ includeListingPhotos: true });
  assert.equal(plan.length, 13);assert.deepEqual(plan.slice(0,12), prior);
  assert.equal(plan.at(-1).name, "0013-listing-photos.sql");
  for (const [options, count] of [[{},7],[{includeMail:true},10],[{includeProfiles:true},11],[{includeListings:true},12]]) {
    assert.equal(getBootstrapPlan(options).length,count);
  }
  for (const bad of [null,1,"true"]) assert.throws(() => getBootstrapPlan({ includeListingPhotos: bad }), /Invalid/);
});
test("operator can inspect the photo plan without credentials or database access", () => {
  const result=spawnSync(process.execPath,["--experimental-strip-types","scripts/bootstrap-postgres.mjs","--plan-listing-photos"],{
    encoding:"utf8",timeout:10000,env:{PATH:process.env.PATH,PGHOST:"never-connect.example.invalid"},
  });
  assert.equal(result.status,0);
  const plan=JSON.parse(result.stdout);assert.equal(plan.migrations.length,13);assert.equal(plan.migrations.at(-1).name,"0013-listing-photos.sql");
});
