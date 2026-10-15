import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as contract from "../src/lib/listing-draft-contract.ts";
const ts = createRequire(import.meta.url)("typescript");
const owner = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-8222-8222-222222222222";
const snapshot = { id, revision: "9007199254740993", draft: { kind: "prodam", title: "Synthetic title", description: "", categoryId: null, cityId: null, price: "12.30" } };
function client(fetch) {
  const exports = {};
  const source = readFileSync(new URL("../src/lib/client-listing-drafts.ts", import.meta.url), "utf8");
  new Function("require", "exports", "fetch", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
    name => { assert.equal(name, "./listing-draft-contract");return contract; }, exports, fetch);
  return exports.productionDrafts;
}
test("draft browser operations carry only cookie authority, canonical core and exact revision with no write retries", async () => {
  const calls = [], api = client(async (url, options) => {
    calls.push({ url, options });return Response.json(url.endsWith("collection") && options.method === "POST" ? { items: [], nextCursor: null } : snapshot);
  });
  assert.deepEqual(await api.list(owner, null), { items: [], nextCursor: null });
  assert.deepEqual(await api.createEmpty(owner, id), snapshot);
  assert.deepEqual(await api.read(owner, id), snapshot);
  assert.deepEqual(await api.write(owner, id, snapshot.revision, snapshot.draft), snapshot);
  assert.equal(calls.length, 4);
  for (const { url, options } of calls) {
    assert.match(url, /^\/api\/account\/listing-drafts(?:\/collection)?$/);
    assert.equal(options.credentials, "same-origin");assert.equal(options.redirect, "error");assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, undefined);assert.equal(options.headers["X-Blizhniy-Request"], "1");
    assert.equal(JSON.parse(options.body).expectedOwnerId, owner);
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), { expectedOwnerId: owner, creationKey: id });
  assert.equal(JSON.parse(calls[3].options.body).expectedRevision, snapshot.revision);
});
test("draft browser rejects wrong IDs, noncanonical or privileged server fields, oversized replies and unknown outcomes", async () => {
  for (const response of [{ ...snapshot, id: owner }, { ...snapshot, revision: 1 }, { ...snapshot, authorId: owner },
    { ...snapshot, draft: { ...snapshot.draft, paid: true } }, { ...snapshot, draft: { ...snapshot.draft, price: "12.3" } },
    { ...snapshot, draft: { ...snapshot.draft, description: "x".repeat(70000) } }]) {
    let count = 0;const api = client(async () => { count++;return Response.json(response); });
    await assert.rejects(api.read(owner, id), error => error.code === "UNKNOWN");assert.equal(count, 1);
  }
  let count = 0;
  const api = client(async () => { count++;throw new Error("synthetic-private-SQL-cause"); });
  await assert.rejects(api.write(owner, id, "1", snapshot.draft), error => error.code === "UNKNOWN" && !error.message.includes("synthetic-private"));
  assert.equal(count, 1);
});
test("draft browser refuses invalid input and aborted operations before sending any request", async () => {
  const api = client(async () => assert.fail("unexpected request")), aborted = new AbortController();aborted.abort();
  await assert.rejects(api.list("bad", null));await assert.rejects(api.createEmpty(owner, "bad"));
  await assert.rejects(api.write(owner, id, 1, snapshot.draft));
  await assert.rejects(api.write(owner, id, "1", { ...snapshot.draft, paid: true }));
  await assert.rejects(api.list(owner, null, { signal: aborted.signal }));
});
test("draft browser accepts only bounded unique summary pages and a matching continuation cursor", async () => {
  const summary = { id, revision: "1", kind: "prodam", title: "", price: null };
  for (const page of [{ items: [summary, summary], nextCursor: null }, { items: [summary], nextCursor: { id, updatedAt: "2026-10-15T12:13:14.123456Z" } },
    { items: [{ ...summary, contact_phone: "synthetic-private" }], nextCursor: null }, { items: Array(21).fill(summary), nextCursor: null }]) {
    await assert.rejects(client(async () => Response.json(page)).list(owner, null));
  }
  assert.deepEqual(await client(async () => Response.json({ items: [summary], nextCursor: null })).list(owner, null), { items: [summary], nextCursor: null });
});
