import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = new URL("../", import.meta.url);
const token = "synthetic-captcha-token";
const success = () => ({ ok: true, json: async () => ({ success: true }) });
const testIp = (index) => `198.18.${Math.floor(index / 256)}.${index % 256}`;

// Execute the complete production modules, with only I/O, clock and environment
// replaced. No .env file, database, real provider or process-global fetch is used.
function makeHarness({ environment, fetchImpl } = {}) {
  let now = 1_800_000_000_000;
  const requests = [];
  const maps = [];
  const timers = new Map();
  const createdApplications = [];
  const cache = new Map();
  const isolatedEnvironment = environment ?? { NODE_ENV: "production", TURNSTILE_SECRET_KEY: "synthetic-secret" };
  class Clock extends Date {
    static now() { return now; }
  }
  class ObservedMap extends Map {
    constructor(...args) {
      super(...args);
      this.peakSize = this.size;
      maps.push(this);
    }
    set(key, value) {
      super.set(key, value);
      this.peakSize = Math.max(this.peakSize ?? 0, this.size);
      return this;
    }
  }
  const fakeGlobals = {
    setTimeout(callback, delay) {
      const timer = {};
      timers.set(timer, { callback, delay });
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
  };
  const mocks = {
    "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } },
    "@/lib/server-auth": {
      getAuthenticatedRequestUser: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }),
      isAdminRequest: async () => false,
    },
    "@/lib/supabase-rest": { isSupabaseRestConfigured: () => true },
    "@/lib/storage-upload": { validateMediaStoragePathsForUser: (paths) => paths },
    "@/lib/runtime-mode": { shouldShowFallbackContent: () => false },
    "@/lib/mock-store": {},
    "@/lib/fair-application-store": {
      createStoredFairApplication: async (input) => {
        const application = { ...input, id: "22222222-2222-4222-8222-222222222222" };
        createdApplications.push(application);
        return application;
      },
    },
    "@/lib/payment-provider": { createPayment: async () => ({ id: "synthetic-payment" }) },
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const source = readFileSync(new URL(path, projectRoot), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "module", "exports", "process", "fetch", "Date", "Map", "globalThis", js)(
      (id) => {
        if (Object.hasOwn(mocks, id)) return mocks[id];
        if (id.startsWith("@/lib/")) return load(`src/lib/${id.slice(6)}.ts`);
        if (id.startsWith("node:")) return require(id);
        throw new Error(`Unexpected dependency: ${id}`);
      }, module, module.exports, { env: isolatedEnvironment },
      async (url, init) => {
        requests.push({ url, init });
        return fetchImpl ? fetchImpl(url, init) : success();
      }, Clock, ObservedMap, fakeGlobals,
    );
    return module.exports;
  }
  return {
    load, requests, maps, timers, createdApplications,
    reloadTurnstile: () => { cache.delete("src/lib/turnstile.ts"); return load("src/lib/turnstile.ts"); },
    advance: (milliseconds) => { now += milliseconds; },
    now: () => now,
    verify: (...args) => load("src/lib/turnstile.ts").verifyTurnstileToken(...args),
  };
}

function requestFor(route, ip, captchaToken = token, extraHeaders = {}) {
  const body = route === "fair" ? {
    participantName: "Test participant", city: "Краснодар", category: "Test",
    description: "A valid synthetic fair application description.",
    phone: "79951234567", email: "user@example.test", productPhotos: [], captchaToken,
  } : { token: captchaToken };
  return new Request("http://localhost/api/test", {
    method: "POST", headers: { "Content-Type": "application/json", ...(ip ? { "X-Real-IP": ip } : {}), ...extraHeaders },
    body: JSON.stringify(body),
  });
}
const routePath = (route) => route === "fair" ? "src/app/api/fair-applications/route.ts" : "src/app/api/turnstile/verify/route.ts";

test("10,000 rotating addresses cannot grow state or exceed the independent global quota", async () => {
  const harness = makeHarness();
  let admitted = 0;
  for (let index = 0; index < 10_000; index += 1) admitted += Number(await harness.verify(token, testIp(index)));
  assert.equal(admitted, 600);
  assert.equal(harness.requests.length, 600);
  assert.ok(harness.maps[0].peakSize <= 1024);
});

test("per-address 40/minute fairness survives unrelated users and resets exactly at expiry", async () => {
  const harness = makeHarness();
  for (let index = 0; index < 40; index += 1) assert.equal(await harness.verify(token, "203.0.113.10"), true);
  assert.equal(await harness.verify(token, "203.0.113.10"), false);
  assert.equal(await harness.verify(token, "203.0.113.11"), true);
  harness.advance(59_999);
  assert.equal(await harness.verify(token, "203.0.113.10"), false);
  harness.advance(1);
  assert.equal(await harness.verify(token, "203.0.113.10"), true);
});

test("full live map rejects new identities without evicting exhausted identities; expiry frees memory", async () => {
  const harness = makeHarness();
  assert.equal(await harness.verify(token, testIp(0)), true);
  harness.advance(59_999);
  for (let index = 1; index <= 599; index += 1) assert.equal(await harness.verify(token, testIp(index)), true);
  harness.advance(1);
  for (let index = 600; index < 1025; index += 1) assert.equal(await harness.verify(token, testIp(index)), true);
  assert.equal(harness.maps[0].size, 1024);
  for (let index = 2000; index < 2100; index += 1) assert.equal(await harness.verify(token, testIp(index)), false);
  for (let count = 1; count < 40; count += 1) assert.equal(await harness.verify(token, testIp(1)), true);
  assert.equal(await harness.verify(token, testIp(1)), false);
  harness.advance(60_000);
  assert.equal(await harness.verify(token, testIp(2101)), true);
  assert.equal(harness.maps[0].size, 1);
  assert.ok(harness.maps[0].peakSize <= 1024);
});

test("global quota recovers only at its 60-second boundary", async () => {
  const harness = makeHarness();
  for (let index = 0; index < 600; index += 1) assert.equal(await harness.verify(token, testIp(index)), true);
  assert.equal(await harness.verify(token, testIp(600)), false);
  harness.advance(59_999);
  assert.equal(await harness.verify(token, testIp(601)), false);
  harness.advance(1);
  assert.equal(await harness.verify(token, testIp(602)), true);
  assert.equal(harness.maps[0].size, 1);
});

test("provider concurrency is independently capped at 16 and released after completion", async () => {
  const pending = [];
  const harness = makeHarness({ fetchImpl: () => new Promise((resolve) => pending.push(resolve)) });
  const checks = Array.from({ length: 16 }, (_, index) => harness.verify(token, testIp(index)));
  assert.equal(harness.requests.length, 16);
  const rejected = harness.verify(token, testIp(16));
  // Resolve every dispatched request so a broken unlimited implementation also
  // terminates and fails an assertion instead of hanging the test runner.
  pending.splice(0).forEach((resolve) => resolve(success()));
  assert.equal(await rejected, false);
  assert.deepEqual(await Promise.all(checks), Array(16).fill(true));
  assert.equal(harness.requests.length, 16);
  const recovered = harness.verify(token, testIp(17));
  pending.splice(0).forEach((resolve) => resolve(success()));
  assert.equal(await recovered, true);
});

test("the real timeout aborts requests and releases every concurrency slot on failure", async () => {
  let shouldHold = true;
  const harness = makeHarness({ fetchImpl: (_url, init) => shouldHold ? new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("synthetic timeout", "AbortError")), { once: true });
  }) : Promise.resolve(success()) });
  const checks = Array.from({ length: 16 }, (_, index) => harness.verify(token, testIp(index)));
  assert.equal(harness.timers.size, 16);
  for (const { callback, delay } of [...harness.timers.values()]) {
    assert.equal(delay, 5000);
    callback();
  }
  assert.deepEqual(await Promise.all(checks), Array(16).fill(false));
  assert.equal(harness.timers.size, 0);
  shouldHold = false;
  assert.equal(await harness.verify(token, testIp(16)), true);
});

test("provider exceptions do not leak slots, and negative provider results fail closed", async () => {
  let shouldThrow = true;
  const harness = makeHarness({ fetchImpl: async () => {
    if (shouldThrow) throw new Error("synthetic provider failure");
    return { ok: true, json: async () => ({ success: false }) };
  } });
  for (let index = 0; index < 20; index += 1) assert.equal(await harness.verify(token, testIp(index)), false);
  shouldThrow = false;
  assert.equal(await harness.verify(token, testIp(20)), false);
  assert.equal(harness.requests.length, 21);
});

test("missing and malformed production identities fail before allocation or provider I/O", async () => {
  const harness = makeHarness();
  for (const ip of [undefined, "", "not-an-ip", "203.0.113.1,203.0.113.2", "203.0.113.1:80", "[2001:db8::1]", "fe80::1%eth0", {}, 123]) {
    assert.equal(await harness.verify(token, ip), false);
  }
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.maps[0].size, 0);
});

test("canonical IPv6 and IPv4-mapped aliases share the same per-address quota", async () => {
  const harness = makeHarness();
  for (let index = 0; index < 40; index += 1) assert.equal(await harness.verify(token, "2001:DB8:0:0:0:0:0:1"), true);
  assert.equal(await harness.verify(token, "2001:db8::1"), false);
  for (let index = 0; index < 40; index += 1) assert.equal(await harness.verify(token, "203.0.113.9"), true);
  assert.equal(await harness.verify(token, "::ffff:203.0.113.9"), false);
  assert.equal(harness.requests[0].init.body.get("remoteip"), "2001:db8::1");
});

test("invalid token types and oversized raw values are rejected, while the 2048 boundary is accepted", async () => {
  const harness = makeHarness();
  for (const value of [undefined, null, {}, [], true, 123, "", "  ", "x".repeat(2049), ` ${"x".repeat(2048)} `]) {
    assert.equal(await harness.verify(value, "203.0.113.1"), false);
  }
  assert.equal(harness.requests.length, 0);
  assert.equal(await harness.verify("x".repeat(2048), "203.0.113.1"), true);
  assert.equal(await harness.verify(` ${token} `, "203.0.113.1"), true);
  assert.equal(harness.requests[1].init.body.get("response"), token);
});

for (const route of ["verify", "fair"]) {
  test(`${route} route cannot use caller-controlled CF/XFF to rotate the trusted-address quota`, async () => {
    const harness = makeHarness();
    const handler = harness.load(routePath(route));
    for (let index = 0; index < 45; index += 1) {
      const result = await handler.POST(requestFor(route, "203.0.113.10", token, {
        "CF-Connecting-IP": testIp(index), "X-Forwarded-For": testIp(index + 100),
      }));
      assert.equal(result.status, index < 40 ? (route === "fair" ? 201 : 200) : 400);
    }
    assert.equal(harness.requests.length, 40);
    assert.equal(harness.requests[0].init.body.get("remoteip"), "203.0.113.10");
    assert.equal(harness.createdApplications.length, route === "fair" ? 40 : 0);
  });
  test(`${route} route fails closed for absent/malformed trusted IP and untyped tokens`, async () => {
    const harness = makeHarness();
    const handler = harness.load(routePath(route));
    for (const ip of [undefined, "invalid", "203.0.113.1, 203.0.113.2"]) {
      const result = await handler.POST(requestFor(route, ip, token, { "CF-Connecting-IP": "203.0.113.1", "X-Forwarded-For": "203.0.113.1" }));
      assert.equal(result.status, 400);
    }
    for (const value of [null, {}, [], true, 123, "x".repeat(2049)]) {
      const result = await handler.POST(requestFor(route, "203.0.113.1", value));
      assert.equal(result.status, 400);
    }
    assert.equal(harness.requests.length, 0);
    assert.equal(harness.createdApplications.length, 0);
  });
  test(`${route} route rejects invalid token types instead of throwing or calling the provider`, async () => {
    const harness = makeHarness();
    const handler = harness.load(routePath(route));
    for (const value of [null, {}, [], true, 123, "x".repeat(2049)]) {
      assert.equal((await handler.POST(requestFor(route, "203.0.113.1", value))).status, 400);
    }
    assert.equal(harness.requests.length, 0);
    assert.equal(harness.createdApplications.length, 0);
  });
}

test("separately bundled module instances cannot reset the process-wide quota", async () => {
  const harness = makeHarness();
  for (let index = 0; index < 40; index += 1) assert.equal(await harness.verify(token, "203.0.113.12"), true);
  const reloaded = harness.reloadTurnstile();
  assert.equal(await reloaded.verifyTurnstileToken(token, "203.0.113.12"), false);
  assert.equal(harness.maps.length, 1);
});

test("both API routes share the same quota for one real client", async () => {
  const harness = makeHarness();
  const verifyRoute = harness.load(routePath("verify"));
  const fairRoute = harness.load(routePath("fair"));
  for (let index = 0; index < 20; index += 1) assert.equal((await verifyRoute.POST(requestFor("verify", "203.0.113.12"))).status, 200);
  for (let index = 0; index < 20; index += 1) assert.equal((await fairRoute.POST(requestFor("fair", "203.0.113.12"))).status, 201);
  assert.equal((await fairRoute.POST(requestFor("fair", "203.0.113.12"))).status, 400);
});

test("local quiet development tokens retain age checks and a bounded shared missing-IP quota", async () => {
  const harness = makeHarness({ environment: { NODE_ENV: "development" } });
  const quiet = (age) => `quiet:${harness.now() - age}:synthetic-nonce-12345`;
  for (const age of [-1, 399, 7_200_001]) assert.equal(await harness.verify(quiet(age)), false);
  for (let count = 0; count < 37; count += 1) assert.equal(await harness.verify(quiet(400)), true);
  assert.equal(await harness.verify(quiet(400)), false);
  assert.equal(await harness.verify(quiet(400), "203.0.113.8"), true);
  harness.advance(60_000);
  assert.equal(await harness.verify(quiet(400)), true);
  assert.equal(harness.requests.length, 0);
  assert.equal(await makeHarness({ environment: { NODE_ENV: "production" } }).verify(quiet(400), "203.0.113.8"), false);
  assert.equal(await makeHarness().verify(quiet(400)), false);
});

test("FormData rejects file tokens and honeypot submissions without provider I/O", async () => {
  const harness = makeHarness();
  const verifier = harness.load("src/lib/turnstile.ts").verifyTurnstileFormData;
  const fileForm = new FormData();
  fileForm.set("captchaToken", new Blob([token]), "token.txt");
  assert.equal(await verifier(fileForm, "203.0.113.5"), false);
  const honeypot = new FormData();
  honeypot.set("captchaToken", token);
  honeypot.set("captchaWebsite", "spam");
  assert.equal(await verifier(honeypot, "203.0.113.5"), false);
  assert.equal(harness.requests.length, 0);
  honeypot.set("captchaWebsite", "");
  assert.equal(await verifier(honeypot, "203.0.113.5"), true);
});

test("the production ingress overwrites identity and keeps the single Next process loopback-only", () => {
  const caddy = readFileSync(new URL("deploy/Caddyfile.example", projectRoot), "utf8");
  assert.match(caddy, /reverse_proxy\s+127\.0\.0\.1:3000/);
  assert.match(caddy, /header_up\s+X-Real-IP\s+\{remote_host\}/);
  assert.match(caddy, /header_up\s+-CF-Connecting-IP/);
  assert.match(caddy, /header_up\s+X-Forwarded-For\s+\{remote_host\}/);
  const config = require("../ecosystem.config.cjs");
  assert.match(config.apps[0].args, /(?:-H|--hostname)\s+127\.0\.0\.1/);
  assert.equal(config.apps[0].instances, 1);
  assert.equal(config.apps[0].exec_mode, "fork");
});

function loadServerAction(path, actionName, dependencies) {
  const source = readFileSync(new URL(path, projectRoot), "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let actionNode;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === actionName) actionNode = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(actionNode, `Actual server action must exist: ${path}:${actionName}`);
  // Extract the complete real callback, not a hand-written version of its first
  // statements. A CAPTCHA rejection redirects before business/storage side effects.
  const js = ts.transpileModule(actionNode.getText(parsed), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${js}\nreturn ${actionName};`)(...Object.values(dependencies));
}

for (const [path, actionName, returnPath] of [
  ["src/components/listings/ListingPages.tsx", "publishWithoutPaymentAction", "/razmestit/obyavlenie"],
  ["src/app/rabota/vakansii/sozdat/page.tsx", "publishVacancyWithoutPaymentAction", "/rabota/vakansii/sozdat"],
]) {
  test(`${actionName} actually awaits headers and passes canonical trusted identity to CAPTCHA`, async () => {
    const harness = makeHarness();
    const { getTrustedProxyIp } = harness.load("src/lib/trusted-proxy-ip.ts");
    for (const [rawIp, expectedIp] of [["2001:DB8:0:0:0:0:0:1", "2001:db8::1"], [undefined, undefined], ["invalid", undefined]]) {
      const verifications = [];
      let headerReads = 0;
      let resolveHeaders;
      const deferredHeaders = new Promise((resolve) => { resolveHeaders = resolve; });
      const redirected = new Error("synthetic redirect stops the action before storage");
      let redirectHref;
      const action = loadServerAction(path, actionName, {
        headers: () => { headerReads += 1; return deferredHeaders; },
        getTrustedProxyIp,
        verifyTurnstileFormData: async (formData, ip) => { verifications.push({ formData, ip }); return false; },
        TURNSTILE_ERROR_MESSAGE: "Synthetic CAPTCHA rejection",
        redirect: (href) => { redirectHref = href; throw redirected; },
      });
      const formData = new FormData();
      formData.set("captchaToken", token);
      const result = action(formData);
      result.catch(() => {});
      assert.equal(headerReads, 1);
      assert.equal(verifications.length, 0, "CAPTCHA must wait until asynchronous request headers resolve");
      resolveHeaders(new Headers({
        ...(rawIp ? { "X-Real-IP": rawIp } : {}),
        "CF-Connecting-IP": "198.51.100.200", "X-Forwarded-For": "198.51.100.201",
      }));
      await assert.rejects(result, (error) => error === redirected);
      assert.equal(verifications.length, 1);
      assert.equal(verifications[0].formData, formData);
      assert.equal(verifications[0].ip, expectedIp);
      assert.equal(redirectHref, `${returnPath}?admin=1&error=${encodeURIComponent("Synthetic CAPTCHA rejection")}`);
    }
  });
}
