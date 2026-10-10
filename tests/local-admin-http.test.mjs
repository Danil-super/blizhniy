import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import * as boundary from "../src/lib/auth-http.ts";
import * as crypto from "node:crypto";
import { loadAdminModule } from "./admin-module.mjs";

const ts = createRequire(import.meta.url)("typescript");
const { AdminAccessError } = loadAdminModule("admin-authorization");
const { CategoryEditInputError } = loadAdminModule("catalog-administration");
const { TariffEditInputError } = loadAdminModule("tariff-administration");
const env = { NODE_ENV: "test", BLIZHNIY_AUTH_MODE: "local", BLIZHNIY_DB_HOST: "127.0.0.1", BLIZHNIY_DB_SSL_MODE: "disable",
  BLIZHNIY_AUTH_ORIGIN: "https://127.0.0.1:3037", BLIZHNIY_LOCAL_MAIL_URL: "http://127.0.0.1:3038/messages", BLIZHNIY_AUTH_RATE_SECRET: "s".repeat(64) };
const token = "a".repeat(64);
const cookie = `__Host-blizhniy_session=${token}`;
function setup(changes = {}, options = {}) {
  const calls = { database: 0, limit: 0, secrets: [], operations: [], logs: [] };
  const categories = [{ id: "11111111-1111-4111-8111-111111111111", parent_id: null, slug: "tools", name: "Tools", sort_order: 10, active: true }];
  const tariffs = [{ id: "listing-publication", action: "listing_publication", name: "Publication", price: 199, active: true, durationDays: 30 }];
  const operation = async (name, ...args) => {
    calls.operations.push([name, ...args]);
    if (options.failure) throw options.failure;
    if (options.denied) throw new AdminAccessError();
    return options.missing ? undefined : name === "categories" ? categories : name === "tariffs" ? tariffs : name === "category" ? categories[0] : true;
  };
  const dependencies = {
    "node:crypto": crypto,
    "./auth-http": { ...boundary, readLocalAuthConfig: () => boundary.readLocalAuthConfig({ ...env, ...changes }), AuthRateLimiter: class {
      constructor(_db, secret) { calls.secrets.push(secret); }
      async allow() { calls.limit++; if (options.limitFailure) throw new Error("secret database detail"); return !options.limited; }
    } },
    "./local-database": { getLocalDatabase: () => { calls.database++; return {}; } },
    "./account-cookie": loadAdminModule("account-cookie"),
    "./admin-authorization": { AdminAccessError },
    "./catalog-administration": { CategoryEditInputError, CatalogAdministration: class {
      listCategoryRows(session) { return operation("categories", session); }
      updateCategory(session, input) { return operation("category", session, input); }
      reorderCategories(session, ids) { return operation("order", session, ids); }
    } },
    "./tariff-administration": { TariffEditInputError, TariffAdministration: class {
      listTariffs(session) { return operation("tariffs", session); }
      updateTariff(session, input) { return operation("tariff", session, input); }
    } },
  };
  const exports = {};
  const source = readFileSync(new URL("../src/lib/local-admin-http.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Error, Response, URL, console: { info: line => calls.logs.push(line) },
    require: name => { if (!(name in dependencies)) throw new Error("Unexpected admin HTTP import"); return dependencies[name]; },
  });
  const origin = changes.BLIZHNIY_AUTH_ORIGIN ?? env.BLIZHNIY_AUTH_ORIGIN;
  const request = (data = {}, headers = {}, method = "POST", query = "") => new Request(origin + "/api/admin/local/categories" + query, {
    method, headers: { host: new URL(origin).host, origin, "x-blizhniy-request": "1", "content-type": "application/json", cookie, ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(data) }),
  });
  return { calls, request, handle: exports.handleLocalAdminRequest, categories, tariffs };
}

test("off, production, remote DB, HTTP and unknown admin resources never initialize the database", async () => {
  for (const [changes, status] of [[{ BLIZHNIY_AUTH_MODE: "" }, 404], [{ NODE_ENV: "production" }, 503],
    [{ BLIZHNIY_DB_HOST: "db.example.invalid" }, 503], [{ BLIZHNIY_AUTH_ORIGIN: "http://127.0.0.1:3037" }, 503]]) {
    const app = setup(changes);
    assert.equal((await app.handle(app.request(), "categories")).status, status);
    assert.equal(app.calls.database, 0);
  }
  const app = setup();
  assert.equal((await app.handle(app.request(), "users")).status, 404);
  assert.equal(app.calls.database, 0);
});

test("admin request boundary rejects CSRF, spoofed target, query credentials and wrong methods before SQL", async () => {
  for (const [headers, status] of [[{ origin: "https://attacker.invalid" }, 403], [{ host: "other.invalid" }, 403],
    [{ "sec-fetch-site": "cross-site" }, 403], [{ "x-blizhniy-request": "" }, 403], [{ "content-type": "text/plain" }, 415]]) {
    const app = setup();
    assert.equal((await app.handle(app.request({}, headers), "categories")).status, status);
    assert.equal(app.calls.database, 0);
  }
  const app = setup();
  assert.equal((await app.handle(app.request({}, {}, "GET"), "tariffs")).status, 405);
  assert.equal((await app.handle(app.request(), "category-order")).status, 405);
  assert.equal((await app.handle(app.request({}, {}, "POST", `?token=${token}`), "categories")).status, 400);
  assert.equal(app.calls.database, 0);
});

test("only one valid cookie authenticates admin requests; Bearer/body role never substitutes", async () => {
  for (const headers of [{ cookie: "" }, { cookie: "invalid" }, { cookie: `${cookie}; ${cookie}` },
    { cookie: "", authorization: `Bearer ${token}` }, { cookie: `__Host-blizhniy_session="${token}"` }]) {
    const app = setup();
    assert.equal((await app.handle(app.request({}, headers), "categories")).status, 401);
    assert.equal(app.calls.database, 0);
  }
  const app = setup();
  assert.equal((await app.handle(app.request({ token, role: "admin" }), "categories")).status, 422);
  assert.equal(app.calls.database, 0);
});

test("bounded bodies reject malformed/oversize input without opening a pool", async () => {
  const app = setup();
  assert.equal((await app.handle(app.request({ padding: "x".repeat(4096) }), "categories")).status, 413);
  const malformed = app.request();
  const bad = new Request(malformed.url, { method: "POST", headers: malformed.headers, body: "{" });
  assert.equal((await app.handle(bad, "categories")).status, 400);
  assert.equal(app.calls.database, 0);
});

test("admin listing and patches preserve contracts and share one runtime without retry", async () => {
  const app = setup();
  assert.deepEqual(await (await app.handle(app.request(), "categories")).json(), { categories: app.categories });
  assert.deepEqual(await (await app.handle(app.request(), "tariffs")).json(), { tariffs: app.tariffs });
  const edit = { id: app.categories[0].id, active: false };
  assert.deepEqual(await (await app.handle(app.request(edit, {}, "PATCH"), "categories")).json(), { category: app.categories[0] });
  assert.deepEqual(await (await app.handle(app.request({ id: "listing-publication", price: 0.29 }, {}, "PATCH"), "tariffs")).json(), { status: "saved" });
  assert.deepEqual(await (await app.handle(app.request({ ids: [edit.id] }, {}, "PATCH"), "category-order")).json(), { status: "saved" });
  assert.equal(app.calls.database, 1);
  assert.equal(app.calls.operations.length, 5);
  assert.ok(app.calls.operations.every(args => args[1] === token));
  assert.equal(app.calls.secrets[0], crypto.createHmac("sha256", env.BLIZHNIY_AUTH_RATE_SECRET).update("local-admin").digest("hex"));
});

test("admin order envelope and list bodies reject extra fields before SQL", async () => {
  const app = setup();
  for (const [resource, body, method] of [["categories", { id: "not-empty" }, "POST"], ["tariffs", { token }, "POST"],
    ["category-order", { ids: [], role: "admin" }, "PATCH"], ["category-order", {}, "PATCH"]]) {
    assert.equal((await app.handle(app.request(body, {}, method), resource)).status, 422);
  }
  assert.equal(app.calls.database, 0);
});

test("denied, missing and invalid edits have stable generic errors without leaked credentials", async () => {
  for (const [options, resource, status, code] of [[{ denied: true }, "categories", 403, "ADMIN_REQUIRED"],
    [{ missing: true }, "categories", 404, "NOT_FOUND"], [{ missing: true }, "tariffs", 404, "NOT_FOUND"],
    [{ failure: new CategoryEditInputError() }, "categories", 422, "INVALID_INPUT"],
    [{ failure: new TariffEditInputError() }, "tariffs", 422, "INVALID_INPUT"],
    [{ failure: new Error("secret database detail") }, "tariffs", 503, "ADMIN_UNAVAILABLE"]]) {
    const app = setup({}, options);
    const response = await app.handle(app.request({ id: "some-id", active: false }, {}, "PATCH"), resource);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
    assert.equal(response.headers.get("set-cookie"), null);
    const event = JSON.parse(app.calls.logs.at(-1));
    assert.equal(event.code, code);
    assert.equal(event.status, status);
    assert.equal(event.entryPoint, "http");
    assert.equal(event.requestId, response.headers.get("x-request-id"));
    assert.ok(app.calls.logs.every(line => !line.includes(token) && !line.includes("some-id") && !line.includes("secret database detail")));
    assert.equal(app.calls.operations.length, 1);
  }
});

test("shared admin limiter denies before authority work and fails closed on SQL outage", async () => {
  for (const options of [{ limited: true }, { limitFailure: true }]) {
    const app = setup({}, options);
    const response = await app.handle(app.request(), "tariffs");
    assert.equal(response.status, options.limited ? 429 : 503);
    assert.equal(response.headers.get("retry-after"), options.limited ? "900" : null);
    assert.equal(app.calls.operations.length, 0);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});
