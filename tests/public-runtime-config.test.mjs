import assert from "node:assert/strict";
import { test } from "node:test";
import { getPublicRuntimeSetting } from "../src/lib/public-runtime-config.ts";

test("only allowlisted public settings are read at call time on the server", () => {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_2GIS_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const before = names.map(name => process.env[name]);
  try {
    for (const [setting, name] of [["legacy-url", names[0]], ["legacy-anon-key", names[1]], ["dgis-key", names[2]]]) {
      process.env[name] = "  synthetic-runtime-A  ";
      assert.equal(getPublicRuntimeSetting(setting), "synthetic-runtime-A");
      process.env[name] = "synthetic-runtime-B";
      assert.equal(getPublicRuntimeSetting(setting), "synthetic-runtime-B");
      delete process.env[name];
      assert.equal(getPublicRuntimeSetting(setting), undefined);
    }
    process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-private-key";
    for (const forbidden of ["SUPABASE_SERVICE_ROLE_KEY", "__proto__", "constructor", "toString"]) {
      assert.equal(getPublicRuntimeSetting(forbidden), undefined);
    }
  } finally {
    names.forEach((name, index) => { if (before[index] === undefined) delete process.env[name]; else process.env[name] = before[index]; });
  }
});

test("browser public configuration comes only from response meta, never stale build environment", () => {
  const before = globalThis.document;
  let content = " synthetic-response-value ";
  globalThis.document = { querySelector: selector => {
    assert.match(selector, /^meta\[name="blizhniy-(?:legacy-url|legacy-anon-key|dgis-key)"\]$/);
    return content === null ? null : { getAttribute: name => { assert.equal(name, "content"); return content; } };
  } };
  try {
    for (const setting of ["legacy-url", "legacy-anon-key", "dgis-key"]) assert.equal(getPublicRuntimeSetting(setting), "synthetic-response-value");
    content = "  ";
    assert.equal(getPublicRuntimeSetting("dgis-key"), undefined);
    content = null;
    assert.equal(getPublicRuntimeSetting("legacy-url"), undefined);
    assert.equal(getPublicRuntimeSetting("SUPABASE_SERVICE_ROLE_KEY"), undefined);
  } finally {
    if (before === undefined) delete globalThis.document; else globalThis.document = before;
  }
});
