import assert from "node:assert/strict";
import { IdentityStore, hashSessionToken, verifyPassword } from "../src/lib/identity.ts";

// Reuses the parent fixture's owned PostgreSQL, HTTPS Next process and memory-only mail sink.
export async function testPasswordRecoveryWeb(suite, db, { post, fetchLocal, origin, messages, mailState, seedUser, password, readOutput }) {
  const identity = new IdentityStore(db);
  const replacement = "  Synthetic new HTTP recovery passphrase 2026!  ";
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, "owned background recovery finished before deadline");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const run = (name, fn) => suite.test(name, async () => {
    // Counters belong exclusively to this ephemeral suite, not a real or shared application DB.
    await db.query("delete from app.auth_rate_limits");
    await fn();
  });
  const recover = async (email) => {
    const before = messages.length;
    const result = await post("recover", { email });
    assert.equal(result.status, 202);
    await waitFor(() => messages.slice(before).some((mail) => mail.to === email && mail.subject.includes("восстановление")));
    return messages.slice(before).find((mail) => mail.to === email && mail.subject.includes("восстановление"));
  };
  const tokenFrom = (mail) => {
    const link = mail.text.match(/https:\/\/127\.0\.0\.1:\d+\/auth\/local\/reset#token=[a-f0-9]{64}/)?.[0];
    assert.ok(link?.startsWith(origin + "/auth/local/reset#"));
    assert.equal(new URL(link).search, "");
    return new URL(link).hash.slice(7);
  };
  const getUser = async (id) => (await db.query("select * from app.users where id=$1", [id])).rows[0];
  await run("actual HTTPS recovery accepts known, pending and missing email uniformly without modifying credentials or sessions", async () => {
    const email = "web-recovery-request@example.invalid";
    const id = await seedUser(email);
    const pending = "web-recovery-pending@example.invalid";
    const pendingId = await seedUser(pending);
    await db.query("update app.users set email_verified_at=null where id=$1", [pendingId]);
    const session = await identity.login(email, password);
    const before = await getUser(id);
    for (const recipient of [email, pending, "web-recovery-missing@example.invalid"]) {
      const count = mailState.envelopes;
      const response = await post("recover", { email: recipient });
      assert.equal(response.status, 202);
      assert.deepEqual(response.body, { status: "accepted" });
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      await waitFor(() => mailState.envelopes > count);
    }
    await waitFor(() => messages.some((mail) => mail.to === email));
    const token = tokenFrom(messages.find((mail) => mail.to === email));
    assert.equal((await post("confirm", { token })).status, 400, "recovery has a separate token purpose");
    assert.deepEqual(await getUser(id), before);
    assert.ok(await identity.resolveSession(session.token));
    assert.equal(messages.some((mail) => mail.to === pending), false);
    assert.equal((await db.query("select count(*)::integer as count from app.password_recoveries where user_id=$1", [pendingId])).rows[0].count, 0);
    assert.equal(readOutput().includes(token), false);
  });
  await run("recovery acceptance does not wait for a locked account; reset refuses scanners, CSRF, query tokens and weak passwords", async () => {
    const email = "web-recovery-locked@example.invalid";
    const id = await seedUser(email);
    await db.transaction(async (tx) => {
      await tx.query("select id from app.users where id=$1 for update", [id]);
      const response = await post("recover", { email });
      assert.equal(response.status, 202, "202 arrives before the worker can inspect this account");
      assert.equal(messages.some((mail) => mail.to === email), false);
      assert.equal((await tx.query("select count(*)::integer as count from app.password_recoveries where user_id=$1", [id])).rows[0].count, 0);
    });
    await waitFor(() => messages.some((mail) => mail.to === email));
    const token = tokenFrom(messages.find((mail) => mail.to === email));
    const input = { token, password: replacement };
    assert.equal((await fetchLocal("/api/account/recover")).status, 405);
    assert.equal((await fetchLocal("/api/account/reset")).status, 405);
    assert.equal((await post("reset", input, {}, `?token=${token}`)).status, 400);
    assert.equal((await post("reset", input, { Origin: "https://foreign.invalid" })).status, 403);
    assert.equal((await post("reset", { ...input, role: "admin" })).status, 422);
    assert.equal((await post("recover", { email: "real@example.ru" })).status, 422);
    assert.equal((await post("reset", { token, password: "short" })).status, 422);
    assert.equal((await getUser(id)).auth_version, "0");
    assert.equal((await db.query("select token_hash from app.password_recoveries where user_id=$1", [id])).rows[0].token_hash, hashSessionToken(token));
    assert.equal(readOutput().includes(token), false, "query rejection is not logged with its URL");
  });
  await run("HTTPS reset revokes both owner scopes, preserves the second account, notifies after commit and requires ordinary login", async () => {
    const email = "web-recovery-owner@example.invalid";
    const id = await seedUser(email);
    const other = "web-recovery-other@example.invalid";
    await seedUser(other);
    const sessions = [await identity.login(email, password), await identity.login(email, password)];
    const limited = await identity.loginForDataSubject(email, password);
    const unrelated = await identity.login(other, password);
    const cookie = `__Host-blizhniy_session=${unrelated.token}`;
    const token = tokenFrom(await recover(email));
    const result = await post("reset", { token, password: replacement }, { cookie });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { status: "password_reset" });
    assert.equal(result.headers.get("set-cookie"), null);
    for (const session of sessions) assert.equal((await post("session", {}, { cookie: `__Host-blizhniy_session=${session.token}` })).status, 401);
    assert.equal(await identity.resolveDataSubjectSession(limited.token), null);
    assert.equal((await post("session", {}, { cookie })).body.user.email, other);
    const current = await getUser(id);
    assert.equal(current.auth_version, "1");
    assert.equal(await verifyPassword(replacement, current.password_hash), true);
    assert.equal((await db.query("select count(*)::integer as count from app.sessions where user_id=$1", [id])).rows[0].count, 0);
    const notice = messages.find((mail) => mail.to === email && mail.subject.includes("пароль изменён"));
    assert.ok(notice);
    assert.ok(notice.text.includes("сессии отозваны"));
    assert.equal(notice.text.includes(token) || notice.text.includes(replacement), false);
    const count = messages.length;
    assert.equal((await post("reset", { token, password: replacement })).status, 400);
    assert.equal(messages.length, count, "replay does not notify or retry");
    assert.equal((await post("login", { email, password })).status, 401);
    assert.equal((await post("login", { email, password: replacement })).status, 200);
    for (const sensitive of [email, token, replacement, unrelated.token, limited.token, ...sessions.map((s) => s.token)]) assert.equal(readOutput().includes(sensitive), false);
  });
  await run("HTTP recovery rotates links; notification outage leaves a successful reset committed without retry", async () => {
    const email = "web-recovery-notify@example.invalid";
    const id = await seedUser(email);
    const first = tokenFrom(await recover(email));
    const second = tokenFrom(await recover(email));
    assert.equal((await post("reset", { token: first, password: replacement })).status, 400);
    mailState.fail = true;
    const before = messages.length;
    try {
      const result = await post("reset", { token: second, password: replacement });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { status: "password_reset" });
      assert.equal(messages.length, before);
      assert.equal((await getUser(id)).auth_version, "1");
      assert.equal(await verifyPassword(replacement, (await getUser(id)).password_hash), true);
      assert.equal((await post("reset", { token: second, password: replacement })).status, 400);
      await waitFor(() => readOutput().includes('"event":"local_auth_mail_failed"'));
    } finally { mailState.fail = false; }
  });
  await run("background SQL failure is observable without changing the accepted response or account, and releases the worker slot", async () => {
    const email = "web-recovery-fault@example.invalid";
    const id = await seedUser(email);
    const before = await getUser(id);
    await db.query(`create function app.test_http_recovery_fault() returns trigger language plpgsql as $$
      begin raise exception 'Synthetic HTTP recovery failure' using errcode='23514'; end; $$`);
    await db.query("create trigger test_http_recovery_fault before insert on app.password_recoveries for each row execute function app.test_http_recovery_fault()");
    try {
      const response = await post("recover", { email });
      assert.equal(response.status, 202);
      assert.deepEqual(response.body, { status: "accepted" });
      await waitFor(() => readOutput().includes('"event":"local_auth_recovery_failed"'));
      assert.deepEqual(await getUser(id), before);
      assert.equal(messages.some((mail) => mail.to === email), false);
    } finally {
      await db.query("drop trigger test_http_recovery_fault on app.password_recoveries");
      await db.query("drop function app.test_http_recovery_fault()");
    }
    tokenFrom(await recover(email));
    assert.equal(readOutput().includes(email), false);
    assert.equal(readOutput().includes("Synthetic HTTP recovery failure"), false);
  });
  await run("shared recovery throttling is identical for confirmed and unknown emails and also limits login", async () => {
    const email = "web-recovery-rate@example.invalid";
    await seedUser(email);
    for (const recipient of [email, "web-recovery-rate-missing@example.invalid"]) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const count = mailState.envelopes;
        assert.equal((await post("recover", { email: recipient })).status, 202);
        await waitFor(() => mailState.envelopes > count);
      }
      const denied = await post("recover", { email: recipient });
      assert.equal(denied.status, 429);
      assert.deepEqual(denied.body, { error: { code: "RATE_LIMITED" } });
      assert.equal(denied.headers.get("retry-after"), "900");
      assert.equal((await post("login", { email: recipient, password })).status, 429);
    }
  });
}
