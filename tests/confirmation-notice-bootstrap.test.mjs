import assert from "node:assert/strict";
import { test } from "node:test";
import { getBootstrapPlan } from "../scripts/bootstrap-postgres.mjs";

test("confirmation notice bootstrap is explicit, additive and preserves all approved migration hashes", () => {
  const previous = getBootstrapPlan({ includeListingModeration: true });
  const next = getBootstrapPlan({ includeConfirmationNotice: true });
  assert.equal(previous.length, 14);
  assert.equal(next.length, 15);
  assert.deepEqual(next.slice(0, 14), previous);
  assert.equal(next[14].name, "0015-confirmation-notice.sql");
  assert.match(next[14].sql, /confirm_notice/);
  assert.doesNotMatch(next[14].sql, /\b(?:delete|truncate|grant|create role|drop table)\b/iu);
  assert.equal(getBootstrapPlan().length, 7);
  for (const value of ["enabled", 1, null]) assert.throws(() => getBootstrapPlan({ includeConfirmationNotice: value }));
});
