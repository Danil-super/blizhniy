import assert from "node:assert/strict";
import { test } from "node:test";
import { loadProfileModule } from "./production-profile-module.mjs";
const { parseProductionProfile, ProfileInputError, ProfileOwnerChangedError, PostgresProfileStore } = loadProfileModule("postgres-profile");
const { createProductionProfileHandler } = loadProfileModule("production-profile-http");
const origin = "https://xn----9sbphbgks4a4a.xn--p1ai";
const owner = "11111111-1111-4111-8111-111111111111";
const token = "a".repeat(64);

test("a fresh profile has a valid generic name instead of copying an email prefix into the name field", async () => {
  const db = { transaction: work => work({ query: async sql => {
    if (sql.startsWith("select u.id")) return { rowCount: 1, rows: [{ id: owner, role: "user", isBlocked: false, verified: true, authVersion: "0" }] };
    if (sql.startsWith("select email")) return { rowCount: 1, rows: [{ email: "owner-123@example.invalid" }] };
    return { rowCount: 1, rows: [] };
  } }) };
  const result = await new PostgresProfileStore(db).read(token, owner);
  assert.equal(result.profile.name, "Пользователь");
  assert.equal(result.profile.email, "owner-123@example.invalid");
  assert.equal(result.exists, false);
});

test("profile allowlist preserves user settings but cannot store identity or verification claims", () => {
  const result = parseProductionProfile({ name: "  Synthetic name  ", email: "attacker@example.invalid", phone: "+7 900 000-00-00",
    phoneVerified: true, verifiedPhone: "forged", notifyBookings: false, organizationInn: "1234567890" });
  assert.equal(result.name, "Synthetic name");
  assert.equal(result.notifyBookings, false);
  assert.equal(result.organizationInn, "1234567890");
  assert.equal(Object.hasOwn(result, "email"), false);
  assert.equal(Object.hasOwn(result, "phoneVerified"), false);
  assert.equal(Object.hasOwn(result, "verifiedPhone"), false);
  assert.equal(result.city, "Краснодар");
});
test("malformed, oversized and privileged profile fields fail rather than silently coercing", () => {
  for (const input of [null, [], { role: "admin" }, { user_id: owner }, { name: 42 }, { name: "a".repeat(121) },
    { notifyBookings: "false" }, { avatarZoom: 0 }, { avatarPositionX: 101 }, { name: "bad\u0000name" },
    { organizationInn: "123" }, { organizationOgrn: "12345678901234" },
    { avatarDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }, { avatarDataUrl: "data:image/png;base64,YXR0YWNrZXI=" },
    { avatarDataUrl: "data:image/png;base64,"+"a".repeat(410000) }]) {
    assert.throws(() => parseProductionProfile(input), ProfileInputError);
  }
});
test("supported bounded PNG bytes and literal SQL/HTML-looking text are accepted without execution", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const name = "<script>alert(1)</script>'); DROP TABLE app.users; --";
  assert.equal(parseProductionProfile({ avatarDataUrl: png, name }).avatarDataUrl, png);
  assert.equal(parseProductionProfile({ name }).name, name);
});

test("organization description retains the existing multiline editing contract", () => {
  const description = "Synthetic first line\nSecond line";
  assert.equal(parseProductionProfile({ organizationDescription: description }).organizationDescription, description);
});

function fixture(options = {}) {
  const calls = { factories: 0, reads: [], writes: [], limits: [], events: [] };
  const store = { read: async (...args) => { calls.reads.push(args); if (options.ownerChanged) throw new ProfileOwnerChangedError(); return { exists: false, profile: { name: "Synthetic" } }; },
    write: async (...args) => { calls.writes.push(args); return { profile: { name: "Synthetic" } }; } };
  const handle = createProductionProfileHandler({ origin }, () => {
    calls.factories++; if (options.outage) throw new Error("synthetic private failure");
    return { store, limiter: { allowProduction: async (...args) => { calls.limits.push(args); return !options.limited; } } };
  }, event => calls.events.push(event));
  const request = (body = { expectedOwnerId: owner }, headers = {}, method = "POST", query = "") => new Request(origin+"/api/account/profile"+query, {
    method, headers: { host: new URL(origin).host, origin, "x-blizhniy-request": "1", "x-real-ip": "192.0.2.1",
      "content-type": "application/json", cookie: `__Host-blizhniy_session=${token}`, ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  return { calls, handle, request };
}
test("profile HTTP rejects CSRF, owner overrides, bearer-only, malformed/duplicate cookies and missing trusted ingress before runtime", async () => {
  for (const [body, headers, method, query, status] of [
    [{ expectedOwnerId: owner }, {}, "GET", "", 405],
    [{ expectedOwnerId: owner }, { origin: "https://attacker.invalid" }, "POST", "", 403],
    [{ expectedOwnerId: owner }, { host: "attacker.invalid" }, "POST", "", 403],
    [{ expectedOwnerId: owner }, { "x-blizhniy-request": "" }, "POST", "", 403],
    [{ expectedOwnerId: owner }, { "sec-fetch-site": "cross-site" }, "POST", "", 403],
    [{ expectedOwnerId: owner }, { "x-real-ip": "", "cf-connecting-ip": "192.0.2.1" }, "POST", "", 403],
    [{ expectedOwnerId: owner }, { cookie: "", authorization: `Bearer ${token}` }, "POST", "", 401],
    [{ expectedOwnerId: owner }, { cookie: `__Host-blizhniy_session=${token}; __Host-blizhniy_session=${token}` }, "POST", "", 401],
    [{ expectedOwnerId: "malformed" }, {}, "POST", "", 422],
    [{ expectedOwnerId: owner, userId: owner }, {}, "POST", "", 422],
    [{ expectedOwnerId: owner }, {}, "POST", "?userId=other", 400],
    [{ expectedOwnerId: owner, profile: { role: "admin" } }, {}, "PUT", "", 422],
  ]) {
    const f = fixture(); const response = await f.handle(f.request(body, headers, method, query));
    assert.equal(response.status, status);
    assert.equal(f.calls.factories, 0);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
test("profile read/write use only cookie authority, expected owner and bounded validated fields", async () => {
  const f = fixture();
  assert.equal((await f.handle(f.request())).status, 200);
  assert.deepEqual(f.calls.reads, [[token, owner]]);
  const response = await f.handle(f.request({ expectedOwnerId: owner, profile: { name: "Synthetic" } }, {}, "PUT"));
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.writes[0].slice(0,2), [token, owner]);
  assert.equal(f.calls.writes[0][2].name, "Synthetic");
  assert.deepEqual(f.calls.limits, [["session", "192.0.2.1"], ["session", "192.0.2.1"]]);
  assert.equal(JSON.stringify(f.calls.events).includes(token), false);
  assert.equal(JSON.stringify(f.calls.events).includes(owner), false);
});
test("profile rate denial and storage failure never report success or expose raw causes", async () => {
  const limited = fixture({ limited: true });
  const denial = await limited.handle(limited.request());
  assert.equal(denial.status, 429);
  assert.equal(denial.headers.get("retry-after"), "900");
  assert.equal(limited.calls.reads.length, 0);
  const outage = fixture({ outage: true });
  const response = await outage.handle(outage.request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "PROFILE_UNAVAILABLE" } });
  assert.equal(JSON.stringify(outage.calls.events).includes("private"), false);
});

test("profile JSON cap is byte-based, does not trust declared length and leaves Auth's small default intact", async () => {
  const f = fixture();
  const huge = { expectedOwnerId: owner, profile: { name: "я".repeat(250000) } };
  const response = await f.handle(f.request(huge, { "content-length": "2" }, "PUT"));
  assert.equal(response.status, 413);
  assert.equal(f.calls.factories, 0);
  const read = await f.handle(f.request({ expectedOwnerId: owner, padding: "a".repeat(4096) }));
  assert.equal(read.status, 413);
  assert.equal(f.calls.factories, 0);
});

test("owner conflict retains its typed 409 response across module boundaries", async () => {
  const f = fixture({ ownerChanged: true });
  const response = await f.handle(f.request());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: { code: "SESSION_CHANGED" } });
});
