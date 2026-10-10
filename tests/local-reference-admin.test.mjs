import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalAdminError, localReferenceAdmin, parseAdminPrice, parseAdminDuration } from "../src/lib/local-reference-admin.ts";

const category = { id: "11111111-1111-4111-8111-111111111111", parent_id: null, slug: "tools", name: "Tools", sort_order: 10, active: false };
const tariff = { id: "listing-publication", action: "listing_publication", name: "Publication", price: 0.29, durationDays: null, active: true };
test("price parser keeps kopeks, zero and comma without rounding or coercing empty/exponent input", () => {
  for (const [text, value] of [["0", 0], ["0.29", 0.29], [" 199,90 ", 199.9], ["9999999999.99", 9999999999.99]]) assert.equal(parseAdminPrice(text), value);
  for (const text of ["", " ", "0.001", "1e3", "Infinity", "-1", "10000000000", "1,2.3", "0x10"]) assert.throws(() => parseAdminPrice(text), { code: "INVALID_INPUT" });
});
test("duration parser distinguishes explicit unlimited from valid whole days", () => {
  assert.equal(parseAdminDuration(""), null);
  assert.equal(parseAdminDuration(" 30 "), 30);
  assert.equal(parseAdminDuration("3650"), 3650);
  for (const text of ["0", "3651", "1.5", "1e2", "-1"]) assert.throws(() => parseAdminDuration(text), { code: "INVALID_INPUT" });
});
test("browser adapter reads only local resources with cookie-owned credentials and bounded method contract", async () => {
  const old = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push([url, options]); return Response.json(url.endsWith("categories") ? { categories: [category] } : { tariffs: [tariff] }); };
  try {
    assert.deepEqual(await localReferenceAdmin.categories(), [category]);
    assert.deepEqual(await localReferenceAdmin.tariffs(), [tariff]);
    for (const [url, options] of calls) {
      assert.match(url, /^\/api\/admin\/local\/(categories|tariffs)$/);
      assert.equal(options.method, "POST"); assert.equal(options.body, "{}");
      assert.equal(options.credentials, "same-origin"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
      assert.equal(options.headers["X-Blizhniy-Request"], "1"); assert.equal(options.headers.Authorization, undefined);
      assert.ok(options.signal instanceof AbortSignal);
    }
  } finally { globalThis.fetch = old; }
});
test("patch success is verified without retrying or replacing tariff IDs/actions", async () => {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => { calls.push([url, options]); return Response.json(url.endsWith("categories") ? { category } : { status: "saved" }); };
  try {
    assert.deepEqual(await localReferenceAdmin.updateCategory({ id: category.id, active: false }), category);
    await localReferenceAdmin.updateTariff({ id: tariff.id, price: 0.29, durationDays: null });
    await localReferenceAdmin.reorder([category.id]);
    assert.equal(calls.length, 3); assert.ok(calls.every(([, options]) => options.method === "PATCH"));
    assert.deepEqual(JSON.parse(calls[1][1].body), { id: tariff.id, price: 0.29, durationDays: null });
    assert.deepEqual(JSON.parse(calls[2][1].body), { ids: [category.id] });
  } finally { globalThis.fetch = old; }
});
test("known errors must match status; untrusted messages and unknown/network failures are generic", async () => {
  const old = globalThis.fetch;
  try {
    for (const [status, code] of [[401, "UNAUTHENTICATED"], [403, "ADMIN_REQUIRED"], [422, "INVALID_INPUT"], [429, "RATE_LIMITED"], [503, "ADMIN_UNAVAILABLE"]]) {
      let attempts = 0;
      globalThis.fetch = async () => { attempts++; return Response.json({ error: { code, message: "secret" } }, { status }); };
      await assert.rejects(localReferenceAdmin.categories(), error => error instanceof LocalAdminError && error.code === code && !error.message.includes("secret"));
      assert.equal(attempts, 1);
    }
    globalThis.fetch = async () => Response.json({ error: { code: "ADMIN_REQUIRED" } }, { status: 500 });
    await assert.rejects(localReferenceAdmin.categories(), { code: "ADMIN_UNAVAILABLE" });
    globalThis.fetch = async () => { throw new Error("private URL/secret"); };
    await assert.rejects(localReferenceAdmin.updateTariff({ id: tariff.id, price: 0 }), { code: "ADMIN_UNAVAILABLE" });
  } finally { globalThis.fetch = old; }
});
test("malformed successful data cannot enter an editor or expose extra credential fields", async () => {
  const old = globalThis.fetch;
  try {
    for (const payload of [{ categories: [{ ...category, token: "secret" }] }, { categories: [{ ...category, active: "true" }] }, { categories: [category], user: {} }, { categories: [{ ...category, id: "bad" }] }]) {
      globalThis.fetch = async () => Response.json(payload);
      await assert.rejects(localReferenceAdmin.categories(), { code: "ADMIN_UNAVAILABLE" });
    }
    for (const row of [{ ...tariff, price: 0.001 }, { ...tariff, durationDays: 0 }, { ...tariff, action: "unknown" }, { ...tariff, email: "secret" }]) {
      globalThis.fetch = async () => Response.json({ tariffs: [row] });
      await assert.rejects(localReferenceAdmin.tariffs(), { code: "ADMIN_UNAVAILABLE" });
    }
  } finally { globalThis.fetch = old; }
});
