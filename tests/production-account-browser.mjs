// Browser contract test against the real production build. Account API/CAPTCHA are
// isolated transport fixtures: no remote DB, provider, real account or email is used.
// Public CAPTCHA configuration is supplied at server startup, not at build time.
// Build first with no NEXT_PUBLIC_TURNSTILE_SITE_KEY and
// NEXT_PUBLIC_SUPABASE_URL=https://legacy-fixture.example.invalid and
// NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-leftover-anon-key (no real legacy credentials).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import { chromium } from "playwright";
import { createDefaultCabinetProfile } from "../src/lib/cabinet-profile.ts";
import { createHash } from "node:crypto";

// Opaque transport revision only; real canonical hashing/row locking are tested with PG.
const fixtureRevision = profile => profile ? createHash("sha256").update(JSON.stringify(profile)).digest("hex") : null;

const captchaScript = `let sequence = 0; const widgets = new Map(); window.turnstile = {
  render(container, options) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = 'Fixture: expire CAPTCHA'; button.dataset.fixtureSitekey = options.sitekey;
    button.onclick = () => options['expired-callback']();
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
    BLIZHNIY_DB_HOST: "17e86f80f26733d39ef4b84d.twc1.net", BLIZHNIY_DB_PORT: "5432", BLIZHNIY_DB_NAME: "blizhniy_prod",
    BLIZHNIY_DB_USER: "blizhniy_runtime", BLIZHNIY_DB_PASSWORD: "synthetic-ui-db-password", BLIZHNIY_DB_SSL_MODE: "verify-full",
    BLIZHNIY_DB_CA_FILE: "/not-read-by-ui/root.crt", BLIZHNIY_AUTH_MAIL_KEY_FILE: "/not-read-by-ui/mail-key.bin",
    BLIZHNIY_AUTH_RATE_SECRET: "synthetic-ui-only-rate-secret-not-used-by-api",
    BLIZHNIY_MAIL_MODE: "timeweb", BLIZHNIY_SMTP_USER: "notifications@ближний-ру.рф", BLIZHNIY_SMTP_PASSWORD: "synthetic-ui-smtp-password",
    TURNSTILE_SECRET_KEY: "synthetic-ui-captcha-secret", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic-runtime-only-public-site-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://legacy-fixture.example.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-leftover-anon-key", SUPABASE_SERVICE_ROLE_KEY: "synthetic-leftover-service-key" };
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
    const initialHtml = await (await fetch(`${origin}/auth/register`, { signal: AbortSignal.timeout(2000) })).text();
    assert.ok(initialHtml.includes('<meta name="blizhniy-turnstile-site-key" content="synthetic-runtime-only-public-site-key"'),
      "public site key is serialized from runtime configuration into the response head");
    await suite.test("primary mode rejects legacy cabinet reads/writes with both old Bearer and new cookie despite leftover legacy keys", async () => {
      const headers = { authorization: "Bearer synthetic-old-session", cookie: `__Host-blizhniy_session=${"a".repeat(64)}` };
      const state = await fetch(`${origin}/api/auth/state`, { headers, signal: AbortSignal.timeout(2000) });
      assert.equal(state.status, 200);
      assert.deepEqual(await state.json(), { state: "signed-out" });
      for (const method of ["GET", "PUT"]) {
        const response = await fetch(`${origin}/api/cabinet/profile`, { method, headers: { ...headers, "content-type": "application/json" },
          ...(method === "PUT" ? { body: JSON.stringify({ name: "Synthetic attempted crossover" }) } : {}), signal: AbortSignal.timeout(2000) });
        assert.equal(response.status, 503);
        assert.match(response.headers.get("cache-control"), /no-store/);
        assert.deepEqual(await response.json(), { error: "Профиль временно недоступен." });
      }
    });
    await suite.test("a live process with invalid PostgreSQL configuration refuses database readiness without leaking details", async () => {
      const health = await fetch(origin+"/api/health");
      assert.equal(health.status, 200);
      const readiness = await fetch(origin+"/api/ready");
      assert.equal(readiness.status, 503);
      assert.equal(readiness.headers.get("cache-control"), "no-store");
      assert.deepEqual(await readiness.json(), { ok: false, service: "blizhniy" });
    });
    await suite.test("separate PostgreSQL profile route rejects old bearer authority and invalid writes before pool/key access", async () => {
      const headers = { host: new URL(env.BLIZHNIY_AUTH_ORIGIN).host, origin: env.BLIZHNIY_AUTH_ORIGIN,
        "x-blizhniy-request": "1", "x-real-ip": "192.0.2.44", "content-type": "application/json",
        authorization: "Bearer synthetic-old-session" };
      const owner = "12345678-1234-4321-8765-123456789abc";
      for (const [method, body, status, code] of [["GET", null, 405, "METHOD_NOT_ALLOWED"],
        ["POST", { expectedOwnerId: owner }, 401, "UNAUTHENTICATED"],
        ["PUT", { expectedOwnerId: owner, profile: { role: "admin" } }, 422, "INVALID_INPUT"]]) {
        // Node fetch ignores a supplied Host. This owned transport must exercise the exact ingress boundary.
        const response = await new Promise((resolve, reject) => {
          const outgoing = httpRequest(`${origin}/api/account/profile`, { method, headers }, incoming => {
            let text = "";
            incoming.setEncoding("utf8");
            incoming.on("data", chunk => {
              text += chunk;
              if (text.length > 16384) incoming.destroy(new Error("Owned profile response exceeds fixture cap"));
            });
            incoming.on("error", reject);
            incoming.on("end", () => resolve({ status: incoming.statusCode,
              headers: { get: key => incoming.headers[key] ?? null }, json: async () => JSON.parse(text) }));
          });
          outgoing.on("error", reject);
          outgoing.setTimeout(2000, () => outgoing.destroy(new Error("Owned profile request timed out")));
          outgoing.end(body ? JSON.stringify(body) : undefined);
        });
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { error: { code } });
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      }
    });
    browser = await chromium.launch({ headless: true });
    const run = (name, fn) => suite.test(name, async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const calls = [], sessionReads = [], foreign = [], errors = [];
      const state = { active: null, override: null, sessionReads, profiles: new Map(), profileRequests: [], profileOverride: null };
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.href === "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit") return route.fulfill({ contentType: "application/javascript", body: captchaScript });
        if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { foreign.push(url.hostname); return route.abort(); }
        if (!url.pathname.startsWith("/api/account/")) return route.continue();
        const action = url.pathname.split("/").at(-1), body = request.postDataJSON();
        if (action === "profile") {
          assert.ok(["POST", "PUT"].includes(request.method()));
          assert.equal(request.headers()["authorization"], undefined);
          assert.equal(request.headers()["x-blizhniy-request"], "1");
          state.profileRequests.push({ method: request.method(), body });
          if (state.profileOverride) return state.profileOverride(route, body);
          if (!state.active) return route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } });
          if (body.expectedOwnerId !== state.active.id) return route.fulfill({ status: 409, json: { error: { code: "SESSION_CHANGED" } } });
          const stored = state.profiles.get(state.active.id) ?? createDefaultCabinetProfile({ name: "Синтетический", email: state.active.email });
          if (request.method() === "PUT") {
            if (body.expectedRevision !== fixtureRevision(state.profiles.get(state.active.id))) {
              return route.fulfill({ status: 409, json: { error: { code: "PROFILE_CHANGED" } } });
            }
            const saved = { ...body.profile, email: state.active.email, phoneVerified: false, verifiedPhone: "" };
            state.profiles.set(state.active.id, saved);
            return route.fulfill({ json: { profile: saved, revision: fixtureRevision(saved) } });
          }
          return route.fulfill({ json: { exists: state.profiles.has(state.active.id), profile: stored, revision: fixtureRevision(state.profiles.get(state.active.id)) } });
        }
        assert.equal(request.method(), "POST"); assert.equal(request.headers()["x-blizhniy-request"], "1");
        assert.equal(url.search, ""); calls.push({ action, body });
        // Credential assertions stay separate from the new shared session reads; neither is ignored.
        if (action === "session") { assert.deepEqual(body, {}); sessionReads.push(calls.pop()); }
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
    const login = async (page, email = "owner@example.invalid", switchAccount = false) => {
      await page.goto(`${origin}/auth`);
      if (switchAccount) await page.getByRole("button", { name: "Сменить аккаунт", exact: true }).click();
      await page.locator('[data-fixture-sitekey="synthetic-runtime-only-public-site-key"]').waitFor();
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await page.getByText(email, { exact: true }).waitFor();
    };
    await run("existing cabinet settings save through owner-scoped cookie profile API without legacy requests", async ({ page, state }) => {
      const legacy = [];
      page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/cabinet/")) legacy.push(request.url()); });
      await login(page); await page.goto(`${origin}/cabinet`);
      await page.getByRole("heading", { name: "Синтетический", exact: true }).waitFor();
      await page.getByRole("button", { name: "Настройки", exact: true }).click();
      await page.getByLabel("Имя", { exact: true }).fill("Изменённый");
      await page.getByLabel("Брони и заказы", { exact: true }).uncheck();
      assert.equal(await page.getByLabel("Email", { exact: true }).getAttribute("readonly"), "");
      await page.getByRole("button", { name: "Сохранить настройки", exact: true }).click();
      await page.getByText("Настройки сохранены.", { exact: true }).waitFor();
      assert.equal(state.profileRequests.filter(row => row.method === "PUT").length, 1);
      assert.equal(state.profiles.get(state.active.id).name, "Изменённый");
      assert.equal(state.profiles.get(state.active.id).notifyBookings, false);
      assert.deepEqual(legacy, []);
      await page.reload();
      await page.getByRole("heading", { name: "Изменённый", exact: true }).waitFor();
      await page.setViewportSize({ width: 320, height: 900 });
      await page.getByRole("button", { name: "Настройки", exact: true }).click();
      const axe = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      })).violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })));
      assert.deepEqual(violations, [], "existing primary profile settings meet the main-region axe bar");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: "/tmp/blizhniy-cookie-profile-settings-320.png", fullPage: true });
      for (const width of [768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `profile settings fit ${width}px`);
      }
      await page.getByRole("button", { name: "Сменить пароль", exact: true }).click();
      await page.getByRole("heading", { name: "Восстановление доступа", exact: true }).waitFor();
    });
    await run("organization editor persists on the existing cabinet route using the same cookie-owned profile", async ({ page, state }) => {
      await login(page); await page.goto(`${origin}/cabinet/organization`);
      await page.getByLabel("Название организации или ИП", { exact: true }).fill("Синтетическая организация");
      await page.getByLabel("ИНН", { exact: true }).fill("1234567890");
      await page.getByRole("button", { name: "Сохранить профиль организации", exact: true }).click();
      await page.getByText("Профиль организации сохранен.", { exact: true }).waitFor();
      assert.equal(state.profiles.get(state.active.id).organizationName, "Синтетическая организация");
      assert.equal(state.profileRequests.filter(row => row.method === "PUT").length, 1);
      await page.reload();
      assert.equal(await page.getByLabel("Название организации или ИП", { exact: true }).inputValue(), "Синтетическая организация");
    });
    await run("two tabs preserve a conflicting draft and never silently overwrite the saved organization", async ({ page, context, state }) => {
      await login(page);
      state.profiles.set(state.active.id, createDefaultCabinetProfile({ name: "Синтетический", email: state.active.email }));
      await page.goto(`${origin}/cabinet/organization`);
      const other = await context.newPage();
      await other.goto(`${origin}/cabinet/organization`);
      await page.getByLabel("Название организации или ИП", { exact: true }).fill("Сохранено в первой вкладке");
      await other.getByLabel("Название организации или ИП", { exact: true }).fill("Несохранённый текст второй вкладки");
      await page.getByRole("button", { name: "Сохранить профиль организации", exact: true }).click();
      await page.getByText("Профиль организации сохранен.", { exact: true }).waitFor();
      await other.getByRole("button", { name: "Сохранить профиль организации", exact: true }).click();
      await other.getByRole("alert").filter({ hasText: "Профиль изменён в другой вкладке" }).first().waitFor();
      assert.equal(await other.getByLabel("Название организации или ИП", { exact: true }).inputValue(), "Несохранённый текст второй вкладки");
      assert.equal(state.profiles.get(state.active.id).organizationName, "Сохранено в первой вкладке");
      const writes = () => state.profileRequests.filter(row => row.method === "PUT");
      assert.equal(writes().length, 2);
      assert.equal(writes()[0].body.expectedRevision, writes()[1].body.expectedRevision);
      for (const width of [320, 768, 1024, 1440]) {
        await other.setViewportSize({ width, height: 900 });
        assert.equal(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `conflict copy fits ${width}px`);
      }
      await other.screenshot({ path: "/tmp/blizhniy-profile-conflict-1440.png", fullPage: true });
      const axe = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
      await other.addScriptTag({ content: axe });
      const violations = await other.evaluate(async () => (await window.axe.run(document.querySelector('[role="alert"]'), {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      })).violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => item.id));
      assert.deepEqual(violations, []);
      await other.getByRole("button", { name: "Сохранить профиль организации", exact: true }).click();
      assert.equal(writes().length, 2, "conflict cannot retry even on another click");
      await other.getByRole("button", { name: "Обновить профиль", exact: true }).first().focus();
      await other.keyboard.press("Enter");
      await other.getByLabel("Название организации или ИП", { exact: true }).waitFor();
      await other.waitForFunction(() => [...document.querySelectorAll("input")].some(input => input.value === "Сохранено в первой вкладке"));
      assert.equal(await other.getByLabel("Название организации или ИП", { exact: true }).inputValue(), "Сохранено в первой вкладке");
      assert.equal(writes().length, 2, "readback is not a retry");
    });
    await run("failed profile read blocks editors and explicitly reloads, without a default fake profile", async ({ page, state }) => {
      state.profileOverride = route => route.fulfill({ status: 503, json: { error: { code: "PROFILE_UNAVAILABLE" } } });
      await login(page); await page.goto(`${origin}/cabinet`);
      await page.getByRole("alert").filter({ hasText: "Не удалось загрузить профиль" }).first().waitFor();
      assert.equal(await page.getByRole("button", { name: "Настройки", exact: true }).count(), 0);
      assert.equal(await page.getByRole("heading", { name: "Пользователь", exact: true }).count(), 0);
      state.profileOverride = null;
      await page.getByRole("button", { name: "Обновить профиль", exact: true }).first().click();
      await page.getByRole("heading", { name: "Синтетический", exact: true }).waitFor();
    });
    await run("unknown profile write hides editors, sends one PUT and recovers the committed profile only by readback", async ({ page, state }) => {
      await login(page); await page.goto(`${origin}/cabinet`);
      await page.getByRole("button", { name: "Настройки", exact: true }).click();
      await page.getByLabel("Имя", { exact: true }).fill("Сохранённый");
      state.profileOverride = (route, body) => {
        assert.equal(route.request().method(), "PUT");
        state.profiles.set(body.expectedOwnerId, { ...body.profile, email: state.active.email, phoneVerified: false, verifiedPhone: "" });
        return route.fulfill({ json: { status: "unrecognized-success" } });
      };
      await page.getByRole("button", { name: "Сохранить настройки", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Сохранение не подтверждено" }).first().waitFor();
      assert.equal(state.profileRequests.filter(row => row.method === "PUT").length, 1);
      assert.equal(await page.getByRole("button", { name: "Сохранить настройки", exact: true }).count(), 0);
      state.profileOverride = null;
      await page.getByRole("button", { name: "Обновить профиль", exact: true }).first().click();
      await page.getByRole("heading", { name: "Сохранённый", exact: true }).waitFor();
      assert.equal(state.profileRequests.filter(row => row.method === "PUT").length, 1);
    });
    await run("a held private profile for A cannot replace B after another tab changes account", async ({ page, context, state }) => {
      const first = user("first@example.invalid"), second = user("second@example.invalid");
      state.profiles.set(first.id, createDefaultCabinetProfile({ name: "Первый", email: first.email }));
      state.profiles.set(second.id, createDefaultCabinetProfile({ name: "Второй", email: second.email }));
      let release, started, completed;
      const gate = new Promise(resolve => { release = resolve; });
      const pending = new Promise(resolve => { started = resolve; });
      const settled = new Promise(resolve => { completed = resolve; });
      state.profileOverride = async (route, body) => {
        const profile = state.profiles.get(body.expectedOwnerId);
        if (body.expectedOwnerId === first.id) {
          started(); await gate;
          try { await route.fulfill({ json: { exists: true, profile, revision: fixtureRevision(profile) } }); }
          finally { completed(); }
          return;
        }
        return route.fulfill({ json: { exists: true, profile, revision: fixtureRevision(profile) } });
      };
      try {
        await login(page, first.email); await page.goto(`${origin}/cabinet`); await pending;
        const tab = await context.newPage(); tab.setDefaultTimeout(10000); await login(tab, second.email, true);
        await page.getByRole("heading", { name: "Второй", exact: true }).waitFor();
        release(); await settled;
        await page.getByRole("heading", { name: "Второй", exact: true }).waitFor();
        assert.equal(await page.getByRole("heading", { name: "Первый", exact: true }).count(), 0);
        assert.equal(await page.getByText(first.email, { exact: true }).count(), 0);
      } finally { release(); }
    });
    await run("late completion of A's profile save cannot publish into B's editor or create a second write", async ({ page, context, state }) => {
      const first = user("first@example.invalid"), second = user("second@example.invalid");
      state.profiles.set(first.id, createDefaultCabinetProfile({ name: "Первый", email: first.email }));
      state.profiles.set(second.id, createDefaultCabinetProfile({ name: "Второй", email: second.email }));
      await login(page, first.email); await page.goto(`${origin}/cabinet`);
      await page.getByRole("button", { name: "Настройки", exact: true }).click();
      await page.getByLabel("Имя", { exact: true }).fill("Изменённый первый");
      let release, started, completed;
      const gate = new Promise(resolve => { release = resolve; });
      const pending = new Promise(resolve => { started = resolve; });
      const settled = new Promise(resolve => { completed = resolve; });
      state.profileOverride = async (route, body) => {
        if (route.request().method() === "PUT") {
          started(); await gate;
          const profile = { ...body.profile, email: first.email, phoneVerified: false, verifiedPhone: "" };
          state.profiles.set(body.expectedOwnerId, profile);
          try { await route.fulfill({ json: { profile, revision: fixtureRevision(profile) } }); }
          finally { completed(); }
          return;
        }
        const current = state.profiles.get(body.expectedOwnerId);
        return route.fulfill({ json: { exists: true, profile: current, revision: fixtureRevision(current) } });
      };
      try {
        await page.getByRole("button", { name: "Сохранить настройки", exact: true }).click(); await pending;
        const tab = await context.newPage(); tab.setDefaultTimeout(10000); await login(tab, second.email, true);
        await page.getByRole("heading", { name: "Второй", exact: true }).waitFor();
        release(); await settled;
        await page.getByRole("heading", { name: "Второй", exact: true }).waitFor();
        assert.equal(state.profiles.get(second.id).name, "Второй");
        assert.equal(await page.getByRole("heading", { name: "Изменённый первый", exact: true }).count(), 0);
        assert.equal(state.profileRequests.filter(row => row.method === "PUT").length, 1);
      } finally { release(); }
    });
    await run("shared mobile navigation follows cookie login and cross-tab logout without legacy SDK traffic", async ({ page, context, state }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(`${origin}/auth`);
      const navigation = page.getByRole("navigation", { name: "Мобильная навигация" });
      await navigation.getByRole("link", { name: "Вход", exact: true }).waitFor();
      await login(page);
      await navigation.getByRole("link", { name: "Профиль", exact: true }).waitFor();
      assert.equal(await navigation.getByRole("link", { name: "Профиль", exact: true }).getAttribute("href"), "/cabinet");
      const second = await context.newPage(); await second.goto(`${origin}/auth`);
      await second.getByText("owner@example.invalid", { exact: true }).waitFor();
      await second.getByRole("button", { name: "Выйти", exact: true }).click();
      await navigation.getByRole("link", { name: "Вход", exact: true }).waitFor();
      assert.ok(state.sessionReads.length >= 2, "navigation is based on separately verified cookie state");
    });
    await run("unavailable cookie lookup shows a cabinet error, never an old identity or legacy login form", async ({ page, state }) => {
      state.override = route => route.fulfill({ status: 503, json: { error: { code: "AUTH_UNAVAILABLE" } } });
      await page.goto(`${origin}/cabinet`);
      await page.getByRole("alert").filter({ hasText: "Не удалось проверить вход" }).waitFor();
      assert.equal(await page.getByText("Нужно войти", { exact: true }).count(), 0);
      assert.equal(await page.getByText("owner@example.invalid", { exact: true }).count(), 0);
    });
    await run("cabinet logout uses the cookie API and keeps an unknown-outcome warning until a confirmed retry", async ({ page, state, calls }) => {
      await login(page); await page.goto(`${origin}/cabinet`);
      const logout = page.getByRole("button", { name: "Выйти", exact: true });
      await logout.waitFor();
      state.override = (route, action) => route.fulfill(action === "logout"
        ? { status: 503, json: { error: { code: "AUTH_UNAVAILABLE" } } }
        : { json: { user: state.active } });
      await logout.click();
      await page.getByRole("alert").filter({ hasText: "Выход не подтверждён" }).waitFor();
      assert.equal(page.url(), `${origin}/cabinet`);
      assert.equal(calls.filter(item => item.action === "logout").length, 1);
      state.override = null;
      await page.getByRole("button", { name: "Выйти", exact: true }).click();
      await page.waitForURL(`${origin}/auth`);
      await page.getByLabel("Email", { exact: true }).waitFor();
      assert.equal(calls.filter(item => item.action === "logout").length, 2);
    });
    await run("blocked BroadcastChannel creation still allows same-tab state changes and focus-based cross-tab recheck", async ({ page, context, state }) => {
      await context.addInitScript(() => {
        Object.defineProperty(window, "BroadcastChannel", { value: class { constructor() { throw new DOMException("Synthetic restriction", "SecurityError"); } } });
      });
      await page.setViewportSize({ width: 320, height: 900 });
      await login(page);
      const navigation = page.getByRole("navigation", { name: "Мобильная навигация" });
      await navigation.getByRole("link", { name: "Профиль", exact: true }).waitFor();
      const second = await context.newPage(); await second.goto(`${origin}/auth`); await second.bringToFront();
      await second.getByText("owner@example.invalid", { exact: true }).waitFor();
      await second.getByRole("button", { name: "Выйти", exact: true }).click();
      await second.getByLabel("Email", { exact: true }).waitFor();
      await page.bringToFront();
      const beforeFocus = state.sessionReads.length;
      // Headless tab activation does not guarantee an OS window-focus event; deliver that lifecycle stimulus explicitly.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await navigation.getByRole("link", { name: "Вход", exact: true }).waitFor();
      assert.ok(state.sessionReads.length > beforeFocus, "fallback focus causes a new server session check");
      assert.equal(await page.getByText("owner@example.invalid", { exact: true }).count(), 0);
    });
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
      state.override = async (route, action) => {
        if (action === "session") return route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } });
        await held; try { await route.fulfill({ json: { status: "password_reset" } }); } finally { finished(); }
      };
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
