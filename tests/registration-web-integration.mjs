import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { chromium } from "playwright";

// This fixture has no SMTP forwarder, external credentials or public inbox API.
export async function testRegistrationWeb(suite, db, dbEnv) {
  const secret = randomBytes(32).toString("hex");
  const authorization = `Bearer ${createHmac("sha256", secret).update("local-mail-capture").digest("hex")}`;
  const messages = [];
  const mailServer = createServer(async (request, response) => {
    if (request.url !== "/messages" || request.method !== "POST" || request.headers.authorization !== authorization) {
      response.writeHead(403).end(); return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 4096) throw new Error("Capture body limit");
      }
      const { mail } = JSON.parse(body);
      if (mail) {
        assert.match(mail.to, /\.invalid$/);
        assert.match(mail.text, /\/auth\/local\/confirm#token=[a-f0-9]{64}/);
        messages.push(mail);
      }
      response.writeHead(204).end();
    } catch { response.writeHead(400).end(); }
  });
  mailServer.listen(0, "127.0.0.1");
  await once(mailServer, "listening");
  const probe = netServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const processEnv = { PATH: process.env.PATH, LANG: "C.UTF-8", ...dbEnv, NODE_ENV: "development",
    __NEXT_PROCESSED_ENV: "true", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SITE_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
    ENABLE_DEMO_CONTENT: "false", NEXT_PUBLIC_ENABLE_DEMO_CONTENT: "false", ENABLE_DEMO_ADMIN_BYPASS: "false", PAYMENT_PROVIDER: "mock",
    BLIZHNIY_AUTH_MODE: "local", BLIZHNIY_AUTH_ORIGIN: origin, BLIZHNIY_AUTH_RATE_SECRET: secret,
    BLIZHNIY_LOCAL_MAIL_URL: `http://127.0.0.1:${mailServer.address().port}/messages` };
  let output = "";
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: new URL("..", import.meta.url), env: processEnv, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  const capture = (chunk) => { output = (output + chunk.toString()).slice(-128000); };
  app.stdout.on("data", capture); app.stderr.on("data", capture);
  const password = "Synthetic browser passphrase 2026!";
  const signup = { email: "http-first@example.invalid", password, acceptedAgreement: true, acknowledgedPrivacy: true,
    agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy };
  const post = async (action, body, extraHeaders = {}, query = "") => {
    const response = await fetch(`${origin}/api/account/${action}${query}`, { method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Origin: origin, "X-Blizhniy-Request": "1", ...extraHeaders }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  let browser;
  try {
    const deadline = Date.now() + 60000;
    for (;;) {
      assert.equal(app.exitCode, null, "local app remains running");
      try {
        const response = await fetch(`${origin}/api/account/unknown`, { signal: AbortSignal.timeout(3000) });
        if (response.status === 404) break;
      } catch { /* Wait only for this newly spawned app. */ }
      assert.ok(Date.now() < deadline, "local app started before deadline");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await suite.test("actual Next HTTP signup hides the mail token; duplicate cannot replace credentials", async () => {
      const response = await post("register", signup);
      assert.equal(response.status, 202, JSON.stringify(response.body));
      assert.deepEqual(response.body, { status: "accepted" });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(messages.length, 1);
      assert.equal((await post("register", { ...signup, password: "Attacker synthetic passphrase 2026!" })).status, 202);
      assert.equal(messages.length, 1);
      assert.equal((await db.query("select role, email_verified_at from app.users where email=$1", [signup.email])).rows[0].email_verified_at, null);
    });
    await suite.test("actual HTTP refuses CSRF, privilege injection, real recipients and URL token without writing accounts", async () => {
      assert.equal((await post("register", signup, { Origin: "https://foreign.invalid" })).status, 403);
      assert.equal((await post("register", signup, { "X-Blizhniy-Request": "" })).status, 403);
      assert.equal((await post("register", { ...signup, email: "no-write@example.invalid", role: "admin" })).status, 422);
      assert.equal((await post("register", { ...signup, email: "real@example.ru" })).status, 422);
      assert.equal((await post("confirm", { token: "a".repeat(64) }, {}, "?token=must-not-be-used")).status, 400);
      assert.equal((await db.query("select count(*)::integer as count from app.users where email in ('no-write@example.invalid','real@example.ru')")).rows[0].count, 0);
    });
    await suite.test("mail scanner GET does not confirm; explicit POST is single-use and cannot create a session", async () => {
      const token = messages[0].text.match(/#token=([a-f0-9]{64})/)[1];
      assert.equal((await fetch(`${origin}/api/account/confirm`)).status, 405);
      assert.equal((await post("confirm", { token })).status, 200);
      assert.equal((await post("confirm", { token })).status, 400);
      const user = (await db.query("select id, email_verified_at from app.users where email=$1", [signup.email])).rows[0];
      assert.ok(user.email_verified_at);
      assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [user.id])).rows[0].count, 0);
      assert.equal(output.includes(token), false, "application logs never contain the token");
    });
    await suite.test("real browser signup → local captured mail → explicit confirmation → replay, with only same-origin requests", async () => {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const foreignRequests = [];
      const consoleErrors = [];
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
          foreignRequests.push(url.hostname); return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on("pageerror", () => consoleErrors.push({ type: "pageerror" }));
      page.on("console", (message) => { if (["error", "warning"].includes(message.type())) consoleErrors.push({ type: message.type(), text: message.text() }); });
      await page.goto(`${origin}/auth/local`);
      await page.getByLabel("Email", { exact: true }).fill("browser-new@example.invalid");
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByLabel("Повторите пароль", { exact: true }).fill(password);
      await page.getByLabel(/Принимаю пользовательское соглашение/).check();
      await page.getByLabel(/Ознакомлен с политикой/).check();
      await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Если запрос подходит" }).waitFor();
      const captured = messages.find((mail) => mail.to === "browser-new@example.invalid");
      assert.ok(captured, "synthetic message captured locally");
      const link = captured.text.match(/http:\/\/127\.0\.0\.1:\d+\/auth\/local\/confirm#token=[a-f0-9]{64}/)[0];
      assert.ok(link.startsWith(origin + "/auth/local/confirm#"));
      const token = new URL(link).hash.slice(7);
      await page.goto(link);
      const confirm = page.getByRole("button", { name: "Подтвердить email", exact: true });
      await confirm.waitFor();
      assert.equal(page.url(), `${origin}/auth/local/confirm`, "token removed from browser history URL");
      assert.equal((await db.query("select email_verified_at from app.users where email='browser-new@example.invalid'")).rows[0].email_verified_at, null, "page load/scanner cannot confirm");
      await confirm.click();
      await page.getByRole("status").filter({ hasText: "Email подтверждён" }).waitFor();
      await page.screenshot({ path: "/tmp/blizhniy-registration-confirmed.png", fullPage: true });
      const user = (await db.query("select id, email_verified_at from app.users where email='browser-new@example.invalid'")).rows[0];
      assert.ok(user.email_verified_at);
      assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [user.id])).rows[0].count, 0);
      assert.deepEqual(consoleErrors, [], "successful flow has a clean browser console");
      await page.goto(link);
      await page.getByRole("button", { name: "Подтвердить email", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Ссылка недействительна" }).waitFor();
      assert.equal(output.includes(token), false);
      assert.deepEqual(foreignRequests, []);
      // Negative HTTP replay is intentional; Chromium emits a corresponding 400 resource error.
      assert.ok(consoleErrors.every((entry) => entry.type === "error" && /server responded with a status of 400/.test(entry.text)), "only the deliberate replay 400 resource error is allowed");
      await context.close();
    });
    await suite.test("a confirmation response cannot overwrite a newer link opened in the same tab", async () => {
      assert.equal((await post("register", { ...signup, email: "browser-race@example.invalid" })).status, 202);
      const captured = messages.find((mail) => mail.to === "browser-race@example.invalid");
      const link = captured.text.match(/http:\/\/127\.0\.0\.1:\d+\/auth\/local\/confirm#token=[a-f0-9]{64}/)[0];
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      let release;
      let started;
      const held = new Promise((resolve) => { release = resolve; });
      const received = new Promise((resolve) => { started = resolve; });
      await page.route("**/api/account/confirm", async (route) => {
        const response = await route.fetch();
        started();
        await held;
        await route.fulfill({ response });
      });
      try {
        await page.goto(link);
        await page.getByRole("button", { name: "Подтвердить email", exact: true }).click();
        await received;
        await page.evaluate(() => { window.location.hash = "token=" + "f".repeat(64); });
        await page.waitForFunction(() => window.location.hash === "");
        release();
        await page.getByRole("button", { name: "Подтвердить email", exact: true }).waitFor();
        await page.waitForFunction(() => document.querySelector('button[type="button"]')?.disabled === false);
        assert.equal(await page.getByRole("status").filter({ hasText: "Email подтверждён" }).count(), 0, "old response is not confirmation of the new link");
        assert.equal(await page.getByRole("button", { name: "Подтвердить email", exact: true }).count(), 1);
      } finally { release(); await context.close(); }
    });
    await suite.test("registration is labelled, keyboard-accessible and fits 320/768/1024/1440 screens", async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/auth/local`);
        await page.getByLabel("Email", { exact: true }).waitFor();
        assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
        assert.match(await page.locator("main").ariaSnapshot(), /textbox "Email"/);
        assert.equal(await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(8, 117, 209)", "primary action uses the existing brand-blue token, not white text on a transparent background");
        assert.equal(await page.locator('a[href="/legal/agreement"]').count() >= 1, true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.getByLabel("Email", { exact: true }).focus();
        await page.keyboard.press("Tab");
        assert.equal(await page.getByLabel("Пароль", { exact: true }).evaluate((element) => element === document.activeElement), true);
        const primary = page.getByRole("button", { name: "Зарегистрироваться", exact: true });
        await primary.scrollIntoViewIfNeeded();
        assert.equal(await primary.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return box.height >= 44 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        }), true, "primary touch target is not obscured by fixed mobile navigation");
        if (width === 320 || width === 1440) await page.screenshot({ path: `/tmp/blizhniy-registration-${width}.png`, fullPage: true });
      }
      await context.close();
    });
    assert.equal(output.includes(signup.email), false, "no email in app logs");
    assert.equal(output.includes(password), false, "no password in app logs");
  } finally {
    if (browser) await browser.close();
    if (app.exitCode === null) {
      process.kill(-app.pid, "SIGTERM");
      await Promise.race([once(app, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (app.exitCode === null && app.signalCode === null) process.kill(-app.pid, "SIGKILL");
    }
    mailServer.closeAllConnections();
    await new Promise((resolve) => mailServer.close(resolve));
  }
}
