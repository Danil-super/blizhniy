// Browser contract test against the real production build. Account API/CAPTCHA are
// isolated transport fixtures: no remote DB, provider, real account or email is used.
// Build first with NEXT_PUBLIC_TURNSTILE_SITE_KEY=public-browser-fixture-key and
// NEXT_PUBLIC_SUPABASE_URL='' NEXT_PUBLIC_SUPABASE_ANON_KEY=''.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { test } from "node:test";
import { chromium } from "playwright";

const captchaScript = `let sequence = 0; const widgets = new Map(); window.turnstile = {
  render(container, options) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = 'Fixture: expire CAPTCHA'; button.onclick = () => options['expired-callback']();
    container.appendChild(button); queueMicrotask(() => options.callback('fixture-captcha'));
    const id = 'fixture-widget-' + ++sequence; widgets.set(id, container); return id;
  }, remove(id) { widgets.get(id)?.replaceChildren(); widgets.delete(id); }
};`;
const password = "  Synthetic browser passphrase 2026!  ";
const user = (email) => ({ id: email.startsWith("second") ? "22345678-1234-4321-8765-123456789abc" : "12345678-1234-4321-8765-123456789abc", email, role: "user", isBlocked: false });

test("primary account browser forms use the new cookie API without remote traffic", { timeout: 120000 }, async suite => {
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const env = { PATH: process.env.PATH, LANG: "C.UTF-8", NODE_ENV: "production", __NEXT_PROCESSED_ENV: "true", NEXT_TELEMETRY_DISABLED: "1",
    BLIZHNIY_AUTH_MODE: "postgres", BLIZHNIY_AUTH_ORIGIN: "https://xn----9sbphbgks4a4a.xn--p1ai",
    BLIZHNIY_DB_HOST: "17e86f80f26733d39ef4b84d.twc1.net", BLIZHNIY_DB_PORT: "5432", BLIZHNIY_DB_NAME: "default_db",
    BLIZHNIY_DB_USER: "blizhniy_runtime", BLIZHNIY_DB_PASSWORD: "synthetic-ui-db-password", BLIZHNIY_DB_SSL_MODE: "verify-full",
    BLIZHNIY_DB_CA_FILE: "/not-read-by-ui/root.crt", BLIZHNIY_AUTH_MAIL_KEY_FILE: "/not-read-by-ui/mail-key.bin",
    BLIZHNIY_AUTH_RATE_SECRET: "synthetic-ui-only-rate-secret-not-used-by-api",
    BLIZHNIY_MAIL_MODE: "timeweb", BLIZHNIY_SMTP_USER: "notifications@ближний-ру.рф", BLIZHNIY_SMTP_PASSWORD: "synthetic-ui-smtp-password",
    TURNSTILE_SECRET_KEY: "synthetic-ui-captcha-secret", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: new URL("..", import.meta.url), env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "", browser;
  app.stdout.on("data", data => { output = (output + data).slice(-64000); });
  app.stderr.on("data", data => { output = (output + data).slice(-64000); });
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      assert.equal(app.exitCode, null, "owned Next production process is running");
      try {
        const response = await fetch(`${origin}/auth/register`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          assert.equal(response.headers.get("referrer-policy"), "no-referrer");
          const html = await response.text();
          for (const secret of [env.BLIZHNIY_DB_PASSWORD, env.BLIZHNIY_AUTH_RATE_SECRET, env.BLIZHNIY_SMTP_PASSWORD, env.TURNSTILE_SECRET_KEY, env.BLIZHNIY_AUTH_MAIL_KEY_FILE]) assert.equal(html.includes(secret), false, "server config is not serialized");
          break;
        }
      } catch { /* Wait for only this owned process. */ }
      assert.ok(Date.now() < deadline, "production fixture starts within deadline");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true });
    const run = (name, fn) => suite.test(name, async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const calls = [], foreign = [], errors = [];
      const state = { active: null, override: null };
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.href === "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit") return route.fulfill({ contentType: "application/javascript", body: captchaScript });
        if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { foreign.push(url.hostname); return route.abort(); }
        if (!url.pathname.startsWith("/api/account/")) return route.continue();
        const action = url.pathname.split("/").at(-1), body = request.postDataJSON();
        assert.equal(request.method(), "POST"); assert.equal(request.headers()["x-blizhniy-request"], "1");
        assert.equal(url.search, ""); calls.push({ action, body });
        if (state.override) return state.override(route, action, body);
        if (action === "session") return route.fulfill({ status: state.active ? 200 : 401, json: state.active ? { user: state.active } : { error: { code: "UNAUTHENTICATED" } } });
        if (action === "login") { state.active = user(body.email); return route.fulfill({ json: { status: "authenticated", user: state.active } }); }
        if (action === "logout") { state.active = null; return route.fulfill({ json: { status: "logged_out" } }); }
        return route.fulfill({ status: ["register", "resend", "recover"].includes(action) ? 202 : 200,
          json: { status: action === "confirm" ? "confirmed" : action === "reset" ? "password_reset" : "accepted" } });
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      context.on("page", item => item.on("pageerror", () => errors.push("pageerror")));
      page.on("pageerror", () => errors.push("pageerror"));
      try { await fn({ page, context, calls, state }); assert.deepEqual(foreign, []); assert.deepEqual(errors, []); }
      finally { await context.close(); }
    });
    const login = async (page, email = "owner@example.invalid") => {
      await page.goto(`${origin}/auth`);
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await page.getByText(email, { exact: true }).waitFor();
    };
    await run("registration validates repeated password, sends legal versions and CAPTCHA, and resend uses the smaller contract", async ({ page, calls }) => {
      await page.goto(`${origin}/auth/register`);
      await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByLabel("Повторите пароль", { exact: true }).fill("A different synthetic passphrase!");
      await page.getByRole("checkbox").nth(0).check(); await page.getByRole("checkbox").nth(1).check();
      await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Пароли не совпадают" }).waitFor(); assert.equal(calls.length, 0);
      await page.getByLabel("Повторите пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "мы отправим письмо" }).waitFor();
      assert.deepEqual(Object.keys(calls[0].body).sort(), ["email", "password", "acceptedAgreement", "acknowledgedPrivacy", "agreementVersion", "privacyVersion", "captchaToken"].sort());
      assert.equal(calls[0].body.password, password); assert.equal(calls[0].body.captchaToken, "fixture-captcha");
      await page.getByRole("button", { name: "Повторить письмо", exact: true }).click();
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Отправить повторное письмо", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "мы отправим письмо" }).waitFor();
      assert.deepEqual(calls[1], { action: "resend", body: { email: "owner@example.invalid", password, captchaToken: "fixture-captcha" } });
    });
    await run("confirmation removes a fragment without a GET mutation and rejects query-only links", async ({ page, calls }) => {
      await page.goto(`${origin}/auth/confirm#token=${"a".repeat(64)}`);
      await page.getByRole("button", { name: "Подтвердить email", exact: true }).waitFor();
      assert.equal(page.url(), `${origin}/auth/confirm`); assert.equal(calls.length, 0);
      await page.getByRole("button", { name: "Подтвердить email", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Email подтверждён" }).waitFor();
      assert.deepEqual(calls, [{ action: "confirm", body: { token: "a".repeat(64) } }]);
      await page.goto(`${origin}/auth/confirm?token=${"b".repeat(64)}`);
      await page.getByRole("alert").filter({ hasText: "Ссылка недействительна" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Подтвердить email", exact: true }).count(), 0);
      assert.equal(calls.length, 1);
    });
    await run("cookie-account login, cross-tab logout and unavailable commits never leave an old identity visible", async ({ page, context, calls, state }) => {
      await login(page);
      assert.equal(calls.find(item => item.action === "login").body.captchaToken, "fixture-captcha");
      const second = await context.newPage(); await second.goto(`${origin}/auth`);
      await second.getByText("owner@example.invalid", { exact: true }).waitFor();
      await second.getByRole("button", { name: "Выйти", exact: true }).click();
      await page.getByLabel("Email", { exact: true }).waitFor();
      assert.equal(await page.getByText("owner@example.invalid", { exact: true }).count(), 0);
      state.override = route => route.abort();
      await page.getByLabel("Email", { exact: true }).fill("second@example.invalid");
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "успешный вход или выход не подтверждён" }).waitFor();
      assert.equal(await page.getByText("second@example.invalid", { exact: true }).count(), 0);
    });
    await run("recovery and reset send only their own contracts; CAPTCHA expiry disables submission", async ({ page, calls }) => {
      await page.goto(`${origin}/auth/recover`);
      await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
      const recover = page.getByRole("button", { name: "Отправить письмо восстановления", exact: true });
      await recover.waitFor(); await page.getByRole("button", { name: "Fixture: expire CAPTCHA" }).click();
      assert.equal(await recover.isDisabled(), true); assert.equal(calls.length, 0);
      await page.reload(); await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
      await recover.click(); await page.getByRole("status").filter({ hasText: "Если аккаунт подтверждён" }).waitFor();
      assert.deepEqual(calls[0], { action: "recover", body: { email: "owner@example.invalid", captchaToken: "fixture-captcha" } });
      await page.goto(`${origin}/auth/reset#token=${"c".repeat(64)}`);
      await page.getByLabel("Новый пароль", { exact: true }).fill(password);
      assert.equal(page.url(), `${origin}/auth/reset`);
      await page.getByLabel("Повторите пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Сохранить новый пароль", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Пароль изменён" }).waitFor();
      assert.deepEqual(calls[1], { action: "reset", body: { token: "c".repeat(64), password, captchaToken: "fixture-captcha" } });
      assert.equal(await page.locator('input[type="password"]').count(), 0);
    });
    await run("reset ignores a late response after navigating to a different fragment", async ({ page, calls, state }) => {
      let release, finished;
      const held = new Promise(resolve => { release = resolve; });
      const delivered = new Promise(resolve => { finished = resolve; });
      state.override = async route => { await held; try { await route.fulfill({ json: { status: "password_reset" } }); } finally { finished(); } };
      await page.goto(`${origin}/auth/reset#token=${"d".repeat(64)}`);
      await page.getByLabel("Новый пароль", { exact: true }).fill(password); await page.getByLabel("Повторите пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Сохранить новый пароль", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Обрабатываем" }).waitFor();
      try {
        await page.goto(`${origin}/auth/reset#token=${"e".repeat(64)}`);
        await page.getByLabel("Новый пароль", { exact: true }).waitFor(); release(); await delivered;
        await page.getByRole("button", { name: "Сохранить новый пароль", exact: true }).waitFor();
        assert.equal(await page.getByLabel("Новый пароль", { exact: true }).inputValue(), "");
        assert.equal(await page.getByRole("status").filter({ hasText: "Пароль изменён" }).count(), 0);
        assert.equal(calls.length, 1);
      } finally { release(); }
    });
    await run("all account screens fit mobile and desktop; keyboard labels and no-referrer remain present", async ({ page }) => {
      const axe = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
      for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of ["/auth", "/auth/register", "/auth/recover", `/auth/reset#token=${"f".repeat(64)}`, `/auth/confirm#token=${"f".repeat(64)}`]) {
          const response = await page.goto(origin + path);
          assert.equal(response.headers()["referrer-policy"], "no-referrer");
          await page.locator("main h1").waitFor();
          if (path.includes("/confirm")) await page.getByRole("button", { name: "Подтвердить email", exact: true }).waitFor();
          else if (path.includes("/reset")) await page.getByLabel("Новый пароль", { exact: true }).waitFor();
          else await page.getByLabel("Email", { exact: true }).waitFor();
          assert.equal(await page.locator("main h1").count(), 1);
          const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
          assert.ok(dimensions.content <= dimensions.viewport, `no overflow at ${width}, ${path.split("#")[0]}`);
          if (width === 320 || width === 1440) {
            await page.addScriptTag({ content: axe });
            const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), {
              runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
            })).violations.map(item => ({ id: item.id, impact: item.impact })));
            assert.deepEqual(violations, [], `main-region axe at ${width}, ${path.split("#")[0]}`);
          }
        }
      }
      await page.goto(origin + "/auth/register"); await page.keyboard.press("Tab");
      assert.ok(await page.locator(":focus").count());
      await page.screenshot({ path: "/tmp/blizhniy-production-registration.png", fullPage: true });
    });
    assert.equal(output.includes("fixture-captcha"), false);
  } finally {
    await browser?.close();
    if (app.exitCode === null) { process.kill(-app.pid, "SIGTERM"); await once(app, "exit"); }
  }
});
