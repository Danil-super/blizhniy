import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, root), "utf8");
}

function loadHealthRoute() {
  const js = ts.transpileModule(source("src/app/api/health/route.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };

  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id === "next/server") {
        return {
          NextResponse: {
            json: (body, options = {}) => ({ body, headers: options.headers, status: options.status ?? 200 }),
          },
        };
      }
      throw new Error(`Unexpected module ${id}`);
    },
  });

  return module.exports;
}

test("YooKassa webhook routes only expose POST", () => {
  const primary = source("src/app/api/payments/yookassa/webhook/route.ts");
  const legacy = source("src/app/api/webhooks/yookassa/route.ts");

  assert.match(primary, /export async function POST\b/);
  assert.doesNotMatch(primary, /export(?: async)? function GET\b/);
  assert.match(legacy, /export \{ dynamic, POST \}/);
  assert.doesNotMatch(legacy, /\bGET\b/);
});

test("health only returns a non-cacheable readiness signal", () => {
  const health = loadHealthRoute();
  const response = health.GET();

  assert.equal(response.body.ok, true);
  assert.deepEqual(Object.keys(response.body), ["ok"]);
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("global security headers include a one-year HSTS policy without subdomains", () => {
  const config = source("next.config.ts");

  assert.match(config, /key: "Strict-Transport-Security",\s*value: "max-age=31536000"/s);
  assert.doesNotMatch(config, /Strict-Transport-Security[\s\S]{0,100}includeSubDomains/);
});

test("listing configuration guidance no longer refers to Vercel", () => {
  const listings = source("src/app/api/listings/route.ts");

  assert.doesNotMatch(listings, /Vercel/);
  assert.match(listings, /переменные окружения сервера/);
});
