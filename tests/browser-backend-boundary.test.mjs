import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const js = ts.transpileModule(readFileSync(new URL("../src/lib/supabase-browser.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const configJs = ts.transpileModule(readFileSync(new URL("../src/lib/public-runtime-config.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function loadConfig(document) {
  const exports = {};
  new Function("exports", "document", configJs)(exports, document);
  return exports;
}

test("browser SDK cannot be created or reused outside the explicit legacy document", () => {
  let mode = "legacy", creations = 0;
  const module = { exports: {} };
  const document = { querySelector: selector => {
    const content = selector.includes("auth-backend") ? mode : selector.includes("legacy-url") ? "https://legacy-fixture.example.invalid" : "synthetic-key";
    return content === null ? null : { getAttribute: () => content };
  } };
  const config = loadConfig(document);
  new Function("require", "module", "exports", "process", "document", js)(
    name => name === "@/lib/public-runtime-config" ? config : ({ createClient: () => { creations++; return { synthetic: true }; } }), module, module.exports,
    { env: { NEXT_PUBLIC_SUPABASE_URL: "https://legacy-fixture.example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-key" } },
    document,
  );
  const sdk = module.exports;
  const original = sdk.getSupabaseBrowserClient();
  for (const blocked of ["postgres", "unavailable", "unknown", null]) {
    mode = blocked;
    assert.equal(sdk.isSupabaseBrowserConfigured(), false);
    assert.throws(() => sdk.getSupabaseBrowserClient());
    assert.deepEqual(sdk.getSupabaseBrowserConfig(), { supabaseAnonKey: undefined, supabaseUrl: undefined });
  }
  assert.equal(creations, 1);
  mode = "legacy";
  assert.equal(sdk.getSupabaseBrowserClient(), original);
});

test("legacy browser SDK uses runtime public values and refuses missing meta despite stale build keys", () => {
  const values = { "blizhniy-auth-backend": "legacy", "blizhniy-legacy-url": "https://runtime-fixture.example.invalid", "blizhniy-legacy-anon-key": "synthetic-runtime-anon" };
  const document = { querySelector: selector => {
    const name = /^meta\[name="([^"]+)"\]$/.exec(selector)?.[1];
    return Object.hasOwn(values, name) ? { getAttribute: () => values[name] } : null;
  } };
  let created;
  const module = { exports: {} }, config = loadConfig(document);
  new Function("require", "module", "exports", "process", "document", js)(
    name => name === "@/lib/public-runtime-config" ? config : { createClient: (url, key) => { created = [url, key]; return {}; } },
    module, module.exports, { env: { NEXT_PUBLIC_SUPABASE_URL: "https://stale.example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-stale-key" } }, document,
  );
  module.exports.getSupabaseBrowserClient();
  assert.deepEqual(created, [values["blizhniy-legacy-url"], values["blizhniy-legacy-anon-key"]]);
  delete values["blizhniy-legacy-anon-key"];
  assert.equal(module.exports.isSupabaseBrowserConfigured(), false);
  assert.throws(() => module.exports.getSupabaseBrowserClient());
});
