import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { createDefaultCabinetProfile } from "../src/lib/cabinet-profile.ts";
const ts = createRequire(import.meta.url)("typescript");
const owner = "12345678-1234-4321-8765-123456789abc";
const profile = createDefaultCabinetProfile({ name: "Synthetic", email: "synthetic@example.invalid" });
function fixture(transport, snapshotContract = false) {
  const exports = {};
  const source = readFileSync(new URL("../src/lib/client-postgres-profile.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, fetch: transport, AbortSignal, TextDecoder, Object, Error, JSON });
  const client = exports.productionProfile;
  if (snapshotContract) return client;
  // Preserve existing profile/identity assertions while exercising the actual new DTO parser.
  // Revision transport/validation are asserted separately against the unadapted client below.
  return {
    read: async (id, options) => (await client.read(id, options)).profile,
    write: async (id, value, options) => (await client.write(id, value, "b".repeat(64), options)).profile,
  };
}
test("cookie profile requests capture expected owner, never send a Bearer and do not read shared browser storage", async () => {
  const requests = [];
  const client = fixture(async (url, options) => {
    requests.push({ url, options });
    return Response.json(options.method === "POST" ? { exists: true, profile, revision: "b".repeat(64) } : { profile, revision: "b".repeat(64) });
  });
  assert.deepEqual(await client.read(owner), profile);
  assert.deepEqual(await client.write(owner, profile), profile);
  assert.deepEqual(requests.map(row => row.url), ["/api/account/profile", "/api/account/profile"]);
  assert.deepEqual(requests.map(row => row.options.method), ["POST", "PUT"]);
  for (const { options } of requests) {
    assert.equal(options.credentials, "same-origin"); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    assert.equal(options.headers["X-Blizhniy-Request"], "1"); assert.equal(options.headers.Authorization, undefined);
    assert.equal(JSON.parse(options.body).expectedOwnerId, owner);
  }
  assert.equal(JSON.parse(requests[1].options.body).expectedRevision, "b".repeat(64));
});
test("bad identities and pre-aborted operations cannot send a profile request", async () => {
  let requests = 0;
  const client = fixture(async () => { requests++; assert.fail("unexpected request"); });
  await assert.rejects(client.read("local-user"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.write(owner, profile, { signal: controller.signal }));
  assert.equal(requests, 0);
});
test("unknown write outcome is not retried, and server causes/PII cannot become the displayed error", async () => {
  for (const transport of [async () => { throw new Error("synthetic private failure"); },
    async () => Response.json({ profile: { ...profile, password_hash: "synthetic-private" }, revision: "b".repeat(64) }),
    async () => Response.json({ error: "synthetic-private" }, { status: 503 })]) {
    let requests = 0;
    const client = fixture(async (...args) => { requests++; return transport(...args); });
    await assert.rejects(client.write(owner, profile), error => error.code === "UNKNOWN" && !error.message.includes("synthetic-private"));
    assert.equal(requests, 1);
  }
});
test("read response requires exact profile fields and server-owned verification values", async () => {
  for (const malformed of [{ ...profile, phoneVerified: true }, { ...profile, verifiedPhone: "forged" },
    { ...profile, notifySystem: "false" }, { ...profile, avatarDataUrl: "data:text/html;base64,PHNjcmlwdD4=" },
    { ...profile, avatarZoom: 0 }, { ...profile, email: null }]) {
    const client = fixture(async () => Response.json({ exists: true, profile: malformed, revision: "b".repeat(64) }));
    await assert.rejects(client.read(owner));
  }
});
test("owner conflict and invalid input retain bounded known codes, but oversized responses fail closed", async () => {
  for (const [status, code] of [[409, "SESSION_CHANGED"], [422, "INVALID_INPUT"], [401, "UNAUTHENTICATED"]]) {
    const client = fixture(async () => Response.json({ error: { code } }, { status }));
    await assert.rejects(client.write(owner, profile), error => error.code === code);
  }
  const huge = fixture(async () => Response.json({ exists: true, profile: { ...profile, name: "a".repeat(500001) }, revision: "b".repeat(64) }));
  await assert.rejects(huge.read(owner));
});

test("content revision is returned separately from private profile fields and sent with a write", async () => {
  const revision = "b".repeat(64), next = "c".repeat(64), requests = [];
  const client = fixture(async (url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json(options.method === "POST" ? { exists: true, profile, revision } : { profile, revision: next });
  }, true);
  const read = await client.read(owner);
  assert.equal(read.revision, revision);
  assert.deepEqual(read.profile, profile);
  const written = await client.write(owner, profile, read.revision);
  assert.equal(written.revision, next);
  assert.deepEqual(written.profile, profile);
  assert.equal(requests[1].expectedRevision, revision);
  assert.equal(Object.hasOwn(requests[1].profile, "revision"), false);
});

test("stale profile writes retain a known conflict code without automatic retries", async () => {
  let writes = 0;
  const client = fixture(async () => { writes += 1; return Response.json({ error: { code: "PROFILE_CHANGED" } }, { status: 409 }); }, true);
  await assert.rejects(client.write(owner, profile, "b".repeat(64)), error => error.code === "PROFILE_CHANGED");
  assert.equal(writes, 1);
});

test("unknown or inconsistent revisions cannot make a profile response authoritative", async () => {
  for (const [method, payload] of [
    ["POST", { exists: true, profile, revision: null }],
    ["POST", { exists: false, profile, revision: "b".repeat(64) }],
    ["POST", { exists: false, profile }],
    ["PUT", { profile, revision: null }],
    ["PUT", { profile, revision: "B".repeat(64) }],
    ["PUT", { profile, revision: "b".repeat(65) }],
  ]) {
    const client = fixture(async () => Response.json(payload), true);
    await assert.rejects(method === "POST" ? client.read(owner) : client.write(owner, profile, null), error => error.code === "UNKNOWN");
  }
  let calls = 0;
  const client = fixture(async () => { calls += 1; assert.fail("invalid revision cannot send"); }, true);
  for (const revision of [undefined, "", 12, {}, "B".repeat(64)]) {
    await assert.rejects(client.write(owner, profile, revision), error => error.code === "INVALID_INPUT");
  }
  assert.equal(calls, 0);
});
