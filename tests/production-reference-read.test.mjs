import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { PostgresCatalogRepository } from "./catalog-module.mjs";
import { PostgresTariffRepository } from "../src/lib/postgres-tariffs.ts";
import { mapPublicCategoryRows } from "../src/lib/category-contract.ts";
import { categories } from "../src/lib/data.ts";
import { loadProductionAuth } from "./production-auth-module.mjs";

const ts = createRequire(import.meta.url)("typescript");
const { readProductionAuthConfig } = loadProductionAuth("production-auth-config");
const configured = { NODE_ENV: "production", BLIZHNIY_AUTH_MODE: "postgres", BLIZHNIY_AUTH_ORIGIN: "https://xn----9sbphbgks4a4a.xn--p1ai",
  BLIZHNIY_DB_HOST: "17e86f80f26733d39ef4b84d.twc1.net", BLIZHNIY_DB_PORT: "5432", BLIZHNIY_DB_NAME: "blizhniy_prod",
  BLIZHNIY_DB_USER: "blizhniy_runtime", BLIZHNIY_DB_PASSWORD: "synthetic-reference-password", BLIZHNIY_DB_SSL_MODE: "verify-full",
  BLIZHNIY_DB_CA_FILE: "/not-read-by-fixture/root.crt", BLIZHNIY_AUTH_MAIL_KEY_FILE: "/not-read-by-fixture/mail.key",
  BLIZHNIY_AUTH_RATE_SECRET: "r".repeat(64), TURNSTILE_SECRET_KEY: "t".repeat(40),
  BLIZHNIY_MAIL_MODE: "timeweb", BLIZHNIY_SMTP_USER: "notifications@xn----9sbphbgks4a4a.xn--p1ai", BLIZHNIY_SMTP_PASSWORD: "synthetic-smtp-password" };

// Trusted repository TS, following the existing native module-fixture convention.
function load(name, dependencies) {
  assert.ok(["production-reference-runtime", "category-store", "public-tariffs"].includes(name));
  const exports = {};
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  new Function("require", "exports", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(path => {
    if (Object.hasOwn(dependencies, path)) return dependencies[path];
    if (path === "server-only") return {};
    if (path === "react") return { cache: fn => fn };
    throw new Error("Unapproved reference fixture import");
  }, exports);
  return exports;
}

function loadReferenceRuntime(env, database) {
  return load("production-reference-runtime", {
    "./production-auth-config": { readProductionAuthConfig: () => readProductionAuthConfig(env) },
    "./production-auth-runtime": { getProductionAccountDatabase: database },
    "./postgres-catalog": { PostgresCatalogRepository }, "./postgres-tariffs": { PostgresTariffRepository },
  });
}

function consumers(runtime) {
  const legacy = () => assert.fail("PostgreSQL reads must not reach a legacy backend or seed");
  return {
    catalog: load("category-store", { "./production-reference-runtime": runtime,
      "@/lib/data": { categories }, "@/lib/runtime-mode": { shouldShowFallbackContent: () => true },
      "@/lib/supabase-rest": { isSupabaseRestConfigured: () => true, supabaseRest: legacy }, "./category-contract": { mapPublicCategoryRows } }),
    tariffs: load("public-tariffs", { "./production-reference-runtime": runtime, "./tariff-store": { getPublicTariffs: legacy } }),
  };
}

test("public reference runtime is lazy and disabled mode never requests an Auth pool", async () => {
  const runtime = loadReferenceRuntime({}, () => assert.fail("disabled read must not initialize a pool"));
  assert.equal(await runtime.getProductionReferenceRepositories(), null);
});

test("public reference runtime refuses old database, elevated role, incomplete TLS and unknown modes before pool access", async () => {
  for (const changes of [{ BLIZHNIY_DB_NAME: "default_db" }, { BLIZHNIY_DB_NAME: "blizhniy_staging" }, { BLIZHNIY_DB_USER: "gen_user" },
    { BLIZHNIY_DB_SSL_MODE: "disable" }, { BLIZHNIY_DB_PASSWORD: "" }, { BLIZHNIY_AUTH_MODE: "unknown" }]) {
    const runtime = loadReferenceRuntime({ ...configured, ...changes }, () => assert.fail("invalid configuration must not initialize a pool"));
    await assert.rejects(runtime.getProductionReferenceRepositories(), /Invalid production auth configuration/);
  }
});

test("PostgreSQL public consumers preserve stored tariff IDs/prices and category scope without legacy/static additions", async () => {
  const category = { id: "owned-root", slug: "instrumenty", name: "Stored name", parent_id: null, active: true, sort_order: 10 };
  const tariff = { id: "stored-tariff", action: "listing_publication", name: "Stored tariff", price: "9.29", duration_days: null, active: false };
  const runtime = loadReferenceRuntime(configured, async config => {
    assert.equal(config.origin, configured.BLIZHNIY_AUTH_ORIGIN);
    return { db: { async query(sql) { return { rows: sql.includes("app.categories") ? [category] : [tariff] }; } } };
  });
  const { catalog, tariffs } = consumers(runtime);
  assert.deepEqual(await catalog.getPublicCategories(), [{ slug: category.slug, name: category.name, children: [] }]);
  assert.equal((await catalog.getPublicCategoriesWithListingScope())[0].listingScope.id, category.id);
  assert.deepEqual(await tariffs.getPublicTariffs(), [{ id: tariff.id, action: tariff.action, name: tariff.name, price: 9.29, durationDays: null, active: false }]);
});

test("empty PostgreSQL references stay empty even when demo fallback is available", async () => {
  const runtime = loadReferenceRuntime(configured, async () => ({ db: { async query() { return { rows: [] }; } } }));
  const { catalog, tariffs } = consumers(runtime);
  assert.deepEqual(await catalog.getPublicCategories(), []);
  assert.deepEqual(await catalog.getPublicCategoriesWithListingScope(), []);
  assert.deepEqual(await tariffs.getPublicTariffs(), []);
});

test("failed verified pool and SQL reads propagate instead of falling back or retrying", async () => {
  const failure = new Error("synthetic reference failure");
  for (const database of [async () => { throw failure; }, async () => ({ db: { async query() { throw failure; } } })]) {
    const { catalog, tariffs } = consumers(loadReferenceRuntime(configured, database));
    await assert.rejects(catalog.getPublicCategories(), error => error === failure);
    await assert.rejects(tariffs.getPublicTariffs(), error => error === failure);
  }
});

test("public tariff adapter preserves the former public result while the new mode is disabled", async () => {
  const result = [{ id: "legacy-fixture" }];
  const store = load("public-tariffs", { "./production-reference-runtime": { getProductionReferenceRepositories: async () => null },
    "./tariff-store": { getPublicTariffs: async () => result } });
  assert.equal(await store.getPublicTariffs(), result);
});

test("reference runtime rejects a browser even with new mode disabled", async () => {
  globalThis.window = {};
  try { await assert.rejects(loadReferenceRuntime({}, () => assert.fail()).getProductionReferenceRepositories(), /server-only/); }
  finally { delete globalThis.window; }
});
