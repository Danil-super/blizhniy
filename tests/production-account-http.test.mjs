import assert from "node:assert/strict";
import { test } from "node:test";
import * as cookies from "../src/lib/account-cookie.ts";
import * as proxy from "../src/lib/trusted-proxy-ip.ts";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { loadProductionAuth } from "./production-auth-module.mjs";
const configModule = loadProductionAuth("production-auth-config");
const { createProductionAccountHandler } = loadProductionAuth("production-account-http", {
  "./account-cookie": cookies, "./trusted-proxy-ip": proxy, "./production-auth-config": configModule,
});
const origin = configModule.productionAuthOrigin;
const credentials = { email: "Synthetic@пример.рф", password: "Synthetic production passphrase!", captchaToken: "synthetic-proof" };
const signup = { ...credentials, acceptedAgreement: true, acknowledgedPrivacy: true,
  agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy };
const token = "a".repeat(64);
function fixture(options = {}) {
  const calls = { factories: 0, limits: [], captchas: [], register: [], resend: [], login: [], confirm: [], recovery: [], reset: [], revoke: [], events: [] };
  const runtime = {
    store: { register: async value => { calls.register.push(value); return { email: value.email, token }; },
      resendConfirmation: async (...args) => { calls.resend.push(args); return null; },
      confirmEmail: async value => { calls.confirm.push(value); return !options.invalidToken; } },
    recovery: { requestRecovery: async value => { calls.recovery.push(value); return null; },
      resetPassword: async value => { calls.reset.push(value); return options.invalidToken ? null : { email: "synthetic@example.invalid" }; } },
    identity: { login: async (...args) => { calls.login.push(args); return options.issued ?? null; },
      resolveSession: async () => options.user ?? null,
      revokeSession: async value => { if (options.revokeFailure) throw new Error("synthetic secret failure"); calls.revoke.push(value); } },
    limiter: { allowProduction: async (...args) => { calls.limits.push(args); return !options.limited; } },
    verifyCaptcha: async (...args) => { calls.captchas.push(args); return options.captcha ?? true; },
  };
  const handle = createProductionAccountHandler({ origin, rateSecret: "s".repeat(64), mailKeyFile: "/private/key.bin" },
    () => { calls.factories++; if (options.outage) throw new Error("synthetic secret failure"); return runtime; }, event => calls.events.push(event));
  const request = (data, headers = {}, method = "POST", query = "") => new Request(origin+"/api/account/register"+query, {
    method, headers: { host: new URL(origin).host, origin, "x-blizhniy-request": "1", "content-type": "application/json", "x-real-ip": "192.0.2.1", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(data) }),
  });
  return { calls, handle, request };
}
test("production HTTP rejects scanner, CSRF, wrong Host and untrusted ingress before creating a runtime", async () => {
  for (const [headers, method, query, status] of [[{}, "GET", "", 405], [{ origin: "https://attacker.invalid" }, "POST", "", 403],
    [{ host: "attacker.invalid", "x-forwarded-host": new URL(origin).host }, "POST", "", 403],
    [{ "x-blizhniy-request": "" }, "POST", "", 403], [{ "x-real-ip": "", "cf-connecting-ip": "192.0.2.1" }, "POST", "", 403],
    [{ "sec-fetch-site": "cross-site" }, "POST", "", 403], [{}, "POST", "?token=synthetic", 400]]) {
    const f = fixture();
    assert.equal((await f.handle(f.request(signup, headers, method, query), "register")).status, status);
    assert.equal(f.calls.factories, 0);
  }
});
test("production signup canonicalizes IDN email, strips CAPTCHA from business input and conceals tokens", async () => {
  const f = fixture();
  const response = await f.handle(f.request(signup), "register");
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: "accepted" });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(f.calls.register[0].email, "synthetic@xn--e1afmkfd.xn--p1ai");
  assert.equal(Object.hasOwn(f.calls.register[0], "captchaToken"), false);
  assert.deepEqual(f.calls.captchas[0], [credentials.captchaToken, "192.0.2.1"]);
  assert.deepEqual(f.calls.limits[0], ["credential", "192.0.2.1", "synthetic@xn--e1afmkfd.xn--p1ai"]);
  for (const value of [token, signup.email, signup.password, credentials.captchaToken]) assert.equal(JSON.stringify(f.calls.events).includes(value), false);
});
test("malformed payloads, role injection and SMTP-incompatible addresses never reach storage or CAPTCHA", async () => {
  for (const value of [{ ...signup, role: "admin" }, { ...signup, email: "a@example.ru,b@example.ru" },
    { ...signup, email: "a@xn--a.example" }, { ...signup, email: "я@example.ru" },
    { ...signup, acceptedAgreement: "true" }, { ...signup, captchaToken: "" }, { ...signup, password: 12 }]) {
    const f = fixture();
    assert.equal((await f.handle(f.request(value), "register")).status, 422);
    assert.equal(f.calls.factories, 0);
  }
});
test("shared rate denial runs before CAPTCHA/KDF; CAPTCHA outage and nonboolean result fail closed", async () => {
  const limited = fixture({ limited: true });
  assert.equal((await limited.handle(limited.request(signup), "register")).status, 429);
  assert.equal(limited.calls.captchas.length, 0);
  assert.equal(limited.calls.register.length, 0);
  for (const captcha of [false, "true", {}]) {
    const f = fixture({ captcha });
    assert.equal((await f.handle(f.request(signup), "register")).status, 403);
    assert.equal(f.calls.register.length, 0);
  }
});
test("login issues only an app-scope host cookie, sanitizes user fields and does not echo the session token", async () => {
  const user = { id: "synthetic-user", email: "synthetic@example.invalid", role: "user", isBlocked: false, passwordHash: "synthetic secret" };
  const f = fixture({ issued: { user, token, scope: "app", expiresAt: new Date(Date.now()+8*3600000) } });
  const response = await f.handle(f.request(credentials, { cookie: `__Host-blizhniy_session=${"b".repeat(64)}` }), "login");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "authenticated");
  assert.equal(Object.hasOwn(body.user, "passwordHash"), false);
  assert.equal(Object.hasOwn(body, "token"), false);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(response.headers.get("set-cookie").includes("Domain="), false);
  assert.equal(f.calls.login[0][2], "b".repeat(64));
  const privacy = fixture({ issued: { user, token, scope: "data-subject", expiresAt: new Date(Date.now()+3600000) } });
  assert.equal((await privacy.handle(privacy.request(credentials), "login")).status, 503);
});
test("confirmation is explicit POST without CAPTCHA/session; recovery/reset conceal source receipts and never log in", async () => {
  const f = fixture();
  const confirmed = await f.handle(f.request({ token }), "confirm");
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.headers.get("set-cookie"), null);
  assert.equal(f.calls.captchas.length, 0);
  assert.equal((await f.handle(f.request({ email: credentials.email, captchaToken: credentials.captchaToken }), "recover")).status, 202);
  const reset = await f.handle(f.request({ token, password: credentials.password, captchaToken: credentials.captchaToken }), "reset");
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { status: "password_reset" });
  assert.equal(reset.headers.get("set-cookie"), null);
});
test("session uses only cookie authority; logout survives credential rate denial, but storage failure never reports success", async () => {
  const f = fixture({ limited: true });
  const logout = await f.handle(f.request({}, { cookie: `__Host-blizhniy_session=${token}` }), "logout");
  assert.equal(logout.status, 200);
  assert.equal(f.calls.limits.length, 0);
  assert.deepEqual(f.calls.revoke, [token]);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  const failure = fixture({ revokeFailure: true });
  assert.equal((await failure.handle(failure.request({}, { cookie: `__Host-blizhniy_session=${token}` }), "logout")).status, 503);
  const noCookie = fixture();
  assert.equal((await noCookie.handle(noCookie.request({}, { authorization: `Bearer ${token}` }), "session")).status, 401);
});
test("unexpected storage errors return generic unavailable, with no raw cause or cookie", async () => {
  const f = fixture({ outage: true });
  const response = await f.handle(f.request(signup), "register");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "AUTH_UNAVAILABLE" } });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(JSON.stringify(f.calls.events).includes("synthetic secret failure"), false);
});
