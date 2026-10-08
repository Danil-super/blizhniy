import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../", import.meta.url));
const instant = Date.parse("2026-10-08T12:00:00Z");
const owner = "6633e3d3-889e-4c12-9309-b16ab1234567";
const other = "95083575-0d6a-4e89-a496-616b7e009d9a";
const target = "d0d82ac4-d8ba-43a8-b481-b05d4fa38eaf";
const names = {
  listing: { table: "listings", capital: "Listing", plural: "Listings" },
  vacancy: { table: "vacancies", capital: "Vacancy", plural: "Vacancies" },
};

// Complete on-disk modules, including real Auth/REST and DTO helpers. Only
// external fetch is replaced; no production configuration is read.
function harness(type, options = {}) {
  let now = instant;
  const row = { id: target, author_id: owner, listing_type: "sell", title: "Synthetic publication",
    organization_name: "Synthetic employer", description: "Fixture only", status: "archived", is_paid: true,
    created_at: "2026-01-01T12:00:00Z", published_at: null, expires_at: "2026-10-09T12:00:00.123456Z",
    show_exact_address: false, address: "Synthetic private address", latitude: 45.1, longitude: 38.9,
    contact_phone: "+79995550123", email: "synthetic@example.invalid", messenger_url: "@synthetic", ...options.row };
  const calls = [], modules = new Map();
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({ console, Error, Date: FixtureDate, URL, URLSearchParams, Request, Response, Headers,
    AbortController, setTimeout, clearTimeout, Buffer, crypto: globalThis.crypto,
    process: { env: { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://offline.invalid",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" } }, fetch: externalFetch });
  function matches(params) {
    return [...params].every(([column, filter]) => {
      if (["select", "order", "limit", "offset"].includes(column)) return true;
      if (filter.startsWith("eq.")) return String(row[column]) === filter.slice(3);
      if (filter.startsWith("neq.")) return String(row[column]) !== filter.slice(4);
      if (filter.startsWith("in.(")) return filter.slice(4, -1).split(",").includes(String(row[column]));
      if (filter.startsWith("gt.")) return row[column] != null && Date.parse(row[column]) > Date.parse(filter.slice(3));
      throw new Error(`Unsupported fixture predicate ${column}=${filter}`);
    });
  }
  function response(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  }
  async function externalFetch(input, init = {}) {
    const url = new URL(String(input)), body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, params: url.searchParams, init, body });
    if (url.pathname === "/auth/v1/user") return options.anonymous
      ? response({ message: "Synthetic unauthenticated" }, 401)
      : response({ id: options.actor ?? owner, email: "synthetic@example.invalid" });
    if (url.pathname === "/rest/v1/profiles") return response([{ is_blocked: false }]);
    if (url.pathname === "/rest/v1/payments") return response([]);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      assert.equal(url.pathname, `/rest/v1/rpc/restore_${type}_within_paid_window`);
      if (options.rpcError) return response({ message: "Synthetic restore unavailable" }, 503);
      now += options.waitMs ?? 0;
      if (options.returnedId) return response([{ id: options.returnedId }]);
      const allowed = type === "listing" ? ["sold", "archived", "expired"] : ["archived"];
      if (body.p_owner_id !== row.author_id || body[`p_${type}_id`] !== row.id || !row.is_paid
        || row.expires_at == null || Date.parse(row.expires_at) <= now || !allowed.includes(row.status)) return response([]);
      Object.assign(row, { status: "published", published_at: new FixtureDate().toISOString() });
      return response([{ id: row.id }]);
    }
    assert.equal(url.pathname, `/rest/v1/${names[type].table}`);
    if (init.method === "PATCH") now += options.waitMs ?? 0;
    if (!matches(url.searchParams)) return response([]);
    if (init.method === "PATCH") Object.assign(row, body);
    return response([{ ...row }]);
  }
  function load(filename) {
    const absolute = resolve(root, filename);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const javascript = ts.transpileModule(readFileSync(absolute, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }, fileName: absolute }).outputText;
    vm.runInContext(`(function(require,module,exports){${javascript}\n})`, context, { filename: absolute })((name) => {
      if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
      const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(absolute), name);
      const dependency = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]
        .find((candidate) => existsSync(candidate) && /\.(ts|tsx)$/.test(candidate));
      assert.ok(dependency, `Missing actual source dependency ${name}`);
      return load(dependency);
    }, module, module.exports);
    return module.exports;
  }
  const store = load(`src/lib/${type}-store.ts`);
  return { row, calls, load, store, now: () => now,
    restore: (actor = owner) => store[`restoreStored${names[type].capital}ForUser`](target, actor) };
}

for (const type of ["listing", "vacancy"]) {
  test(`${type}: stable owner restores a live paid archive without extending its original deadline`, async () => {
    const runtime = harness(type), before = { ...runtime.row };
    assert.equal(await runtime.restore(), true);
    assert.equal(runtime.row.status, "published");
    assert.equal(runtime.row.expires_at, before.expires_at);
    assert.equal(runtime.row.published_at, new Date(instant).toISOString());
    assert.equal(runtime.row.author_id, before.author_id);
    assert.equal(runtime.row.is_paid, before.is_paid);
  });
  test(`${type}: stable owner cannot restore when the paid deadline passes during the request`, async () => {
    const runtime = harness(type, { row: { expires_at: new Date(instant + 5000).toISOString() }, waitMs: 10_000 });
    const before = { ...runtime.row };
    assert.equal(await runtime.restore(), false);
    assert.deepEqual(runtime.row, before);
  });
  test(`${type}: foreign owner, unpaid archive and unknown or elapsed expiry remain unchanged`, async () => {
    for (const options of [{ actor: other }, { row: { is_paid: false } }, { row: { expires_at: null } },
      { row: { expires_at: new Date(instant).toISOString() } }, { row: { expires_at: new Date(instant - 1).toISOString() } }]) {
      const runtime = harness(type, options), before = { ...runtime.row };
      assert.equal(await runtime.restore(options.actor ?? owner), false);
      assert.deepEqual(runtime.row, before);
    }
  });
  test(`${type}: restoration preserves its existing allowed-state policy`, async () => {
    for (const status of ["sold", "archived", "expired", "published", "rejected", "pending_payment", "draft"]) {
      const runtime = harness(type, { row: { status } });
      const expected = type === "listing" ? ["sold", "archived", "expired"].includes(status) : status === "archived";
      assert.equal(await runtime.restore(), expected, status);
    }
  });
  test(`${type}: restore RPC receives only the target and authenticated owner and rejects another returned target`, async () => {
    const runtime = harness(type);
    assert.equal(await runtime.restore(), true);
    const call = runtime.calls.find((item) => item.path.includes("/rpc/"));
    assert.ok(call);
    assert.deepEqual(call.body, { [`p_${type}_id`]: target, p_owner_id: owner });
    assert.equal(call.init.method, "POST");
    assert.equal(runtime.calls.some((item) => item.path === "/rest/v1/payments"), false);
    assert.equal(await harness(type, { returnedId: other }).restore(), false);
  });
  test(`${type}: anonymous and foreign-owner cabinet restore cannot mutate a publication`, async () => {
    for (const options of [{ anonymous: true }, { actor: other }]) {
      const runtime = harness(type, options), before = { ...runtime.row };
      const route = runtime.load(`src/app/api/cabinet/${names[type].table}/route.ts`);
      const result = await route.PATCH(new Request(`https://app.invalid/api/cabinet/${names[type].table}`, {
        method: "PATCH", headers: { Authorization: "Bearer synthetic-session", "Content-Type": "application/json" },
        body: JSON.stringify({ id: target, action: "restore", ownerId: owner }),
      }));
      assert.equal(result.status, options.anonymous ? 401 : type === "listing" ? 404 : 409);
      assert.deepEqual(runtime.row, before);
    }
  });
  test(`${type}: unavailable RPC cannot fall back to an application-clock table PATCH`, async () => {
    const runtime = harness(type, { rpcError: true }), before = { ...runtime.row };
    await assert.rejects(runtime.restore(), /Synthetic restore unavailable/);
    assert.deepEqual(runtime.row, before);
    assert.equal(runtime.calls.some((call) => call.init.method === "PATCH"), false);
  });
  test(`${type}: expired restored-state rows remain excluded publicly and effectively expired for their owner`, async () => {
    const runtime = harness(type, { row: { status: "published", expires_at: new Date(instant - 1).toISOString() } });
    assert.equal(await runtime.store[`getStored${names[type].capital}ById`](target, { publicOnly: true }), undefined);
    assert.equal((await runtime.store[`listStored${names[type].plural}`]()).length, 0);
    assert.equal((await runtime.store[`listStored${names[type].plural}ForUser`](owner))[0].status, "expired");
  });
}

test("listing cabinet DTO keeps a NULL deadline unknown rather than inventing the request time", async () => {
  const runtime = harness("listing", { row: { status: "pending_payment", is_paid: false, expires_at: null } });
  const route = runtime.load("src/app/api/cabinet/listings/route.ts");
  const result = await route.GET(new Request("https://app.invalid/api/cabinet/listings", {
    headers: { Authorization: "Bearer synthetic-session" },
  }));
  assert.equal(result.status, 200);
  const listing = (await result.json()).listings[0];
  assert.equal(listing.expiresAt, undefined);
  assert.equal(listing.status, "pending_payment");
});
test("listing DTO preserves its genuine stored expiry including timestamp precision", async () => {
  const runtime = harness("listing");
  const listing = await runtime.store.getStoredListingForUser(target, owner);
  assert.equal(listing.expiresAt, runtime.row.expires_at);
});
