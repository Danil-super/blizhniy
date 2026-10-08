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
const id = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const applicant = "33333333-3333-4333-8333-333333333333";
const instant = Date.parse("2026-10-07T12:00:00Z");
const row = (extra = {}) => ({ id, author_id: owner, organization_name: "Synthetic employer", employment_type: "full_time", experience: "any",
  title: "Synthetic paid work", description: "Synthetic publication without contact content",
  status: "published", is_paid: true, expires_at: "2026-10-08T12:00:00Z", published_at: "2026-10-01T12:00:00Z",
  created_at: "2026-10-01T12:00:00Z", contact_phone: "+79995550123", messenger_url: "https://t.me/private_fixture",
  show_exact_address: true, address: "Synthetic Address 18", latitude: 45.1, longitude: 38.9,
  cities: { name: "Краснодар", slug: "krasnodar" }, profiles: { display_name: "Synthetic owner" }, ...extra });

// Complete source modules; only external REST and request-auth boundaries are replaced.
function harness(rows, options = {}) {
  let now = instant;
  const requests = [];
  const modules = new Map();
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({ console, Error, Date: FixtureDate, URL, URLSearchParams, Request, Response, Headers,
    setTimeout, clearTimeout, process: { env: { NODE_ENV: options.demo ? "development" : "production", ENABLE_DEMO_CONTENT: String(Boolean(options.demo)),
      NEXT_PUBLIC_SUPABASE_URL: "https://offline.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key" } },
    fetch() { throw new Error("External network forbidden"); } });
  async function rest(path, init = {}) {
    requests.push({ path, init });
    const url = new URL(path, "https://offline.invalid");
    if (options.rest) {
      const value = await options.rest(path, init, { rows, requests, setNow: (value) => { now = value; } });
      if (value !== undefined) return value;
    }
    if (path.startsWith("/rest/v1/rpc/")) return options.restored ? [{ id }] : [];
    if (url.pathname === "/rest/v1/payments") return [{ paid_at: "2026-10-01T12:00:00Z", tariffs: { action: "work_request_publication", duration_days: 365 } }];
    if (init.method === "PATCH") {
      for (const item of rows) if (url.searchParams.get("id") === `eq.${item.id}`) Object.assign(item, init.body);
      return [{ id }];
    }
    const selected = rows.filter((item) => ["id", "author_id", "status", "is_paid", "expires_at"].every((key) => {
      const filter = url.searchParams.get(key);
      if (!filter) return true;
      if (filter.startsWith("eq.")) return String(item[key]) === filter.slice(3);
      if (filter.startsWith("gt.")) return item[key] != null && Date.parse(item[key]) > Date.parse(filter.slice(3));
      throw new Error(`Unhandled fixture filter ${filter}`);
    }));
    const select = url.searchParams.get("select");
    return selected.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => select?.split(",").includes(key))));
  }
  function load(filename) {
    const filenameAbsolute = resolve(root, filename);
    if (modules.has(filenameAbsolute)) return modules.get(filenameAbsolute).exports;
    const module = { exports: {} };
    modules.set(filenameAbsolute, module);
    const javascript = ts.transpileModule(readFileSync(filenameAbsolute, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    }, fileName: filenameAbsolute }).outputText;
    vm.runInContext(`(function(require,module,exports){${javascript}\n})`, context, { filename: filenameAbsolute })((name) => {
      if (name === "@/lib/server-auth") return { isSupabaseServerConfigured: () => true, getAuthenticatedRequestUser: async () => ({ user: { id: owner } }) };
      if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
      const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(filenameAbsolute), name);
      const dependency = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find((candidate) => existsSync(candidate) && /\.(ts|tsx)$/.test(candidate));
      assert.ok(dependency, `Missing actual source dependency ${name}`);
      return load(dependency);
    }, module, module.exports);
    if (filenameAbsolute === resolve(root, "src/lib/supabase-rest.ts")) module.exports.supabaseRest = rest;
    return module.exports;
  }
  return { load, rows, requests, setNow(value) { now = value; }, store() { return load("src/lib/work-request-store.ts"); } };
}

for (const [label, change] of [["expired", { expires_at: "2026-10-07T11:59:59Z" }], ["boundary", { expires_at: "2026-10-07T12:00:00Z" }],
  ["unknown legacy", { is_paid: false, expires_at: null }], ["unpaid", { is_paid: false }], ["missing deadline", { expires_at: null }]]) {
  test(`public list and detail exclude ${label} persisted work request`, async () => {
    const runtime = harness([row(change)]);
    const store = runtime.store();
    assert.equal((await store.listStoredWorkRequests()).length, 0);
    assert.equal(await store.getStoredWorkRequestById(id, { publicOnly: true }), undefined);
  });
}

test("active paid public work request retains opted location, never contacts", async () => {
  const store = harness([row()]).store();
  const detail = await store.getStoredWorkRequestById(id, { publicOnly: true });
  assert.equal(detail?.title, row().title);
  assert.equal(detail?.address, row().address);
  assert.equal(detail?.phone, undefined);
  assert.equal(detail?.messengerUrl, undefined);
  assert.equal((await store.listStoredWorkRequests()).length, 1);
});

test("image relation fallback preserves paid/expiry public eligibility", async () => {
  const runtime = harness([row({ expires_at: null })], { rest(path) {
    if (path.includes("work_request_images(")) throw new Error("work_request_images relationship missing");
  } });
  assert.equal((await runtime.store().listStoredWorkRequests()).length, 0);
  assert.equal(runtime.requests.length, 2);
  for (const { path } of runtime.requests) {
    assert.equal(new URL(path, "https://offline.invalid").searchParams.get("is_paid"), "eq.true");
    assert.ok(new URL(path, "https://offline.invalid").searchParams.get("expires_at")?.startsWith("gt."));
  }
});

test("deadline crossing during REST response cannot leak an expired public row", async () => {
  const runtime = harness([row()], { rest(path, init, fixture) {
    if (path.includes("work_requests?")) {
      fixture.setNow(Date.parse(row().expires_at));
      return [row()]; // The DB selected this before its deadline, then the response stalled.
    }
  } });
  assert.equal(await runtime.store().getStoredWorkRequestById(id, { publicOnly: true }), undefined);
  assert.equal((await runtime.store().listStoredWorkRequests()).length, 0);
});

test("owner/admin reads retain private data, mark only known deadlines expired", async () => {
  for (const [expires_at, expected] of [["2026-10-07T11:59:59Z", "expired"], [null, "published"]]) {
    const runtime = harness([row({ expires_at })]);
    const store = runtime.store();
    for (const item of [await store.getStoredWorkRequestById(id), ...(await store.listStoredWorkRequestsForUser(owner)), ...(await store.listStoredWorkRequestsForAdmin())]) {
      assert.equal(item.status, expected);
      assert.equal(item.phone, row().contact_phone);
      assert.equal(item.messengerUrl, row().messenger_url);
    }
    assert.equal(runtime.rows[0].status, "published", "readers never persist status or a guessed window");
  }
});

for (const [label, change] of [["expired", { expires_at: "2026-10-07T11:59:59Z" }], ["unknown", { expires_at: null }], ["unpaid", { is_paid: false }]]) {
  test(`work-request application eligibility rejects ${label} parent before any write`, async () => {
    const runtime = harness([row(change)]);
    await assert.rejects(runtime.load("src/lib/application-store.ts").ensureWorkRequestCanReceiveApplication(id, applicant));
    assert.equal(runtime.requests.some(({ init }) => init.method), false);
  });
}

for (const kind of ["WorkRequest", "Vacancy"]) {
  test(`${kind} eligibility rejects parent disappearing between public and owner reads`, async () => {
    const runtime = harness([row()], { rest(path) { if (path.includes("select=author_id&")) return []; } });
    await assert.rejects(runtime.load("src/lib/application-store.ts")[`ensure${kind}CanReceiveApplication`](id, applicant));
  });
  test(`${kind} stable paid parent permits distinct applicant but not self-response`, async () => {
    const runtime = harness([row()]);
    const ensure = runtime.load("src/lib/application-store.ts")[`ensure${kind}CanReceiveApplication`];
    assert.equal((await ensure(id, applicant)).id, id);
    await assert.rejects(ensure(id, owner), /собственн/);
  });
}

test("restore uses owner-bound RPC, not current-tariff reads or a status-only PATCH", async () => {
  const runtime = harness([row({ status: "archived" })]);
  assert.equal(await runtime.store().restoreStoredWorkRequestForUser(id, owner), undefined);
  assert.equal(runtime.rows[0].status, "archived");
  const rpc = runtime.requests.find(({ path }) => path === "/rest/v1/rpc/restore_work_request_within_paid_window");
  assert.ok(rpc);
  assert.deepEqual(JSON.parse(JSON.stringify(rpc.init.body)), { p_work_request_id: id, p_owner_id: owner });
  assert.equal(runtime.requests.some(({ path }) => path.startsWith("/rest/v1/payments?")), false);
});

test("cabinet restore rejection remains 409 with no optimistic successful publication", async () => {
  const runtime = harness([row({ status: "archived", expires_at: null })]);
  const response = await runtime.load("src/app/api/cabinet/work-requests/route.ts").PATCH(new Request("https://offline.invalid/api/cabinet/work-requests", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: "restore" }),
  }));
  assert.equal(response.status, 409);
  assert.equal(runtime.rows[0].status, "archived");
});

test("expired public page is not found and metadata omits the private publication", async () => {
  const runtime = harness([row({ expires_at: "2026-10-07T11:59:59Z" })]);
  const page = runtime.load("src/app/rabota/zakazy/[slug]/page.tsx");
  const props = { params: Promise.resolve({ slug: id }) };
  await assert.rejects(page.default(props), /NEXT_HTTP_ERROR_FALLBACK;404/);
  assert.equal((await page.generateMetadata(props)).title, "Заказ");
});

test("stable cabinet restore adopts RPC success without renewing publication dates", async () => {
  const raw = row({ status: "archived" }); const before = { ...raw };
  const runtime = harness([raw], { rest(path) { if (path.endsWith("/rpc/restore_work_request_within_paid_window")) { raw.status = "published"; return [{ id }]; } } });
  const response = await runtime.load("src/app/api/cabinet/work-requests/route.ts").PATCH(new Request("https://offline.invalid/api/cabinet/work-requests", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: "restore", p_owner_id: applicant }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(raw, { ...before, status: "published" });
  assert.equal((await response.json()).workRequest.publishedAt, before.published_at);
  assert.equal(runtime.requests.find(({ path }) => path.includes("/rpc/"))?.init.body.p_owner_id, owner);
});

test("a foreign/malformed RPC result cannot be adopted as this publication's restored outcome", async () => {
  const runtime = harness([row()], { rest(path) { if (path.includes("/rpc/")) return [{ id: applicant }]; } });
  assert.equal(await runtime.store().restoreStoredWorkRequestForUser(id, owner), undefined);
});

test("explicit nonproduction demo remains available without inventing stored entitlement", async () => {
  const runtime = harness([row({ expires_at: null, is_paid: false })], { demo: true });
  const store = runtime.store();
  assert.equal((await store.listStoredWorkRequests()).length, 0);
  assert.ok(store.listWorkRequestsWithStored([]).length > 0);
  assert.equal(runtime.rows[0].expires_at, null); assert.equal(runtime.rows[0].is_paid, false);
});
