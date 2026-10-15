import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductionListingDraftHandler, loadDraftRoute } from "./listing-draft-http-module.mjs";
const owner = "11111111-1111-4111-8111-111111111111", key = "22222222-2222-4222-8222-222222222222";
const origin = "https://app.example.invalid", token = "a".repeat(64);
function fixture() {
  const calls = [], events = [];
  const page = { items: [], nextCursor: null }, snapshot = { id: key, revision: "1", draft: { kind: "prodam", title: "", description: "", categoryId: null, cityId: null, price: null } };
  const handle = createProductionListingDraftHandler({ origin, collection: true }, () => ({
    store: { list: async (...args) => { calls.push(["list", ...args]); return page; }, createEmpty: async (...args) => { calls.push(["create", ...args]); return snapshot; } },
    limiter: { allowProduction: async (...args) => { calls.push(["limit", ...args]); return true; } },
  }), event => events.push(event));
  const request = (body, method = "POST", headers = {}, query = "") => new Request(origin+"/api/account/listing-drafts/collection"+query, {
    method, headers: { host: new URL(origin).host, origin, "x-blizhniy-request": "1", "x-real-ip": "192.0.2.3",
      "content-type": "application/json", cookie: `__Host-blizhniy_session=${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { handle, request, calls, events, page, snapshot };
}
test("private collection exposes only validated list or stable blank creation with cookie authority", async () => {
  const f = fixture(), cursor = { id: key, updatedAt: "2026-10-15T12:13:14.123456Z" };
  const listed = await f.handle(f.request({ expectedOwnerId: owner, cursor }));
  assert.equal(listed.status, 200);assert.deepEqual(await listed.json(), f.page);
  const created = await f.handle(f.request({ expectedOwnerId: owner, creationKey: key }, "PUT"));
  assert.equal(created.status, 200);assert.deepEqual(await created.json(), f.snapshot);
  assert.deepEqual(f.calls, [["limit", "session", "192.0.2.3"], ["list", token, owner, cursor],
    ["limit", "session", "192.0.2.3"], ["create", token, owner, key]]);
  assert.deepEqual(f.events.map(event => event.operation), ["list", "create"]);
  for (const response of [listed, created]) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
  for (const value of [token, owner, key, cursor.updatedAt]) assert.equal(JSON.stringify(f.events).includes(value), false);
});
test("collection Next route stays closed outside PostgreSQL and delegates only the server-selected collection operation", async () => {
  const before = process.env.BLIZHNIY_AUTH_MODE;const calls = [];
  try {
    const route = loadDraftRoute(async (request, collection) => { calls.push(collection);return new Response(JSON.stringify({ method: request.method })); }, true);
    for (const mode of [undefined, "local", "unknown"]) {
      if (mode === undefined) delete process.env.BLIZHNIY_AUTH_MODE;else process.env.BLIZHNIY_AUTH_MODE = mode;
      for (const method of ["POST", "PUT"]) assert.equal((await route[method](new Request(origin, { method }))).status, 404);
    }
    assert.deepEqual(calls, []);
    process.env.BLIZHNIY_AUTH_MODE = "postgres";
    for (const method of ["POST", "PUT"]) assert.deepEqual(await (await route[method](new Request(origin, { method }))).json(), { method });
    assert.deepEqual(calls, [true, true]);assert.equal(route.GET().status, 405);
    assert.equal(route.GET().headers.get("allow"), "POST, PUT");
  } finally { if (before === undefined) delete process.env.BLIZHNIY_AUTH_MODE;else process.env.BLIZHNIY_AUTH_MODE = before; }
});
test("collection refuses extra draft/billing/identity fields and malformed cursor before database calls", async () => {
  for (const [method, body] of [["PUT", { expectedOwnerId: owner, creationKey: key, draft: { title: "must use revision CAS" } }],
    ["PUT", { expectedOwnerId: owner, creationKey: "bad" }], ["PUT", { expectedOwnerId: owner, creationKey: key, paid: true }],
    ["POST", { expectedOwnerId: owner }], ["POST", { expectedOwnerId: owner, cursor: {} }], ["POST", { expectedOwnerId: owner, cursor: null, limit: 10000 }]]) {
    const f = fixture(), response = await f.handle(f.request(body, method));
    assert.equal(response.status, 422);assert.deepEqual(f.calls, []);
  }
});
test("collection keeps CSRF, ingress, body size and cookie guards for both operations", async () => {
  for (const method of ["POST", "PUT"]) {
    const body = method === "POST" ? { expectedOwnerId: owner, cursor: null } : { expectedOwnerId: owner, creationKey: key };
    for (const [headers, query, status] of [[{ origin: "https://attacker.invalid" }, "", 403],
      [{ "x-real-ip": "" }, "", 403], [{ cookie: "", authorization: `Bearer ${token}` }, "", 401],
      [{ "content-length": "4097" }, "", 413], [{}, "?cursor=forbidden", 400]]) {
      const f = fixture(), response = await f.handle(f.request(body, method, headers, query));
      assert.equal(response.status, status);assert.deepEqual(f.calls, []);
    }
  }
});
