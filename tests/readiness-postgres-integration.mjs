// Called only by the owned PostgreSQL bootstrap fixture; no remote credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { verifyProductionAuthDatabase } from "../src/lib/production-auth-database.ts";

export async function testRestrictedReadiness(suite, db) {
  await suite.test("actual readiness handler reads categories through the verified restricted PostgreSQL connection", async () => {
    const require = createRequire(import.meta.url), ts = require("typescript"), exports = {};
    const source = readFileSync(new URL("../src/app/api/ready/route.ts", import.meta.url), "utf8");
    const config = {};
    new Function("require", "exports", ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText)(path => {
      if (path === "next/server") return require(path);
      if (path === "@/lib/production-auth-config") return { readProductionAuthConfig: () => config };
      if (path === "@/lib/production-auth-runtime") return { getProductionAccountDatabase: async value => {
        assert.equal(value, config);
        await verifyProductionAuthDatabase(db);
        return { db };
      } };
      if (path === "@/lib/supabase-rest") return {
        isSupabaseRestConfigured: () => assert.fail("PostgreSQL never checks legacy credentials"),
        supabaseRest: () => assert.fail("PostgreSQL never reads legacy references"),
      };
      throw new Error("Unapproved readiness integration dependency");
    }, exports);
    const response = await exports.GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "blizhniy" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
}
