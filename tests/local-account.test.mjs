import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import * as validation from '../src/lib/account-validation.ts';
import { PasswordField } from './password-field-module.mjs';
import * as captchaProvider from './account-captcha-provider-module.mjs';

const require = createRequire(import.meta.url);
const ts = require("typescript");
const user = { id: "12345678-1234-4321-8765-123456789abc", email: "owner@example.invalid", role: "user", isBlocked: false };
function setup(payload, status = 200, failure = false) {
  const calls = [];
  const exports = {};
  const source = readFileSync(new URL("../src/lib/local-account.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, AbortSignal, fetch: async (url, init) => {
      calls.push({ url, init });
      if (failure) throw new Error("sensitive transport failure");
      return Response.json(payload, { status });
    }, require: () => { throw new Error("Unexpected browser adapter import"); },
  });
  return { api: exports.localAccount, production: exports.productionAccount, calls, source };
}
test("account adapter sends only same-origin JSON and never trims password or persists credentials", async () => {
  const app = setup({ status: "authenticated", user });
  assert.deepEqual(JSON.parse(JSON.stringify(await app.api.login(user.email, "  Synthetic passphrase 2026!  "))), user);
  const [{ url, init }] = app.calls;
  assert.equal(url, "/api/account/login");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error", "credential-bearing POST must never follow a redirect");
  assert.deepEqual(JSON.parse(init.body), { email: user.email, password: "  Synthetic passphrase 2026!  " });
  assert.equal(init.headers["X-Blizhniy-Request"], "1");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.ok(init.signal);
  assert.doesNotMatch(app.source, /supabase|localStorage|sessionStorage|document\.cookie|node:crypto/i);
});
test("only the specific unauthenticated session response means anonymous", async () => {
  assert.equal(await setup({ error: { code: "UNAUTHENTICATED" } }, 401).api.session(), null);
  const app = setup({ user });
  assert.deepEqual(JSON.parse(JSON.stringify(await app.api.session())), user);
  assert.deepEqual(JSON.parse(app.calls[0].init.body), {});
  for (const [body, status] of [[{ error: { code: "INVALID_CREDENTIALS" } }, 401], [{ error: { code: "UNAUTHENTICATED" } }, 503], [{ error: { code: "AUTH_UNAVAILABLE" } }, 503], [null, 200]]) {
    await assert.rejects(setup(body, status).api.session(), (error) => error.code !== "UNAUTHENTICATED");
  }
});
test("untrusted user payloads cannot create a signed-in view or inject secrets", async () => {
  for (const change of [{ id: "not-a-uuid" }, { email: "x" }, { role: "superadmin" }, { isBlocked: true }, { token: "not-for-browser-state" }, { passwordHash: "not-for-browser-state" }]) {
    await assert.rejects(setup({ user: { ...user, ...change } }).api.session(), { code: "AUTH_UNAVAILABLE" });
  }
  await assert.rejects(setup({ status: "authenticated", user, token: "not-for-browser-state" }).api.login(user.email, "Synthetic passphrase 2026!"), { code: "AUTH_UNAVAILABLE" });
});
test("finite errors survive but transport failures and arbitrary server messages are generic", async () => {
  for (const [code, status] of [["INVALID_CREDENTIALS", 401], ["RATE_LIMITED", 429], ["HTTPS_REQUIRED", 503]]) {
    await assert.rejects(setup({ error: { code } }, status).api.login(user.email, "Synthetic passphrase 2026!"), { code });
  }
  for (const app of [setup({ error: { code: "sensitive database error" } }, 503), setup({}, 200, true)]) {
    await assert.rejects(app.api.login(user.email, "Synthetic passphrase 2026!"), { code: "AUTH_UNAVAILABLE" });
  }
  for (const code of ["INVALID_CREDENTIALS", "INVALID_INPUT", "RATE_LIMITED", "SYNTHETIC_EMAIL_REQUIRED"]) {
    await assert.rejects(setup({ error: { code } }, 503).api.login(user.email, "Synthetic passphrase 2026!"), { code: "AUTH_UNAVAILABLE" });
  }
});
test("logout is successful only for the exact successful response; no automatic retry", async () => {
  const app = setup({ status: "logged_out" });
  await app.api.logout();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].url, "/api/account/logout");
  for (const payload of [{ status: "authenticated" }, { status: "logged_out", token: "not-for-browser-state" }]) {
    await assert.rejects(setup(payload).api.logout(), { code: "AUTH_UNAVAILABLE" });
  }
  const failed = setup({ error: { code: "AUTH_UNAVAILABLE" } }, 503);
  await assert.rejects(failed.api.logout(), { code: "AUTH_UNAVAILABLE" });
  assert.equal(failed.calls.length, 1);
});
test("server rendering the account form never reads a session or includes a previous identity", () => {
  const source = readFileSync(new URL("../src/components/auth/LocalAccountForm.tsx", import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: (name) => name === './AccountCaptchaProvider' ? captchaProvider : name === '@/lib/account-validation' ? validation : name === './PasswordField' ? { PasswordField } : name === "@/lib/local-account" ? { localAccount: new Proxy({}, { get: () => { throw new Error("Session read during SSR"); } }) } : name === "@/components/TurnstileWidget" ? { TurnstileWidget: () => null } : require(name),
  });
  const html = require("react-dom/server").renderToStaticMarkup(require("react").createElement(exports.LocalAccountForm));
  assert.match(html, /Проверяем сессию/);
  assert.doesNotMatch(html, /owner@example|type="password"|Администратор/);
  assert.doesNotMatch(source, /supabase|localStorage|sessionStorage|document\.cookie/i);
});

test("production cookie client accepts canonical public email, sends CAPTCHA only on login and never exposes a token", async () => {
  const publicUser = { ...user, email: "notifications@xn----9sbphbgks4a4a.xn--p1ai" };
  const app = setup({ status: "authenticated", user: publicUser });
  assert.ok(app.production, "production adapter exists");
  assert.deepEqual(JSON.parse(JSON.stringify(await app.production.login(publicUser.email, "  Synthetic passphrase 2026!  ", "fixture-captcha"))), publicUser);
  assert.deepEqual(JSON.parse(app.calls[0].init.body), { email: publicUser.email, password: "  Synthetic passphrase 2026!  ", captchaToken: "fixture-captcha" });
  assert.equal(app.calls[0].init.redirect, "error");
  await assert.rejects(app.api.login(publicUser.email, "Synthetic passphrase 2026!"), { code: "AUTH_UNAVAILABLE" }, "local adapter remains synthetic-only");
  for (const change of [{ email: "Name <owner@example.ru>" }, { email: "owner@example.ru\r\nBcc:x@example.ru" }, { email: "x" }, { token: "secret" }, { role: "superadmin" }, { isBlocked: true }]) {
    await assert.rejects(setup({ user: { ...publicUser, ...change } }).production.session(), { code: "AUTH_UNAVAILABLE" });
  }
  assert.equal(await setup({ error: { code: "UNAUTHENTICATED" } }, 401).production.session(), null);
  const session = setup({ user: publicUser });
  await session.production.session();
  assert.deepEqual(JSON.parse(session.calls[0].init.body), {});
  await assert.rejects(setup({ error: { code: "CAPTCHA_REQUIRED" } }, 403).production.login(publicUser.email, "Synthetic passphrase 2026!", "bad"), { code: "CAPTCHA_REQUIRED" });
});
