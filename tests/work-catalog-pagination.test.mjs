import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/app/rabota/specialisty/[professionSlug]/page.tsx", import.meta.url), "utf8");
const scanSource = source.match(/  const matched = \[\] as Awaited[\s\S]*?  const storedSpecialists = matched\.slice\(skip, skip \+ pageSize\);/)?.[0];
assert.ok(scanSource, "Profession page must filter all batches before pagination");

test("profession page reaches matches beyond the first 100 profiles", async () => {
  const profiles = [
    ...Array.from({ length: 100 }, (_, id) => ({ id, profession: "Другая профессия" })),
    ...Array.from({ length: 60 }, (_, id) => ({ id: 100 + id, profession: "Сантехник" })),
  ];
  const script = ts.transpileModule(`exports.run = async function(page, listStoredSpecialistProfiles) {
    const pageSize = 24;
    const skip = (page - 1) * pageSize;
    const profession = { name: "Сантехник" };
${scanSource}
    return { ids: storedSpecialists.map((item) => item.id), hasMore: matched.length > skip + pageSize };
  };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(script, { exports });
  const result = await exports.run(2, async (limit, offset) => profiles.slice(offset, offset + limit));
  assert.equal(result.ids.length, 24);
  assert.equal(result.ids[0], 124);
  assert.equal(result.ids.at(-1), 147);
  assert.equal(result.hasMore, true);
});
