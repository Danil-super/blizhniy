import assert from "node:assert/strict";
import { test } from "node:test";
import { readLocalAuthConfig, readAuthJson, AuthRateLimiter, authJson, AuthRequestError } from "../src/lib/auth-http.ts";

const env = { NODE_ENV: "test", BLIZHNIY_AUTH_MODE: "local", BLIZHNIY_DB_HOST: "127.0.0.1", BLIZHNIY_DB_SSL_MODE: "disable",
  BLIZHNIY_AUTH_ORIGIN: "http://127.0.0.1:3037", BLIZHNIY_LOCAL_MAIL_URL: "http://127.0.0.1:3038/messages", BLIZHNIY_AUTH_RATE_SECRET: "s".repeat(64) };
const config = readLocalAuthConfig(env);
function request(body = {}, headers = {}, url = config.origin + "/api/account/register", method = "POST") {
  return new Request(url, { method, headers: { host: new URL(url).host, origin: config.origin, "content-type": "application/json", "x-blizhniy-request": "1", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
}

test("new auth is disabled by default, never enabled in production, and rejects nonliteral/nonlocal configuration", () => {
  assert.equal(readLocalAuthConfig({}), null);
  assert.equal(readLocalAuthConfig({ ...env, BLIZHNIY_AUTH_MODE: "" }), null);
  assert.deepEqual(config, { origin: env.BLIZHNIY_AUTH_ORIGIN, mailUrl: env.BLIZHNIY_LOCAL_MAIL_URL, rateSecret: env.BLIZHNIY_AUTH_RATE_SECRET });
  for (const change of [{ NODE_ENV: "production" }, { BLIZHNIY_DB_HOST: "37.252.20.119" }, { BLIZHNIY_DB_HOST: "localhost" },
    { BLIZHNIY_AUTH_ORIGIN: "http://localhost:3037" }, { BLIZHNIY_AUTH_ORIGIN: "http://127.0.0.1:3037/path" },
    { BLIZHNIY_AUTH_ORIGIN: "http://user@127.0.0.1:3037" }, { BLIZHNIY_AUTH_ORIGIN: "http://127.0.0.1:3037/" },
    { BLIZHNIY_LOCAL_MAIL_URL: "https://mail.example/messages" }, { BLIZHNIY_LOCAL_MAIL_URL: "http://127.0.0.1:3038/messages?x=1" },
    { BLIZHNIY_AUTH_RATE_SECRET: "short" }, { BLIZHNIY_DB_SSL_MODE: "verify-full" }]) {
    assert.throws(() => readLocalAuthConfig({ ...env, ...change }), /Invalid local auth configuration/);
  }
});
test("same-origin JSON POST with the explicit request header passes; cross-site, null/missing origin and simple form requests fail", async () => {
  assert.deepEqual(await readAuthJson(request({ email: "test@example.invalid" }), config), { email: "test@example.invalid" });
  for (const headers of [{ origin: "https://attacker.invalid" }, { origin: "null" }, { origin: "" },
    { "x-blizhniy-request": "" }, { "content-type": "text/plain" }, { "content-type": "application/x-www-form-urlencoded" },
    { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) {
    await assert.rejects(readAuthJson(request({}, headers), config), AuthRequestError);
  }
  await assert.rejects(readAuthJson(request({}, {}, config.origin + "/api/account/confirm?token=secret"), config), { status: 400 });
  await assert.rejects(readAuthJson(request({}, {}, "http://127.0.0.1:4044/api/account/register"), config), { status: 403 });
  await assert.rejects(readAuthJson(request({}, {}, undefined, "GET"), config), { status: 405 });
});
test("local HTTPS origin is explicit and protected by the same exact Origin and Host checks", async () => {
  const secure = readLocalAuthConfig({ ...env, BLIZHNIY_AUTH_ORIGIN: "https://127.0.0.1:3037" });
  const headers = { host: "127.0.0.1:3037", origin: secure.origin, "content-type": "application/json", "x-blizhniy-request": "1" };
  assert.deepEqual(await readAuthJson(new Request(secure.origin + "/api/account/login", { method: "POST", headers, body: "{}" }), secure), {});
  await assert.rejects(readAuthJson(new Request(secure.origin + "/api/account/login", { method: "POST", headers: { ...headers, origin: env.BLIZHNIY_AUTH_ORIGIN }, body: "{}" }), secure), { status: 403 });
  for (const origin of ["https://localhost:3037", "https://foreign.invalid:3037", "https://127.0.0.1:3037/", "ftp://127.0.0.1:3037"]) {
    assert.throws(() => readLocalAuthConfig({ ...env, BLIZHNIY_AUTH_ORIGIN: origin }));
  }
  assert.throws(() => readLocalAuthConfig({ ...env, BLIZHNIY_AUTH_ORIGIN: secure.origin, NODE_ENV: "production" }));
});
test("invalid JSON and oversized/truncated body fail without echoing the payload", async () => {
  await assert.rejects(readAuthJson(request({ value: "a".repeat(4096) }), config), { status: 413 });
  const bad = new Request(config.origin + "/api/account/register", { method: "POST", headers: {
    host: new URL(config.origin).host, origin: config.origin, "x-blizhniy-request": "1", "content-type": "application/json" }, body: "{private-invalid-input" });
  await assert.rejects(readAuthJson(bad, config), { status: 400, message: "Invalid request" });
  await assert.rejects(readAuthJson(request({}, { "content-length": "9000" }), config), { status: 413 });
});
test("body reading has a deadline and does not trust content-length to cap bytes", async () => {
  const headers = { host: new URL(config.origin).host, origin: config.origin, "x-blizhniy-request": "1", "content-type": "application/json" };
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } });
  const hanging = new Request(config.origin + "/api/account/register", { method: "POST", headers, body, duplex: "half" });
  await assert.rejects(readAuthJson(hanging, config, 25), { status: 408 });
  await assert.rejects(readAuthJson(request({ value: "a".repeat(4096) }, { "content-length": "2" }), config), { status: 413 });
});
test("Next's localhost-normalized URL does not override the explicitly configured Origin/actual Host", async () => {
  const url = config.origin.replace("127.0.0.1", "localhost") + "/api/account/register";
  assert.deepEqual(await readAuthJson(request({ valid: true }, { host: new URL(config.origin).host }, url), config), { valid: true });
  await assert.rejects(readAuthJson(request({}, { host: "foreign.invalid", "x-forwarded-host": new URL(config.origin).host }, url), config), { status: 403 });
});
test("responses never expose cookies/tokens; no-store, no-referrer and anti-sniff headers are present", async () => {
  const response = authJson({ status: "accepted" }, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { status: "accepted" });
});
test("limiter fails closed on database outage; email keys are hashed and do not accept unbounded input", async () => {
  const parameters = [];
  const db = { query: async (_sql, values) => { parameters.push(values); return { rows: [{ allowed: true }] }; } };
  const limiter = new AuthRateLimiter(db, config.rateSecret);
  assert.equal(await limiter.allow("Test@example.invalid"), true);
  assert.equal(parameters.length, 2);
  assert.ok(parameters.every(([key]) => /^[a-f0-9]{64}$/.test(key) && !key.includes("example")));
  const absent = new AuthRateLimiter({ query: async () => { throw new Error("database unavailable"); } }, config.rateSecret);
  await assert.rejects(absent.allow("test@example.invalid"), /database unavailable/);
  await assert.rejects(limiter.allow("a".repeat(255)), /Invalid rate limit key/);
});
