import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const js = ts.transpileModule(readFileSync(new URL("../src/lib/supabase-browser.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("browser SDK cannot be created or reused outside the explicit legacy document", () => {
  let mode = "legacy", creations = 0;
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", "document", js)(
    () => ({ createClient: () => { creations++; return { synthetic: true }; } }), module, module.exports,
    { env: { NEXT_PUBLIC_SUPABASE_URL: "https://legacy-fixture.example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-key" } },
    { querySelector: () => mode === null ? null : { getAttribute: () => mode } },
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
