import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import { execFile, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, X509Certificate } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { chromium } from "playwright";
import { hashSessionToken, IdentityStore } from "../src/lib/identity.ts";

// This fixture has no SMTP forwarder, external credentials or public inbox API.
export async function testRegistrationWeb(suite, db, dbEnv) {
  const secret = randomBytes(32).toString("hex");
  const authorization = `Bearer ${createHmac("sha256", secret).update("local-mail-capture").digest("hex")}`;
  const messages = [];
  const mailState = { fail: false, envelopes: 0 };
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
      mailState.envelopes++;
      if (mailState.fail) { response.writeHead(503).end(); return; }
      if (mail) {
        assert.match(mail.to, /\.invalid$/);
        assert.equal(request.headers["x-blizhniy-entry-point"], mail.subject.includes("восстановление") ? "worker" : "http");
        assert.match(request.headers["x-request-id"], /^[a-f0-9-]{36}$/);
        if (mail.subject.includes("пароль изменён")) assert.doesNotMatch(mail.text, /#token=|passphrase/);
        else assert.match(mail.text, /\/auth\/local\/(?:confirm|reset)#token=[a-f0-9]{64}/);
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
  const origin = `https://127.0.0.1:${port}`;
  const certificates = await mkdtemp(join(tmpdir(), "blizhniy-auth-tls-"));
  const keyPath = join(certificates, "server.key");
  const certPath = join(certificates, "server.crt");
  let ca;
  try {
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=blizhniy-auth-test", "-addext", "subjectAltName=IP:127.0.0.1", "-addext", "basicConstraints=critical,CA:TRUE",
      "-keyout", keyPath, "-out", certPath], { timeout: 10000 });
    ca = await readFile(certPath);
  } catch {
    mailServer.closeAllConnections();
    await new Promise((resolve) => mailServer.close(resolve));
    await rm(certificates, { recursive: true });
    throw new Error("Could not prepare owned local TLS fixture");
  }
  const certificatePin = createHash("sha256").update(new X509Certificate(ca).publicKey.export({ type: "spki", format: "der" })).digest("base64");
  const fetchLocal = (path, options = {}) => new Promise((resolve, reject) => {
    const request = httpsRequest(origin + path, { method: options.method ?? "GET", headers: options.headers,
      ca, servername: "", signal: AbortSignal.timeout(20000) }, (reply) => {
      const chunks = [];
      reply.on("data", (chunk) => chunks.push(chunk));
      reply.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: reply.statusCode,
        headers: Object.fromEntries(Object.entries(reply.headers).filter(([, value]) => value !== undefined).map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : value])) })));
      reply.on("error", reject);
    });
    request.on("error", reject);
    request.end(options.body);
  });
  const processEnv = { PATH: process.env.PATH, LANG: "C.UTF-8", ...dbEnv, NODE_ENV: "development",
    __NEXT_PROCESSED_ENV: "true", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SITE_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
    ENABLE_DEMO_CONTENT: "false", NEXT_PUBLIC_ENABLE_DEMO_CONTENT: "false", ENABLE_DEMO_ADMIN_BYPASS: "false", PAYMENT_PROVIDER: "mock",
    BLIZHNIY_AUTH_MODE: "local", BLIZHNIY_AUTH_ORIGIN: origin, BLIZHNIY_AUTH_RATE_SECRET: secret,
    BLIZHNIY_LOCAL_MAIL_URL: `http://127.0.0.1:${mailServer.address().port}/messages` };
  let output = "";
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port),
    "--experimental-https", "--experimental-https-key", keyPath, "--experimental-https-cert", certPath], {
    cwd: new URL("..", import.meta.url), env: processEnv, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  const capture = (chunk) => { output = (output + chunk.toString()).slice(-128000); };
  app.stdout.on("data", capture); app.stderr.on("data", capture);
  const password = "Synthetic browser passphrase 2026!";
  const signup = { email: "http-first@example.invalid", password, acceptedAgreement: true, acknowledgedPrivacy: true,
    agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy };
  const post = async (action, body, extraHeaders = {}, query = "") => {
    const response = await fetchLocal(`/api/account/${action}${query}`, { method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "X-Blizhniy-Request": "1", ...extraHeaders }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  let browser;
  try {
    const deadline = Date.now() + 60000;
    for (;;) {
      assert.equal(app.exitCode, null, "local app remains running");
      try {
        const response = await fetchLocal("/api/account/unknown");
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
      assert.equal((await fetchLocal("/api/account/confirm")).status, 405);
      assert.equal((await post("confirm", { token })).status, 200);
      assert.equal((await post("confirm", { token })).status, 400);
      const user = (await db.query("select id, email_verified_at from app.users where email=$1", [signup.email])).rows[0];
      assert.ok(user.email_verified_at);
      assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [user.id])).rows[0].count, 0);
      assert.equal(output.includes(token), false, "application logs never contain the token");
    });
    await suite.test("real browser signup → local captured mail → explicit confirmation → replay, with only same-origin requests", async () => {
      // Trust only this fixture's generated public key, never disable certificate checks globally.
      browser = await chromium.launch({ headless: true, args: [`--ignore-certificate-errors-spki-list=${certificatePin}`] });
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
      await page.getByLabel('Имя', { exact: true }).fill('Тестовое имя');
      await page.getByLabel("Email", { exact: true }).fill("browser-new@example.invalid");
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByLabel("Повторите пароль", { exact: true }).fill(password);
      await page.getByLabel(/Принимаю пользовательское соглашение/).check();
      await page.getByLabel(/Ознакомлен с политикой/).check();
      await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
      await page.getByRole('heading', { name: 'Проверьте почту', exact: true }).waitFor();
      assert.equal(await page.locator('input[type="password"]').count(), 0);
      const savedName = (await db.query("select p.profile->>'name' as name from app.cabinet_profiles p join app.users u on u.id=p.user_id where u.email=$1", ['browser-new@example.invalid'])).rows[0];
      assert.equal(savedName.name, 'Тестовое имя');
      const captured = messages.find((mail) => mail.to === "browser-new@example.invalid");
      assert.ok(captured, "synthetic message captured locally");
      const link = captured.text.match(/https:\/\/127\.0\.0\.1:\d+\/auth\/local\/confirm#token=[a-f0-9]{64}/)[0];
      assert.ok(link.startsWith(origin + "/auth/local/confirm#"));
      const token = new URL(link).hash.slice(7);
      await page.goto(link);
      const confirm = page.getByRole("button", { name: "Подтвердить email", exact: true });
      await confirm.waitFor();
      assert.equal(page.url(), `${origin}/auth/local/confirm`, "token removed from browser history URL");
      assert.equal((await db.query("select email_verified_at from app.users where email='browser-new@example.invalid'")).rows[0].email_verified_at, null, "page load/scanner cannot confirm");
      await confirm.click();
      await page.getByRole("status").filter({ hasText: "Email подтверждён" }).waitFor();
      assert.equal(await page.getByRole("status").filter({ hasText: "Email подтверждён" }).textContent(), "Email подтверждён. Теперь можно войти на HTTPS-стенде.");
      assert.equal(await page.getByRole("link", { name: "Вход в аккаунт", exact: true }).getAttribute("href"), "/auth/local/login");
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
      const link = captured.text.match(/https:\/\/127\.0\.0\.1:\d+\/auth\/local\/confirm#token=[a-f0-9]{64}/)[0];
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      let release;
      let started;
      const held = new Promise((resolve) => { release = resolve; });
      const received = new Promise((resolve) => { started = resolve; });
      await page.route("**/api/account/confirm", async (route) => {
        const request = route.request();
        const response = await fetchLocal("/api/account/confirm", { method: "POST", headers: await request.allHeaders(), body: request.postData() });
        started();
        await held;
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
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
    const cookieName = "__Host-blizhniy_session";
    const seedUser = async (email) => (await db.query(`insert into app.users (email, password_hash, email_verified_at)
      select $1, password_hash, now() from app.users where email='browser-new@example.invalid' returning id`, [email])).rows[0].id;
    const cookieFrom = (response) => response.headers.get("set-cookie").split(";")[0];
    await suite.test("HTTP cookie login switches accounts, reads live authority and revokes logout tokens", async () => {
      await seedUser("http-session-a@example.invalid");
      const secondId = await seedUser("http-session-b@example.invalid");
      const first = await post("login", { email: "http-session-a@example.invalid", password });
      assert.equal(first.status, 200);
      assert.deepEqual(Object.keys(first.body).sort(), ["status", "user"]);
      const firstCookie = cookieFrom(first);
      assert.match(first.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
      assert.equal((await post("session", {}, { cookie: firstCookie })).body.user.email, "http-session-a@example.invalid");
      assert.equal((await post("login", { email: "http-session-b@example.invalid", password: "Wrong synthetic passphrase 2026!" }, { cookie: firstCookie })).status, 401);
      assert.equal((await post("session", {}, { cookie: firstCookie })).status, 200);
      const second = await post("login", { email: "http-session-b@example.invalid", password }, { cookie: firstCookie });
      assert.equal(second.status, 200);
      const secondCookie = cookieFrom(second);
      assert.notEqual(firstCookie, secondCookie);
      assert.equal((await post("session", {}, { cookie: firstCookie })).status, 401);
      assert.equal((await post("session", {}, { cookie: secondCookie })).body.user.id, secondId);
      await db.query("update app.users set role='admin' where id=$1", [secondId]);
      assert.equal((await post("session", {}, { cookie: secondCookie })).body.user.role, "admin");
      await db.query("update app.users set is_blocked=true where id=$1", [secondId]);
      assert.equal((await post("session", {}, { cookie: secondCookie })).status, 401);
      const logout = await post("logout", {}, { cookie: secondCookie });
      assert.equal(logout.status, 200, "blocked users can still log out");
      assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
      assert.equal((await post("session", {}, { cookie: secondCookie })).status, 401);
      assert.equal((await post("logout", {})).status, 200);
      for (const cookie of [firstCookie, secondCookie]) assert.equal(output.includes(cookie.slice(cookie.indexOf("=")+1)), false, "no cookie token in server logs");
    });
    await suite.test("HTTP guard denies stale, limited, duplicated and forged authority and refuses cross-origin logout", async () => {
      const id = await seedUser("http-session-guard@example.invalid");
      const store = new IdentityStore(db);
      const limited = await store.loginForDataSubject("http-session-guard@example.invalid", password);
      assert.equal((await post("session", {}, { cookie: `${cookieName}=${limited.token}` })).status, 401);
      const session = await store.login("http-session-guard@example.invalid", password);
      const cookie = `${cookieName}=${session.token}`;
      assert.equal((await post("logout", {}, { cookie, Origin: "https://attacker.invalid" })).status, 403);
      assert.equal((await post("session", {}, { cookie })).status, 200, "CSRF logout did not revoke the session");
      assert.equal((await post("session", {}, { cookie: `${cookie}; ${cookie}` })).status, 401);
      assert.equal((await post("session", {}, { cookie: `${cookieName}=${hashSessionToken(session.token)}` })).status, 401);
      assert.equal((await post("session", {}, { authorization: `Bearer ${session.token}` })).status, 401);
      assert.equal((await post("session", { token: session.token })).status, 422);
      assert.equal((await post("session", {}, { cookie }, "?token=synthetic")).status, 400);
      assert.equal((await post("login", { email: "http-session-guard@example.invalid", password, role: "admin" })).status, 422);
      assert.equal((await db.query("select role from app.users where id=$1", [id])).rows[0].role, "user");
      await db.query("update app.sessions set created_at=now()-interval '9 hours', expires_at=now()-interval '1 hour', last_seen_at=now()-interval '2 hours' where token_hash=$1", [hashSessionToken(session.token)]);
      assert.equal((await post("session", {}, { cookie })).status, 401);
      for (const email of ["pending@example.invalid", "unknown-login@example.invalid"]) {
        const response = await post("login", { email, password });
        assert.equal(response.status, 401);
        assert.deepEqual(response.body, { error: { code: "INVALID_CREDENTIALS" } });
        assert.equal(response.headers.get("set-cookie"), null);
      }
      await store.revokeSession(limited.token);
      await store.revokeSession(session.token);
    });
    await suite.test("Chromium automatically sends the protected cookie across reload, account switch and logout", async () => {
      const firstId = await seedUser("browser-session-a@example.invalid");
      const secondId = await seedUser("browser-session-b@example.invalid");
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", () => errors.push("pageerror"));
      page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
      // Test-owned probe, not the future login UI. No script ever reads cookie/storage credentials.
      await page.route(`${origin}/auth/local/session-probe`, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ru"><title>Cookie probe</title>
        <button data-action="login" data-account="a">Login A</button><button data-action="login" data-account="b">Login B</button>
        <button data-action="session">Session</button><button data-action="logout">Logout</button><pre role="status"></pre>
        <script>document.addEventListener('click',async event=>{const action=event.target.dataset.action;if(!action)return;
        document.querySelector('pre').textContent='pending';const body=action==='login'?{email:'browser-session-'+event.target.dataset.account+'@example.invalid',password:${JSON.stringify(password)}}:{};
        const response=await fetch('/api/account/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(body)});
        document.querySelector('pre').textContent=JSON.stringify({status:response.status,body:await response.json()});});</script></html>` }));
      const click = async (name) => {
        await page.getByRole("button", { name, exact: true }).click();
        await page.waitForFunction(() => document.querySelector("pre").textContent.startsWith("{"));
        return JSON.parse(await page.getByRole("status").textContent());
      };
      try {
        await page.goto(`${origin}/auth/local/session-probe`);
        assert.equal((await click("Login A")).status, 200);
        const metadata = (await context.cookies(origin)).filter((cookie) => cookie.name === cookieName).map(({ name, httpOnly, secure, sameSite, path }) => ({ name, httpOnly, secure, sameSite, path }));
        assert.deepEqual(metadata, [{ name: cookieName, httpOnly: true, secure: true, sameSite: "Lax", path: "/" }]);
        assert.equal((await click("Session")).body.user.id, firstId, "renderer sends Secure cookie on the permitted loopback origin");
        await page.reload();
        assert.equal((await click("Session")).body.user.id, firstId);
        assert.equal((await click("Login B")).body.user.id, secondId);
        assert.equal((await click("Session")).body.user.id, secondId);
        assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [firstId])).rows[0].count, 0);
        assert.equal((await click("Logout")).status, 200);
        assert.equal((await context.cookies(origin)).some((cookie) => cookie.name === cookieName), false);
        assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [secondId])).rows[0].count, 0);
        assert.deepEqual(errors, [], "positive cookie lifecycle has a clean console");
      } finally { await context.close(); }
    });
    await suite.test("real login form restores sessions, hides the previous account and logs out without external requests", async () => {
      const firstId = await seedUser("ui-account-a@example.invalid");
      const secondId = await seedUser("ui-account-b@example.invalid");
      const context = await browser.newContext();
      const foreign = [];
      const errors = [];
      await context.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin) { foreign.push("foreign"); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on("pageerror", () => errors.push("pageerror"));
      page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.type() + ":" + message.text()); });
      const login = async (email, value = password) => {
        await page.getByLabel("Email", { exact: true }).fill(email);
        await page.getByLabel("Пароль", { exact: true }).fill(value);
        await page.getByRole("button", { name: "Войти", exact: true }).click();
      };
      try {
        await page.goto(`${origin}/auth/local/login`);
        await login("ui-account-a@example.invalid");
        await page.getByRole("heading", { name: "Локальный аккаунт", exact: true }).waitFor();
        await page.getByText("ui-account-a@example.invalid", { exact: true }).waitFor();
        assert.equal(await page.locator('input[type="password"]').count(), 0);
        await page.reload();
        await page.getByText("ui-account-a@example.invalid", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Сменить аккаунт", exact: true }).click();
        await page.getByRole("heading", { name: "Смена аккаунта", exact: true }).waitFor();
        assert.equal(await page.getByText("ui-account-a@example.invalid", { exact: true }).count(), 0);
        await login("ui-account-b@example.invalid", "Wrong synthetic passphrase 2026!");
        await page.getByRole("alert").filter({ hasText: "Неверный email или пароль" }).waitFor();
        assert.equal(await page.getByRole("alert").filter({ hasText: "Неверный email или пароль" }).evaluate((element) => element === document.activeElement), true);
        assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [firstId])).rows[0].count, 1);
        assert.equal(await page.getByText("ui-account-a@example.invalid", { exact: true }).count(), 0);
        await login("ui-account-b@example.invalid");
        await page.getByText("ui-account-b@example.invalid", { exact: true }).waitFor();
        assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [firstId])).rows[0].count, 0);
        await page.getByRole("button", { name: "Выйти", exact: true }).click();
        await page.getByLabel("Email", { exact: true }).waitFor();
        assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [secondId])).rows[0].count, 0);
        await page.reload();
        await page.getByLabel("Email", { exact: true }).waitFor();
        assert.deepEqual(foreign, []);
        assert.ok(errors.every((entry) => /^error:.*server responded with a status of 401/.test(entry)), "only intentional anonymous/wrong-password 401 resource errors");
      } finally { await context.close(); }
    });
    await suite.test("other tabs invalidate account views and a held old lookup cannot restore the previous user", async () => {
      await seedUser("ui-tabs-a@example.invalid");
      await seedUser("ui-tabs-b@example.invalid");
      const context = await browser.newContext();
      const first = await context.newPage();
      const second = await context.newPage();
      first.setDefaultTimeout(10000); second.setDefaultTimeout(10000);
      let release;
      let started;
      let fulfilled;
      const held = new Promise((resolve) => { release = resolve; });
      const received = new Promise((resolve) => { started = resolve; });
      const delivered = new Promise((resolve) => { fulfilled = resolve; });
      try {
        await first.goto(`${origin}/auth/local/login`);
        await first.getByLabel("Email", { exact: true }).fill("ui-tabs-a@example.invalid");
        await first.getByLabel("Пароль", { exact: true }).fill(password);
        await first.getByRole("button", { name: "Войти", exact: true }).click();
        await first.getByText("ui-tabs-a@example.invalid", { exact: true }).waitFor();
        await second.goto(`${origin}/auth/local/login`);
        await second.getByText("ui-tabs-a@example.invalid", { exact: true }).waitFor();
        let intercept = true;
        await first.route("**/api/account/session", async (route) => {
          if (!intercept) return route.continue();
          intercept = false;
          const request = route.request();
          const response = await fetchLocal("/api/account/session", { method: "POST", headers: await request.allHeaders(), body: request.postData() });
          const body = await response.text();
          assert.equal(JSON.parse(body).user.email, "ui-tabs-a@example.invalid");
          started(); await held;
          await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
          fulfilled();
        });
        await first.getByRole("button", { name: "Проверить сессию", exact: true }).click();
        await received;
        assert.equal(await first.getByText("ui-tabs-a@example.invalid", { exact: true }).count(), 0);
        await second.getByRole("button", { name: "Сменить аккаунт", exact: true }).click();
        await second.getByLabel("Email", { exact: true }).fill("ui-tabs-b@example.invalid");
        await second.getByLabel("Пароль", { exact: true }).fill(password);
        await second.getByRole("button", { name: "Войти", exact: true }).click();
        await second.getByText("ui-tabs-b@example.invalid", { exact: true }).waitFor();
        await first.getByText("ui-tabs-b@example.invalid", { exact: true }).waitFor();
        const oldResponse = first.waitForResponse((response) => response.url().endsWith("/api/account/session"));
        release(); await delivered; await (await oldResponse).finished();
        await first.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await first.getByText("ui-tabs-a@example.invalid", { exact: true }).count(), 0, "late A must not overwrite B");
        await first.getByText("ui-tabs-b@example.invalid", { exact: true }).waitFor();
        await second.getByRole("button", { name: "Выйти", exact: true }).click();
        await first.getByLabel("Email", { exact: true }).waitFor();
        assert.equal(await first.getByText("ui-tabs-b@example.invalid", { exact: true }).count(), 0);
      } finally { release(); await context.close(); }
    });
    await suite.test("unknown login/logout results hide identity until rechecked; role and block are not cached", async () => {
      const id = await seedUser("ui-fault@example.invalid");
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      try {
        await page.goto(`${origin}/auth/local/login`);
        await page.route("**/api/account/login", async (route) => {
          const request = route.request();
          const response = await fetchLocal("/api/account/login", { method: "POST", headers: await request.allHeaders(), body: request.postData() });
          assert.equal(response.status, 200);
          // Simulate an intermediary failure after commit and cookie delivery, not a password failure.
          await route.fulfill({ status: 503, headers: { "content-type": "application/json", "set-cookie": response.headers.get("set-cookie") }, body: JSON.stringify({ error: { code: "AUTH_UNAVAILABLE" } }) });
        });
        await page.getByLabel("Email", { exact: true }).fill("ui-fault@example.invalid");
        await page.getByLabel("Пароль", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Войти", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "успешный вход или выход не подтверждён" }).waitFor();
        assert.equal(await page.getByText("ui-fault@example.invalid", { exact: true }).count(), 0);
        await page.getByRole("button", { name: "Проверить сессию", exact: true }).click();
        await page.getByText("ui-fault@example.invalid", { exact: true }).waitFor();
        await page.route("**/api/account/logout", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AUTH_UNAVAILABLE" } }) }));
        await page.getByRole("button", { name: "Выйти", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "успешный вход или выход не подтверждён" }).waitFor();
        assert.equal(await page.getByLabel("Email", { exact: true }).count(), 0, "network error is not a successful anonymous view");
        assert.equal(await page.getByText("ui-fault@example.invalid", { exact: true }).count(), 0);
        assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [id])).rows[0].count, 1);
        await db.query("update app.users set role='admin' where id=$1", [id]);
        await page.getByRole("button", { name: "Проверить сессию", exact: true }).click();
        await page.getByText(/Администратор · права проверяет сервер/).waitFor();
        await db.query("update app.users set is_blocked=true where id=$1", [id]);
        await page.getByRole("button", { name: "Проверить сессию", exact: true }).click();
        await page.getByLabel("Email", { exact: true }).waitFor();
        assert.equal(await page.getByText(/Администратор · права проверяет сервер/).count(), 0);
      } finally { await context.close(); }
    });
    await suite.test("login and active account fit mobile/desktop, expose labels, keyboard focus and unobscured touch targets", async () => {
      await seedUser("ui-layout@example.invalid");
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      try {
        for (const width of [320, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${origin}/auth/local/login`);
          await page.getByLabel("Email", { exact: true }).waitFor();
          assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
          await page.getByLabel("Email", { exact: true }).focus(); await page.keyboard.press("Tab");
          assert.equal(await page.getByLabel("Пароль", { exact: true }).evaluate((element) => element === document.activeElement), true);
          const button = page.getByRole("button", { name: "Войти", exact: true });
          assert.equal(await button.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(8, 117, 209)");
          await button.scrollIntoViewIfNeeded();
          assert.equal(await button.evaluate((element) => { const box = element.getBoundingClientRect(); return box.height >= 44 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), true);
          if (width === 320 || width === 1440) await page.screenshot({ path: `/tmp/blizhniy-account-login-${width}.png`, fullPage: true });
        }
        await page.getByLabel("Email", { exact: true }).fill("ui-layout@example.invalid");
        await page.getByLabel("Пароль", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Войти", exact: true }).click();
        await page.getByText("ui-layout@example.invalid", { exact: true }).waitFor();
        for (const width of [320, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
          await page.screenshot({ path: `/tmp/blizhniy-account-active-${width}.png`, fullPage: true });
        }
      } finally { await context.close(); }
    });
    const { testPasswordRecoveryWeb } = await import("./password-recovery-web-integration.mjs");
    await testPasswordRecoveryWeb(suite, db, { post, fetchLocal, origin, messages, mailState, seedUser, password, readOutput: () => output });
    const { testLocalAdminWeb } = await import("./local-admin-web-integration.mjs");
    await testLocalAdminWeb(suite, db, { post, fetchLocal, origin, seedUser, password, readOutput: () => output, rateSecret: secret, browser });
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
    await rm(certificates, { recursive: true });
  }
}
