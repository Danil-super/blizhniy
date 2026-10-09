import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import * as boundary from "../src/lib/auth-http.ts";
import * as crypto from "node:crypto";

const ts = createRequire(import.meta.url)("typescript");
const environment = { NODE_ENV: "test", BLIZHNIY_AUTH_MODE: "local", BLIZHNIY_DB_HOST: "127.0.0.1", BLIZHNIY_DB_SSL_MODE: "disable",
  BLIZHNIY_AUTH_ORIGIN: "http://127.0.0.1:3037", BLIZHNIY_LOCAL_MAIL_URL: "http://127.0.0.1:3038/messages", BLIZHNIY_AUTH_RATE_SECRET: "s".repeat(64) };
function setup(changes = {}, options = {}) {
  const calls = { database: 0, register: [], confirm: [], resend: [], mail: [], logs: [] };
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
  };
  const source = readFileSync(new URL("../src/lib/registration-http.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, process: { env: { ...environment, ...changes } }, Response, URL, AbortSignal,
    console: { info: (line) => calls.logs.push(line), warn: (line) => calls.logs.push(line) },
    fetch: async (url, init) => { calls.mail.push({ url, init }); if (options.mailFailure) throw new Error("sensitive transport error"); return new Response(null, { status: 204 }); },
    require: (name) => { if (!(name in dependencies)) throw new Error("Unexpected import"); return dependencies[name]; },
  });
  const request = (data, headers = {}, method = "POST", query = "") => new Request(environment.BLIZHNIY_AUTH_ORIGIN + "/api/account/register" + query, {
    method, headers: { host: new URL(environment.BLIZHNIY_AUTH_ORIGIN).host, origin: environment.BLIZHNIY_AUTH_ORIGIN, "x-blizhniy-request": "1", "content-type": "application/json", ...headers },
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
