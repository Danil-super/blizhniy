import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url), ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../next.config.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
test("ordinary builds keep Next default ID; prebuilt builds require a full commit identifier", async () => {
  const environment = {}, exports = {};
  new Function("exports", "process", compiled)(exports, { env: environment });
  assert.equal(await exports.default.generateBuildId(), null);
  environment.BLIZHNIY_BUILD_COMMIT = "a".repeat(40);
  assert.equal(await exports.default.generateBuildId(), "a".repeat(40));
  for (const bad of ["", "main", "abc1234", "../outside", "a".repeat(41)]) {
    environment.BLIZHNIY_BUILD_COMMIT = bad;
    await assert.rejects(exports.default.generateBuildId(), /commit/i);
  }
});
