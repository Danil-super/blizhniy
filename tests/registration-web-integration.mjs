import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";

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
    assert.equal(output.includes(signup.email), false, "no email in app logs");
    assert.equal(output.includes(password), false, "no password in app logs");
  } finally {
    if (app.exitCode === null) {
      process.kill(-app.pid, "SIGTERM");
      await Promise.race([once(app, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (app.exitCode === null && app.signalCode === null) process.kill(-app.pid, "SIGKILL");
    }
    mailServer.closeAllConnections();
    await new Promise((resolve) => mailServer.close(resolve));
  }
}
