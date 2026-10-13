// Real production Next/Chromium, controlled loopback legacy read transport only.
// No Auth mutations, remote DB/provider, production env, user profile or payment.
// Build with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3119 and a synthetic public key.
// NEXT_PUBLIC values are compiled in; a runtime override is not a test transport.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as probeServer } from "node:net";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { chromium } from "playwright";

test("public tariff states render fresh stored prices, unavailable statuses and responsive copy", { timeout: 90000 }, async () => {
  let rows = [], app, browser;
  const rest = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "GET" || !url.pathname.startsWith("/rest/v1/")) {
      response.writeHead(405); response.end(); return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(url.pathname === "/rest/v1/tariffs" ? rows : []));
  });
  const screenshots = await mkdtemp(join(tmpdir(), "blizhniy-tariff-ui-"));
  try {
    rest.listen(3119, "127.0.0.1"); await once(rest, "listening");
    const probe = probeServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: new URL("..", import.meta.url), detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, LANG: "C.UTF-8", NODE_ENV: "production", __NEXT_PROCESSED_ENV: "true", NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${rest.address().port}`, SUPABASE_SERVICE_ROLE_KEY: "synthetic-read-fixture-only",
        NEXT_PUBLIC_SITE_URL: origin },
    });
    let output = "";
    const collect = data => { output = (output+data.toString()).slice(-8000); };
    app.stdout.on("data", collect); app.stderr.on("data", collect);
    const deadline = Date.now()+20000;
    for (;;) {
      assert.equal(app.exitCode, null);
      try { if ((await fetch(`${origin}/tarify`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* Owned startup only. */ }
      assert.ok(Date.now()<deadline, `owned pricing fixture starts within its deadline: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(), errors = [];
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const base = { id: "listing-publication", action: "listing_publication", name: "Тариф тестового контура", price: "0.00", duration_days: 10, active: true };
    rows = [base];
    await page.goto(`${origin}/tarify`);
    const main = page.locator("main");
    assert.match(await main.innerText(), /0 ₽/);
    assert.equal(await main.getByRole("link", { name: "Создать объявление" }).count(), 1);
    rows = [{ ...base, active: false, price: "999.00" }];
    await page.reload();
    assert.equal(await main.getByRole("link", { name: "Создать объявление" }).count(), 0);
    assert.match(await main.getByRole("status").innerText(), /Тариф временно недоступен/);
    assert.doesNotMatch(await main.innerText(), /999 ₽/);
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}`);
      await page.screenshot({ path: join(screenshots, `inactive-${width}.png`), fullPage: true });
    }
    const axe = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
    await page.addScriptTag({ path: axe });
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    })).violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => item.id));
    assert.deepEqual(violations, []);
    rows = [];
    await page.goto(`${origin}/yarmarka-masterov`);
    assert.match(await page.locator("main").innerText(), /Тариф участия: временно недоступен/);
    assert.doesNotMatch(await page.locator("main").innerText(), /1000 ₽/);
    await page.goto(`${origin}/yarmarka-masterov/zayavka`);
    assert.match(await page.locator("main").innerText(), /Войдите, чтобы подать заявку/);
    assert.doesNotMatch(await page.locator("main").innerText(), /1000 ₽/);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ screenshots, renderingOnly: true, remoteTraffic: false }));
  } finally {
    await browser?.close();
    if (app?.exitCode === null) { process.kill(-app.pid, "SIGTERM"); await once(app, "exit"); }
    rest.closeAllConnections(); await new Promise(resolve => rest.close(resolve));
  }
});
