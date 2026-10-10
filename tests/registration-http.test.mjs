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
  const calls = { database: 0, register: [], confirm: [], resend: [], login: [], resolve: [], revoke: [], mail: [], logs: [], recover: [], reset: [], limits: [] };
  const exports = {};
  class InputError extends Error {}
  const store = { register: async (input) => { calls.register.push(input); if (options.invalid) throw new InputError(); return options.mail ?? null; },
    confirmEmail: async (token) => { calls.confirm.push(token); return options.confirmed ?? false; },
    resendConfirmation: async (...args) => { calls.resend.push(args); return options.mail ?? null; } };
  const dependencies = {
    "node:crypto": crypto,
    "./auth-http": { ...boundary, readLocalAuthConfig: () => boundary.readLocalAuthConfig({ ...environment, ...changes }),
      AuthRateLimiter: class { async allow(email) { calls.limits.push(email); if (options.databaseError) throw new Error("sensitive database error"); return !options.limited; } } },
    "./postgres": { createPostgresDatabase: () => { calls.database++; return {}; } },
    "./registration": { RegistrationStore: class { constructor() { return store; } }, RegistrationInputError: InputError },
    "./password-recovery": { RecoveryInputError: InputError, PasswordRecoveryStore: class {
      async requestRecovery(email) { calls.recover.push(email); if (options.recoveryWork) return options.recoveryWork(email); return options.recovery ?? null; }
      async resetPassword(input) { calls.reset.push(input); if (options.resetError) throw options.resetError; return options.receipt ?? null; }
    } },
    "./identity": { IdentityStore: class {
      async login(...args) { calls.login.push(args); if (options.identityError) throw new Error("sensitive identity error"); return options.issued ?? null; }
      async resolveSession(token) { calls.resolve.push(token); if (options.identityError) throw new Error("sensitive identity error"); return options.user ?? null; }
      async revokeSession(token) { calls.revoke.push(token); if (options.identityError) throw new Error("sensitive identity error"); }
    } },
  };
  const source = readFileSync(new URL("../src/lib/registration-http.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, process: { env: { ...environment, ...changes } }, Response, URL, AbortSignal, Error,
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

const resetInput = { token: "d".repeat(64), password: "Synthetic replacement HTTP passphrase 2026!" };
const settleJobs = () => new Promise((resolve) => setImmediate(resolve));

test("recovery actions are default-off, local-only, HTTPS-only and CSRF guarded before opening the pool", async () => {
  for (const action of ["recover", "reset"]) {
    const input = action === "recover" ? { email: signup.email } : resetInput;
    for (const [changes, status] of [[{ BLIZHNIY_AUTH_MODE: "" }, 404], [{ NODE_ENV: "production" }, 503],
      [{ BLIZHNIY_DB_HOST: "remote.invalid" }, 503], [{ BLIZHNIY_AUTH_ORIGIN: "http://127.0.0.1:3037" }, 503]]) {
      const app = setup(changes);
      assert.equal((await app.handle(app.request(input), action)).status, status);
      assert.equal(app.calls.database, 0);
    }
    const app = setup();
    assert.equal((await app.handle(app.request({}, {}, "GET"), action)).status, 405);
    assert.equal((await app.handle(app.request(input, { origin: "https://foreign.invalid" }), action)).status, 403);
    assert.equal((await app.handle(app.request(input, { "x-blizhniy-request": "" }), action)).status, 403);
    assert.equal((await app.handle(app.request(input, {}, "POST", "?token=secret"), action)).status, 400);
    assert.equal(app.calls.database, 0);
  }
});
test("recovery contracts reject unknown fields, real recipients and malformed tokens before database work", async () => {
  for (const [action, input] of [["recover", { email: signup.email, password: signup.password }], ["recover", { email: "real@example.ru" }],
    ["recover", { email: "a\u0000@example.invalid" }], ["reset", { ...resetInput, role: "admin" }], ["reset", { ...resetInput, token: "bad" }],
    ["reset", { ...resetInput, password: "a".repeat(257) }], ["reset", { ...resetInput, password: null }]]) {
    const app = setup();
    assert.equal((await app.handle(app.request(input), action)).status, 422);
    assert.equal(app.calls.database, 0);
  }
});
test("recovery acceptance never awaits the existence lookup or mail, and bounded jobs reject overload without queuing", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const app = setup({}, { recoveryWork: () => held });
  const accept = () => app.handle(app.request({ email: " TEST@example.invalid " }), "recover");
  try {
    for (let i = 0; i < 2; i++) {
      const response = await accept();
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { status: "accepted" });
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal(app.calls.mail.length, 0, "response arrives while account lookup is unresolved");
    assert.deepEqual(app.calls.recover, [signup.email, signup.email]);
    const overloaded = await accept();
    assert.equal(overloaded.status, 503);
    assert.equal(app.calls.recover.length, 2, "no unbounded pending queue");
  } finally { release(null); await settleJobs(); }
  assert.equal((await accept()).status, 202, "job slots released after completion");
  await settleJobs();
  assert.equal(app.calls.database, 1, "same process pool for all actions");
});
test("existing and missing recipients receive identical responses; only the internal captured message has a fragment token", async () => {
  for (const payload of [mail, null]) {
    const app = setup({}, { recovery: payload });
    const response = await app.handle(app.request({ email: signup.email }), "recover");
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: "accepted" });
    await settleJobs();
    const capture = app.calls.mail[0];
    assert.equal(capture.url, environment.BLIZHNIY_LOCAL_MAIL_URL);
    assert.equal(capture.init.redirect, "error");
    assert.equal(capture.init.headers["X-Blizhniy-Entry-Point"], "worker");
    assert.equal(capture.init.headers["X-Request-ID"], response.headers.get("x-request-id"));
    const envelope = JSON.parse(capture.init.body).mail;
    if (payload) {
      assert.equal(envelope.to, signup.email);
      assert.ok(envelope.text.includes("/auth/local/reset#token=" + mail.token));
      assert.ok(envelope.text.includes("30 минут"));
    } else assert.equal(envelope, null);
    assert.ok(app.calls.logs.every((line) => !line.includes(mail.token) && !line.includes(signup.email)));
  }
});
test("both recovery actions use the existing shared limiter before reset KDF or recovery admission", async () => {
  for (const action of ["recover", "reset"]) {
    const input = action === "recover" ? { email: " TEST@example.invalid " } : resetInput;
    const app = setup({}, { limited: true });
    const response = await app.handle(app.request(input), action);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "900");
    assert.deepEqual(app.calls.limits, [action === "recover" ? signup.email : undefined]);
    assert.equal(app.calls.recover.length + app.calls.reset.length, 0);
    assert.equal(app.calls.mail.length, 0);
  }
});
test("reset returns no identity or cookie, preserves unrelated browser cookie and sends only a post-commit notification", async () => {
  const app = setup({}, { receipt: { email: signup.email } });
  const response = await app.handle(app.request(resetInput, { cookie: `${cookieName}=${sessionToken}` }), "reset");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "password_reset" });
  assert.equal(response.headers.get("set-cookie"), null, "reset cannot log in or remove an unrelated account cookie");
  assert.equal(app.calls.login.length + app.calls.resolve.length + app.calls.revoke.length, 0);
  assert.deepEqual(app.calls.reset, [resetInput]);
  const notification = JSON.parse(app.calls.mail[0].init.body).mail;
  assert.equal(notification.to, signup.email);
  assert.ok(notification.text.includes("Пароль изменён"));
  assert.ok(notification.text.includes("сессии отозваны"));
  for (const sensitive of [resetInput.token, resetInput.password, sessionToken]) {
    assert.equal(notification.text.includes(sensitive), false);
    assert.ok(app.calls.logs.every((line) => !line.includes(sensitive)));
  }
});
test("invalid reset, password policy and unknown commit have explicit generic semantics, no notification or automatic retry", async () => {
  for (const [options, status, code] of [[{}, 400, "INVALID_RECOVERY"], [{ resetError: new Error("Invalid password") }, 422, "INVALID_INPUT"],
    [{ resetError: new Error("sensitive unknown commit") }, 503, "AUTH_UNAVAILABLE"]]) {
    const app = setup({}, options);
    const response = await app.handle(app.request(resetInput), "reset");
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
    assert.equal(app.calls.reset.length, 1);
    assert.equal(app.calls.mail.length, 0);
    assert.ok(app.calls.logs.every((line) => !line.includes("sensitive")));
  }
});
test("background recovery failure releases capacity and is logged without leaking existence; notification failure does not undo reset", async () => {
  const app = setup({}, { recoveryWork: async () => { throw new Error("sensitive recovery failure"); } });
  for (let i = 0; i < 3; i++) {
    assert.equal((await app.handle(app.request({ email: signup.email }), "recover")).status, 202);
    await settleJobs();
  }
  assert.ok(app.calls.logs.some((line) => JSON.parse(line).event === "local_auth_recovery_failed"));
  assert.ok(app.calls.logs.every((line) => !line.includes("sensitive") && !line.includes(signup.email)));
  const reset = setup({}, { receipt: { email: signup.email }, mailFailure: true });
  assert.equal((await reset.handle(reset.request(resetInput), "reset")).status, 200);
  assert.equal(reset.calls.reset.length, 1);
  assert.ok(reset.calls.logs.some((line) => JSON.parse(line).event === "local_auth_mail_failed"));
  const failedMail = setup({}, { recovery: mail, mailFailure: true });
  const response = await failedMail.handle(failedMail.request({ email: signup.email }), "recover");
  assert.equal(response.status, 202);
  await settleJobs();
  const event = failedMail.calls.logs.map((line) => JSON.parse(line)).find((event) => event.event === "local_auth_mail_failed");
  assert.equal(event.entryPoint, "worker");
  assert.equal(event.requestId, response.headers.get("x-request-id"));
});
test("framework logging and headers protect local auth URLs, including rejected query credentials", async () => {
  const exports = {};
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, process: { env: { NODE_ENV: "test" } } });
  const ignore = exports.default.logging?.incomingRequests?.ignore ?? [];
  for (const path of ["/api/account/reset?token=secret", "/api/account/recover?email=private", "/auth/local/reset?token=secret", "/auth/local?email=private"]) {
    assert.ok(ignore.some((pattern) => pattern.test(path)), path);
  }
  assert.equal(ignore.some((pattern) => pattern.test("/katalog")), false, "unrelated development logs are unchanged");
  const headers = await exports.default.headers();
  for (const source of ["/api/account/:path*", "/auth/local/:path*"]) {
    assert.equal(headers.find((rule) => rule.source === source)?.headers.find((header) => header.key === "Referrer-Policy")?.value, "no-referrer");
  }
});
