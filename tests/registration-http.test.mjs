import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import * as boundary from "../src/lib/auth-http.ts";
import * as crypto from "node:crypto";

const ts = createRequire(import.meta.url)("typescript");
const environment = { NODE_ENV: "test", BLIZHNIY_AUTH_MODE: "local", BLIZHNIY_DB_HOST: "127.0.0.1", BLIZHNIY_DB_SSL_MODE: "disable",
  BLIZHNIY_AUTH_ORIGIN: "https://127.0.0.1:3037", BLIZHNIY_LOCAL_MAIL_URL: "http://127.0.0.1:3038/messages", BLIZHNIY_AUTH_RATE_SECRET: "s".repeat(64) };
function setup(changes = {}, options = {}) {
  const calls = { database: 0, register: [], confirm: [], resend: [], login: [], resolve: [], revoke: [], mail: [], logs: [] };
  const exports = {};
  class InputError extends Error {}
  const store = { register: async (input) => { calls.register.push(input); if (options.invalid) throw new InputError(); return options.mail ?? null; },
    confirmEmail: async (token) => { calls.confirm.push(token); return options.confirmed ?? false; },
    resendConfirmation: async (...args) => { calls.resend.push(args); return options.mail ?? null; } };
  const dependencies = {
    "node:crypto": crypto,
    "./auth-http": { ...boundary, readLocalAuthConfig: () => boundary.readLocalAuthConfig({ ...environment, ...changes }),
      AuthRateLimiter: class { async allow() { if (options.databaseError) throw new Error("sensitive database error"); return !options.limited; } } },
    "./postgres": { createPostgresDatabase: () => { calls.database++; return {}; } },
    "./registration": { RegistrationStore: class { constructor() { return store; } }, RegistrationInputError: InputError },
    "./identity": { IdentityStore: class {
      async login(...args) { calls.login.push(args); if (options.identityError) throw new Error("sensitive identity error"); return options.issued ?? null; }
      async resolveSession(token) { calls.resolve.push(token); if (options.identityError) throw new Error("sensitive identity error"); return options.user ?? null; }
      async revokeSession(token) { calls.revoke.push(token); if (options.identityError) throw new Error("sensitive identity error"); }
    } },
  };
  const source = readFileSync(new URL("../src/lib/registration-http.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, process: { env: { ...environment, ...changes } }, Response, URL, AbortSignal,
    console: { info: (line) => calls.logs.push(line), warn: (line) => calls.logs.push(line) },
    fetch: async (url, init) => { calls.mail.push({ url, init }); if (options.mailFailure) throw new Error("sensitive transport error"); return new Response(null, { status: 204 }); },
    require: (name) => { if (!(name in dependencies)) throw new Error("Unexpected import"); return dependencies[name]; },
  });
  const origin = changes.BLIZHNIY_AUTH_ORIGIN ?? environment.BLIZHNIY_AUTH_ORIGIN;
  const request = (data, headers = {}, method = "POST", query = "") => new Request(origin + "/api/account/register" + query, {
    method, headers: { host: new URL(origin).host, origin, "x-blizhniy-request": "1", "content-type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(data) }),
  });
  return { calls, handle: exports.handleRegistrationRequest, request };
}
const signup = { email: "test@example.invalid", password: "Synthetic local passphrase 2026!", acceptedAgreement: true,
  acknowledgedPrivacy: true, agreementVersion: "2026-06-18", privacyVersion: "2026-06-18" };
const mail = { email: signup.email, token: "a".repeat(64), expiresAt: new Date() };

test("off, production, unknown operation and CSRF denial never initialize the database", async () => {
  for (const [change, status] of [[{ BLIZHNIY_AUTH_MODE: "" }, 404], [{ NODE_ENV: "production" }, 503]]) {
    const app = setup(change);
    assert.equal((await app.handle(app.request(signup), "register")).status, status);
    assert.equal(app.calls.database, 0);
  }
  const app = setup();
  assert.equal((await app.handle(app.request(signup), "unknown")).status, 404);
  assert.equal((await app.handle(app.request(signup, { origin: "https://attacker.invalid" }), "register")).status, 403);
  assert.equal((await app.handle(app.request({}, {}, "GET"), "confirm")).status, 405);
  assert.equal(app.calls.database, 0);
});

const cookieName = "__Host-blizhniy_session";
const sessionToken = "b".repeat(64);
const identityUser = { id: "synthetic-user-id", email: signup.email, role: "user", isBlocked: false };
const issued = { token: sessionToken, user: { ...identityUser, passwordHash: "not-for-json" }, scope: "app", expiresAt: new Date(Date.now() + 8 * 3600000) };
const credentials = { email: signup.email, password: signup.password };

test("cookie actions refuse plaintext HTTP configuration before touching the database", async () => {
  for (const action of ["login", "session", "logout"]) {
    const app = setup({ BLIZHNIY_AUTH_ORIGIN: "http://127.0.0.1:3037" }, { issued, user: identityUser });
    const response = await app.handle(app.request(action === "login" ? credentials : {}, { cookie: `${cookieName}=${sessionToken}` }), action);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "HTTPS_REQUIRED" } });
    assert.equal(app.calls.database, 0);
  }
});

test("login issues only a host-scoped Secure/HttpOnly cookie and an allowlisted user, never JSON credentials", async () => {
  const app = setup({}, { issued });
  const response = await app.handle(app.request(credentials, { cookie: `${cookieName}=${"c".repeat(64)}` }), "login");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "authenticated", user: identityUser });
  assert.deepEqual(app.calls.login, [[credentials.email, credentials.password, "c".repeat(64)]]);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie.startsWith(`${cookieName}=${sessionToken};`));
  for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) assert.ok(cookie.includes(attribute));
  assert.doesNotMatch(cookie, /Domain=/i);
  const ttl = Number(cookie.match(/Max-Age=(\d+)/)[1]);
  assert.ok(ttl > 0 && ttl <= 8 * 3600);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(app.calls.database, 1);
  assert.equal(app.calls.mail.length, 0);
  assert.ok(app.calls.logs.every((line) => !line.includes(sessionToken) && !line.includes(credentials.password) && !line.includes(credentials.email)));
});
test("failed login has one generic response and preserves the previous browser session", async () => {
  const app = setup();
  const response = await app.handle(app.request(credentials, { cookie: `${cookieName}=${sessionToken}` }), "login");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: { code: "INVALID_CREDENTIALS" } });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(app.calls.revoke.length, 0);
});
test("login and session require the exact input contract and CSRF checks before opening a pool", async () => {
  for (const [action, data] of [["login", { ...credentials, role: "admin" }], ["login", { email: credentials.email, password: 1 }],
    ["session", { token: sessionToken }], ["logout", { userId: identityUser.id }]]) {
    const app = setup();
    assert.equal((await app.handle(app.request(data), action)).status, 422);
    assert.equal(app.calls.database, 0);
  }
  for (const action of ["login", "session", "logout"]) {
    const app = setup();
    assert.equal((await app.handle(app.request(credentials, { origin: "https://attacker.invalid" }), action)).status, 403);
    assert.equal((await app.handle(app.request({}, {}, "GET"), action)).status, 405);
    assert.equal(app.calls.database, 0);
  }
});
test("session rejects absent, malformed, duplicate and non-cookie credentials without a database lookup", async () => {
  for (const headers of [{}, { authorization: `Bearer ${sessionToken}` }, { cookie: `${cookieName}=invalid` },
    { cookie: `${cookieName}=${sessionToken}; ${cookieName}=${sessionToken}` }, { cookie: `other=${sessionToken}` },
    { cookie: `${cookieName}="${sessionToken}"` }, { cookie: `${cookieName}=${sessionToken.toUpperCase()}` }]) {
    const app = setup({}, { user: identityUser });
    const response = await app.handle(app.request({}, headers), "session");
    assert.equal(response.status, 401);
    assert.equal(app.calls.database, 0);
    assert.equal(app.calls.resolve.length, 0);
  }
});
test("session resolves current app authority and refuses invalid, expired or limited-scope sessions", async () => {
  for (const user of [null, { ...identityUser, role: "admin", passwordHash: "not-for-json" }]) {
    const app = setup({}, { user });
    const response = await app.handle(app.request({}, { cookie: `${cookieName}=${sessionToken}` }), "session");
    assert.equal(response.status, user ? 200 : 401);
    assert.deepEqual(await response.json(), user ? { user: { ...identityUser, role: "admin" } } : { error: { code: "UNAUTHENTICATED" } });
    assert.deepEqual(app.calls.resolve, [sessionToken]);
    assert.equal(response.headers.get("set-cookie"), null, "lookup never extends absolute cookie lifetime");
  }
});
test("logout revokes the cookie session, expires the same protected cookie and is idempotent without credentials", async () => {
  const app = setup();
  const response = await app.handle(app.request({}, { cookie: `${cookieName}=${sessionToken}` }), "logout");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "logged_out" });
  assert.deepEqual(app.calls.revoke, [sessionToken]);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie.startsWith(`${cookieName}=;`));
  for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=0"]) assert.ok(cookie.includes(attribute));
  const empty = setup();
  assert.equal((await empty.handle(empty.request({}), "logout")).status, 200);
  assert.equal(empty.calls.database, 0);
});
test("login rate limit precedes password work but cannot prevent session lookup or logout", async () => {
  const app = setup({}, { limited: true, user: identityUser });
  assert.equal((await app.handle(app.request(credentials), "login")).status, 429);
  assert.equal(app.calls.login.length, 0);
  assert.equal((await app.handle(app.request({}, { cookie: `${cookieName}=${sessionToken}` }), "session")).status, 200);
  assert.equal((await app.handle(app.request({}, { cookie: `${cookieName}=${sessionToken}` }), "logout")).status, 200);
  assert.equal(app.calls.database, 1, "all actions share one existing process pool");
});
test("session/database failures are generic and failed logout cannot pretend to revoke its server session", async () => {
  for (const action of ["login", "session", "logout"]) {
    const app = setup({}, { identityError: true });
    const response = await app.handle(app.request(action === "login" ? credentials : {}, { cookie: `${cookieName}=${sessionToken}` }), action);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "AUTH_UNAVAILABLE" } });
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(app.calls.logs.every((line) => !line.includes("sensitive identity error")));
    const event = JSON.parse(app.calls.logs.at(-1));
    assert.equal(event.operation, action);
    assert.equal(event.status, 503);
    assert.equal(event.code, "AUTH_UNAVAILABLE");
    assert.equal(event.entryPoint, "http");
    assert.equal(response.headers.get("x-request-id"), event.requestId);
  }
});
test("real email addresses, privilege injection and invalid confirmation payloads are rejected", async () => {
  const app = setup({}, { invalid: true });
  assert.equal((await app.handle(app.request({ ...signup, email: "real@example.ru" }), "register")).status, 422);
  assert.equal((await app.handle(app.request({ ...signup, role: "admin" }), "register")).status, 422);
  assert.equal((await app.handle(app.request({ token: mail.token, role: "admin" }), "confirm")).status, 422);
  assert.equal(app.calls.confirm.length, 0);
});
test("new and duplicate requests have identical JSON/status and both contact only the configured local sink", async () => {
  const created = setup({}, { mail });
  const duplicate = setup();
  const first = await created.handle(created.request(signup), "register");
  const second = await duplicate.handle(duplicate.request(signup), "register");
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.deepEqual(await first.json(), await second.json());
  for (const app of [created, duplicate]) {
    assert.equal(app.calls.mail.length, 1);
    assert.equal(app.calls.mail[0].url, environment.BLIZHNIY_LOCAL_MAIL_URL);
    assert.equal(app.calls.mail[0].init.redirect, "error");
    assert.ok(app.calls.mail[0].init.signal);
  }
  const envelope = JSON.parse(created.calls.mail[0].init.body);
  assert.equal(envelope.mail.to, mail.email);
  assert.ok(envelope.mail.text.includes("/auth/local/confirm#token=" + mail.token));
  assert.equal(JSON.parse(duplicate.calls.mail[0].init.body).mail, null);
  assert.ok(created.calls.logs.every((line) => !line.includes(mail.token) && !line.includes(mail.email) && !line.includes(signup.password)));
});
test("capture outage is observable without revealing account existence or leaking the transport exception", async () => {
  for (const payload of [mail, null]) {
    const app = setup({}, { mail: payload, mailFailure: true });
    const response = await app.handle(app.request(signup), "register");
    assert.equal(response.status, 202);
    assert.equal(app.calls.logs.some((line) => JSON.parse(line).event === "local_auth_mail_failed"), true);
    assert.equal(app.calls.logs.some((line) => line.includes("sensitive transport error")), false);
  }
});
test("rate denial and database outage fail closed before registration and before mail", async () => {
  for (const [options, status] of [[{ limited: true }, 429], [{ databaseError: true }, 503]]) {
    const app = setup({}, options);
    const response = await app.handle(app.request(signup), "register");
    assert.equal(response.status, status);
    assert.equal(app.calls.register.length, 0);
    assert.equal(app.calls.mail.length, 0);
    assert.equal(JSON.stringify(await response.json()).includes("sensitive"), false);
  }
});
test("confirmation has explicit success/replay semantics and no session cookie; resend accepts only email/password", async () => {
  const good = setup({}, { confirmed: true });
  const response = await good.handle(good.request({ token: mail.token }), "confirm");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(good.calls.mail.length, 0);
  const used = setup();
  assert.equal((await used.handle(used.request({ token: mail.token }), "confirm")).status, 400);
  assert.equal((await used.handle(used.request({ email: signup.email, password: signup.password }), "resend")).status, 202);
  assert.equal((await used.handle(used.request({ ...signup }), "resend")).status, 422);
});
