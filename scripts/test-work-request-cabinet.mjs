import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/lib/work-request-store.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ownerId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
let requests = [];
let rpcOutcome = [];
let rpcCalls = [];
const timeModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL("../src/lib/publication-time.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: timeModule, exports: timeModule.exports, Date, Intl });

function row(id, authorId, status) {
  return {
    id, author_id: authorId, title: "Тестовый заказ", description: "Подробное описание заказа",
    region_id: ownerId, city_id: ownerId, city: "Краснодар", show_exact_address: false,
    status, is_paid: true, expires_at: "2099-10-01T12:00:00Z", created_at: "2026-09-26T10:00:00Z", published_at: "2026-09-26T12:00:00Z",
    cities: { name: "Краснодар", slug: "krasnodar" }, work_request_images: [],
  };
}

async function fakeRest(path, options = {}) {
  const url = new URL(path, "http://test.local");
  const qp = url.searchParams;
  if (url.pathname === "/rest/v1/rpc/restore_work_request_within_paid_window") {
    assert.equal(options.method, "POST");
    rpcCalls.push(JSON.parse(JSON.stringify(options.body)));
    // The fixture supplies an authoritative SQL outcome; it does not reimplement
    // payment eligibility. Real payer/provider/snapshot/refund/lock controls live
    // in tests/work-request-entitlements-postgres.mjs.
    if (rpcOutcome.length) requests[0].status = "published";
    return rpcOutcome;
  }
  if (url.pathname !== "/rest/v1/work_requests") throw new Error(`Unexpected REST path ${path}`);
  const rows = requests.filter((r) => (!qp.has("id") || r.id === qp.get("id")?.slice(3))
    && (!qp.has("author_id") || r.author_id === qp.get("author_id")?.slice(3))
    && (!qp.has("status") || r.status === qp.get("status")?.slice(3)));
  if (options.method === "PATCH") {
    for (const target of rows) Object.assign(target, options.body);
    return rows.map((target) => ({ ...target }));
  }
  return rows.slice(Number(qp.get("offset") ?? 0), Number(qp.get("offset") ?? 0) + Number(qp.get("limit") ?? 500));
}

const module = { exports: {} };
vm.runInNewContext(javascript, {
  module, exports: module.exports, console, Date, Intl, Number, URL, encodeURIComponent,
  require(name) {
    if (name === "@/lib/data") return { region: { slug: "krasnodar" }, workRequests: [] };
    if (name === "@/lib/map-location") return { hasMapCoordinates: () => false };
    if (name === "@/lib/publication-time") return timeModule.exports;
    if (name === "@/lib/storage-upload") return { publicMediaUrl: (path) => path };
    if (name === "@/lib/runtime-mode") return { shouldShowFallbackContent: () => false };
    if (name === "@/lib/supabase-rest") return { isSupabaseRestConfigured: () => true, isUuid: (id) => /^[0-9a-f-]{36}$/.test(id), supabaseRest: fakeRest };
    return require(name);
  },
});
const store = module.exports;

test("owner list includes drafts and archives but excludes another user's rows", async () => {
  requests = [row(requestId, ownerId, "published"), row("00000000-0000-4000-8000-000000000004", ownerId, "draft"), row("00000000-0000-4000-8000-000000000005", otherId, "archived")];
  assert.deepEqual(Array.from(await store.listStoredWorkRequestsForUser(ownerId), (r) => r.id), [requestId, "00000000-0000-4000-8000-000000000004"]);
});

test("archive is owner-scoped and idempotent", async () => {
  requests = [row(requestId, ownerId, "published")];
  assert.equal(await store.archiveStoredWorkRequestForUser(requestId, otherId), undefined);
  assert.equal(requests[0].status, "published");
  assert.equal((await store.archiveStoredWorkRequestForUser(requestId, ownerId)).status, "archived");
  assert.equal((await store.archiveStoredWorkRequestForUser(requestId, ownerId)).status, "archived");
});

test("restore adopts denied/applied SQL outcomes, keeps owner binding and never changes purchased dates", async () => {
  requests = [row(requestId, ownerId, "archived")];
  rpcCalls = []; rpcOutcome = [];
  const original = { ...requests[0] };
  // Every denial is a real-SQL-tested scenario, not a duplicated tariff policy.
  for (const reason of ["foreign payer", "wrong target", "mock provider", "unapplied", "expired", "window mismatch", "unknown duration"]) {
    assert.equal(await store.restoreStoredWorkRequestForUser(requestId, ownerId), undefined);
    assert.deepEqual(requests[0], original, reason);
    assert.deepEqual(rpcCalls.at(-1), { p_work_request_id: requestId, p_owner_id: ownerId });
  }
  assert.equal(await store.restoreStoredWorkRequestForUser(requestId, otherId), undefined);
  assert.deepEqual(rpcCalls.at(-1), { p_work_request_id: requestId, p_owner_id: otherId });
  rpcOutcome = [{ id: requestId }];
  assert.equal((await store.restoreStoredWorkRequestForUser(requestId, ownerId)).status, "published");
  assert.deepEqual(requests[0], { ...original, status: "published" });
  rpcOutcome = []; // SQL declines an already-published replay.
  assert.equal(await store.restoreStoredWorkRequestForUser(requestId, ownerId), undefined);
});
