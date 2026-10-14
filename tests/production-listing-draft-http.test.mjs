import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductionListingDraftHandler, loadDraftRoute } from "./listing-draft-http-module.mjs";
import { ListingDraftAccessError, ListingDraftConflictError } from "./listing-draft-module.mjs";
import { ListingDraftInputError } from "../src/lib/listing-draft-contract.ts";
import { loadAdminModule } from "./admin-module.mjs";
const { AppSessionAccessError } = loadAdminModule("app-session-transaction");
const origin = "https://app.example.invalid", owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222", token = "a".repeat(64);
const readBody = { expectedOwnerId: owner, listingId: id };
const writeBody = { ...readBody, expectedRevision: "9007199254740993", draft: { kind: "prodam", title: "Synthetic private title", price: "12.1" } };
function fixture(options = {}) {
  const calls = { factories: 0, reads: [], updates: [], events: [], limits: [] };
  const result = { id, revision: "9007199254740994", draft: { kind: "prodam", title: "Synthetic private title", description: "", categoryId: null, cityId: null, price: "12.10" } };
  const perform = async (name, args) => { calls[name].push(args); if (options.error) throw options.error; return result; };
  const handle = createProductionListingDraftHandler({ origin }, () => {
    calls.factories++; if (options.outage) throw new Error("Synthetic private SQL cause");
    return { store: { read: (...args) => perform("reads", args), update: (...args) => perform("updates", args) },
      limiter: { allowProduction: async (...args) => { calls.limits.push(args); if (options.rateOutage) throw new Error("Private limiter failure"); return !options.limited; } } };
  }, event => calls.events.push(event));
  const request = (body = readBody, headers = {}, method = "POST", query = "") => new Request(origin+"/api/account/listing-drafts"+query, {
    method, headers: { host: new URL(origin).host, origin, "x-blizhniy-request": "1", "x-real-ip": "192.0.2.1",
      "content-type": "application/json", cookie: `__Host-blizhniy_session=${token}`, ...headers },
    ...(["GET", "HEAD"].includes(method) ? {} : { body: JSON.stringify(body) }),
  });
  return { handle, request, calls, result };
}
test("draft HTTP rejects CSRF, wrong targets, untrusted ingress and non-cookie authority before runtime", async () => {
  for (const [headers, method, query, status] of [
    [{}, "GET", "", 405], [{}, "PATCH", "", 405], [{}, "DELETE", "", 405],
    [{ origin: "https://attacker.invalid" }, "POST", "", 403], [{ host: "attacker.invalid" }, "POST", "", 403],
    [{ "x-blizhniy-request": "" }, "POST", "", 403], [{ "sec-fetch-site": "cross-site" }, "POST", "", 403],
    [{ "x-real-ip": "", "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.1" }, "POST", "", 403],
    [{ cookie: "", authorization: `Bearer ${token}` }, "POST", "", 401],
    [{ cookie: `__Host-blizhniy_session=${token}; __Host-blizhniy_session=${token}` }, "POST", "", 401],
    [{ cookie: "__Host-blizhniy_session=malformed" }, "POST", "", 401], [{}, "POST", "?listingId="+id, 400],
  ]) {
    const f = fixture(), response = await f.handle(f.request(readBody, headers, method, query));
    assert.equal(response.status, status);assert.equal(f.calls.factories, 0);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
  }
});
test("draft HTTP rejects malformed envelopes, resource claims and inexact revisions before runtime", async () => {
  for (const [body, method] of [
    [null, "POST"], [[], "POST"], [{ ...readBody, ownerId: owner }, "POST"], [{ expectedOwnerId: owner }, "POST"],
    [{ ...readBody, expectedOwnerId: "bad" }, "POST"], [{ ...readBody, listingId: "bad" }, "POST"],
    [{ ...writeBody, draft: { kind: "prodam", is_paid: true } }, "PUT"],
    [{ ...writeBody, draft: { kind: "prodam", author_id: owner } }, "PUT"],
    [{ ...writeBody, draft: { kind: "prodam", contact_phone: "synthetic" } }, "PUT"],
    ...[undefined, null, 1, "0", "01", "9223372036854775808"].map(revision => [{ ...writeBody, expectedRevision: revision }, "PUT"]),
  ]) {
    const f = fixture(), response = await f.handle(f.request(body, {}, method));
    assert.equal(response.status, 422);assert.equal(f.calls.factories, 0);
  }
});
test("draft HTTP bounds both advertised and streamed bytes and rejects invalid JSON/content types", async () => {
  for (const [body, headers, status] of [
    [readBody, { "content-type": "text/plain" }, 415], [readBody, { "content-length": "4097" }, 413],
    [{ ...readBody, extra: "x".repeat(5000) }, {}, 413],
  ]) {
    const f = fixture(), response = await f.handle(f.request(body, headers));
    assert.equal(response.status, status);assert.equal(f.calls.factories, 0);
  }
  const f = fixture(), template = f.request();
  for (const bytes of ["{", new Uint8Array([0xff])]) {
    const response = await f.handle(new Request(template.url, { method: "POST", headers: template.headers, body: bytes }));
    assert.equal(response.status, 400);
  }
  const large = await f.handle(f.request({ ...writeBody, draft: { kind: "prodam", description: "x".repeat(66000) } }, {}, "PUT"));
  assert.equal(large.status, 413);assert.equal(f.calls.factories, 0);
});
test("draft read/update propagate only cookie authority and validated core with exact string revision", async () => {
  const f = fixture();
  assert.deepEqual(await (await f.handle(f.request())).json(), f.result);
  const response = await f.handle(f.request(writeBody, {}, "PUT"));
  assert.equal(response.status, 200);assert.deepEqual(await response.json(), f.result);
  assert.deepEqual(f.calls.reads, [[token, owner, id]]);
  assert.deepEqual(f.calls.updates, [[token, owner, id, "9007199254740993", f.result.draft]]);
  assert.deepEqual(f.calls.limits, [["session", "192.0.2.1"], ["session", "192.0.2.1"]]);
  const audit = JSON.stringify(f.calls.events);
  for (const privateValue of [owner, token, id, "9007199254740993", "Synthetic private title"]) assert.equal(audit.includes(privateValue), false);
  assert.deepEqual(f.calls.events.map(e => [e.operation, e.status]), [["read", 200], ["update", 200]]);
});
test("draft errors are typed, generic, no-store and never expose SQL causes or resource existence", async () => {
  for (const [error, status, code] of [[new AppSessionAccessError(), 401, "UNAUTHENTICATED"],
    [new ListingDraftAccessError(), 404, "DRAFT_NOT_FOUND"], [new ListingDraftConflictError(), 409, "DRAFT_CHANGED"],
    [new ListingDraftInputError(), 422, "INVALID_INPUT"], [new Error("Synthetic private SQL cause"), 503, "DRAFT_UNAVAILABLE"]]) {
    const f = fixture({ error }), response = await f.handle(f.request(writeBody, {}, "PUT"));
    assert.equal(response.status, status);assert.deepEqual(await response.json(), { error: { code } });
    assert.equal(response.headers.get("cache-control"), "no-store");assert.equal(f.calls.updates.length, 1);
    assert.equal(JSON.stringify(f.calls.events).includes("private"), false);
  }
});
test("shared rate denial and dependency outages fail closed without retry or touching the draft", async () => {
  for (const options of [{ limited: true }, { outage: true }, { rateOutage: true }]) {
    const f = fixture(options), response = await f.handle(f.request(writeBody, {}, "PUT"));
    assert.equal(response.status, options.limited ? 429 : 503);
    assert.deepEqual(await response.json(), { error: { code: options.limited ? "RATE_LIMITED" : "DRAFT_UNAVAILABLE" } });
    if (options.limited) assert.equal(response.headers.get("retry-after"), "900");
    assert.equal(f.calls.updates.length, 0);assert.equal(f.calls.reads.length, 0);assert.equal(f.calls.factories, 1);
  }
});
test("the actual Next route stays closed outside PostgreSQL mode and GET cannot create a draft", async () => {
  let delegated = 0;
  const route = loadDraftRoute(async request => { delegated++;return Response.json({ method: request.method }); });
  const previous = process.env.BLIZHNIY_AUTH_MODE;
  try {
    for (const mode of [undefined, "legacy", "local", "unknown"]) {
      if (mode === undefined) delete process.env.BLIZHNIY_AUTH_MODE; else process.env.BLIZHNIY_AUTH_MODE = mode;
      for (const method of ["POST", "PUT"]) {
        const response = await route[method](fixture().request(readBody, {}, method));
        assert.equal(response.status, 404);assert.deepEqual(await response.json(), { error: { code: "NOT_FOUND" } });
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
    }
    assert.equal(delegated, 0);
    process.env.BLIZHNIY_AUTH_MODE = "postgres";
    for (const method of ["POST", "PUT"]) assert.deepEqual(await (await route[method](fixture().request(readBody, {}, method))).json(), { method });
    assert.equal(delegated, 2);
    const get = route.GET();assert.equal(get.status, 405);assert.equal(get.headers.get("allow"), "POST, PUT");
    assert.equal(delegated, 2);
  } finally {
    if (previous === undefined) delete process.env.BLIZHNIY_AUTH_MODE; else process.env.BLIZHNIY_AUTH_MODE = previous;
  }
});
test("largest valid escaped core fits the bounded PUT without truncation or coercion", async () => {
  const f = fixture(), description = "\t".repeat(10000), title = "я".repeat(160);
  const response = await f.handle(f.request({ ...writeBody, draft: { kind: "arenda", title, description, price: "9999999999.99" } }, {}, "PUT"));
  assert.equal(response.status, 200);assert.equal(f.calls.updates[0][4].description, description);
  assert.equal(f.calls.updates[0][4].title, title);assert.equal(f.calls.updates[0][4].price, "9999999999.99");
});
