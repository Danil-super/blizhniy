import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint } from "eslint";

test("lint ignores generated builds without ignoring application sources", async () => {
  const eslint = new ESLint();
  assert.equal(await eslint.isPathIgnored(".next/server/app/page.js"), true);
  assert.equal(await eslint.isPathIgnored(".next-local/server/app/page.js"), true);
  assert.equal(await eslint.isPathIgnored("src/lib/postgres.ts"), false);
});
