// Real production Next + isolated Chromium. Provider transports are synthetic;
// no real credentials, accounts, external requests or messages are used.
// Build with stale synthetic public SDK settings and empty CAPTCHA/map keys first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { chromium } from "playwright";

test("production legacy login uses response configuration instead of stale build keys", async () => {
  const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`, sdkOrigin = "https://runtime-sdk.example.invalid";
  const env = { PATH: process.env.PATH, NODE_ENV: "production", __NEXT_PROCESSED_ENV: "true", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: sdkOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-runtime-browser-anon",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic-runtime-browser-captcha", NEXT_PUBLIC_2GIS_API_KEY: "synthetic-runtime-browser-map",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-private-service-sentinel", TURNSTILE_SECRET_KEY: "synthetic-private-captcha-sentinel" };
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: new URL("..", import.meta.url), env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "", browser;
  app.stdout.on("data", data => { output = (output + data).slice(-64000); });
  app.stderr.on("data", data => { output = (output + data).slice(-64000); });
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      assert.equal(app.exitCode, null, "owned production process is running");
      let ready = false;
      try { ready = (await fetch(origin + "/api/health", { signal: AbortSignal.timeout(2000) })).ok; } catch { /* Owned process startup only. */ }
      if (ready) break;
      assert.ok(Date.now() < deadline, "owned process starts within deadline");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(), calls = [], foreign = [], errors = [];
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.href === "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit") {
        return route.fulfill({ contentType: "application/javascript", body: `window.turnstile = {
          render(container, options) { container.dataset.fixtureSitekey = options.sitekey;
            queueMicrotask(() => options.callback('synthetic-captcha-token')); return 'fixture'; }, remove() {}
        };` });
      }
      if (url.origin === sdkOrigin && url.pathname === "/auth/v1/token") {
        calls.push({ origin: url.origin, method: request.method(), key: request.headers().apikey });
        return route.fulfill({ status: 400, json: { error: "invalid_grant", error_description: "Invalid login credentials" } });
      }
      if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { foreign.push(url.hostname); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "warning") errors.push(message.text()); });
    const response = await page.goto(origin + "/auth");
    const html = await response.text();
    for (const sentinel of [env.SUPABASE_SERVICE_ROLE_KEY, env.TURNSTILE_SECRET_KEY, "synthetic-stale-build-key"]) {
      assert.equal(html.includes(sentinel), false, "private or stale configuration is not serialized");
    }
    assert.equal(await page.locator('meta[name="blizhniy-auth-backend"]').getAttribute("content"), "legacy");
    assert.equal(await page.locator('meta[name="blizhniy-legacy-url"]').getAttribute("content"), sdkOrigin);
    assert.equal(await page.locator('meta[name="blizhniy-dgis-key"]').getAttribute("content"), env.NEXT_PUBLIC_2GIS_API_KEY);
    await page.getByRole("button", { name: "Вход", exact: true }).click();
    await page.locator('[data-fixture-sitekey="synthetic-runtime-browser-captcha"]').waitFor();
    await page.getByLabel("Email", { exact: true }).fill("synthetic@example.invalid");
    await page.locator('input[autocomplete="current-password"]').fill("Synthetic browser passphrase 2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.getByText("Неверный email или пароль.", { exact: false }).waitFor();
    assert.deepEqual(calls, [{ origin: sdkOrigin, method: "POST", key: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }]);
    assert.deepEqual(foreign, []);
    assert.deepEqual(errors, []);
    assert.equal(output.includes("synthetic-captcha-token"), false);
    await context.close();
  } finally {
    await browser?.close();
    if (app.exitCode === null) { process.kill(-app.pid, "SIGTERM"); await once(app, "exit"); }
  }
});
