import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { AuthRateLimiter } from "../src/lib/auth-http.ts";
import * as cookies from "../src/lib/account-cookie.ts";
import * as proxy from "../src/lib/trusted-proxy-ip.ts";
import { IdentityStore } from "../src/lib/identity.ts";
import { MailPayloadCipher } from "../src/lib/mail-outbox.ts";
import { MailDeliveryWorker } from "../src/lib/mail-delivery.ts";
import { RegistrationStore, PasswordRecoveryStore } from "./auth-mail-module.mjs";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";
import { loadProductionAuth } from "./production-auth-module.mjs";
const config = loadProductionAuth("production-auth-config");
const { createProductionAccountHandler } = loadProductionAuth("production-account-http", {
  "./account-cookie": cookies, "./trusted-proxy-ip": proxy, "./production-auth-config": config,
});

export async function testProductionAuth(suite, db) {
  const secret = randomBytes(32).toString("hex");
  const cipher = new MailPayloadCipher(randomBytes(32));
  const identity = new IdentityStore(db);
  const state = { store: new RegistrationStore(db, cipher), recovery: new PasswordRecoveryStore(db, cipher),
    identity, limiter: new AuthRateLimiter(db, secret), verifyCaptcha: async token => token === "synthetic-production-proof" };
  const events = [];
  const handler = createProductionAccountHandler({ origin: config.productionAuthOrigin, rateSecret: secret, mailKeyFile: "/synthetic/key.bin" }, () => state, event => events.push(event));
  const request = async (action, body, cookie) => {
    const response = await handler(new Request(`${config.productionAuthOrigin}/api/account/${action}`, {
      method: "POST", headers: { host: new URL(config.productionAuthOrigin).host, origin: config.productionAuthOrigin,
        "x-real-ip": "192.0.2.42", "x-blizhniy-request": "1", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
    }), action);
    return { response, body: await response.json() };
  };
  const mailer = new MailDeliveryWorker(db, cipher, config.renderProductionAuthMail);
  const password = "Synthetic production handler passphrase!";
  const email = `production-${randomUUID()}@example.invalid`;
  const captchaToken = "synthetic-production-proof";

  await suite.test("production-style request with real PostgreSQL: signup → queue → confirmation → cookie login/session/logout", async () => {
    const signup = await request("register", { email, password, captchaToken, acceptedAgreement: true, acknowledgedPrivacy: true,
      agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy });
    assert.equal(signup.response.status, 202);
    assert.deepEqual(signup.body, { status: "accepted" });
    const account = (await db.query("select id from app.users where email=$1", [email])).rows[0];
    assert.equal((await db.query("select count(*)::integer as n from app.mail_outbox where user_id=$1", [account.id])).rows[0].n, 1);
    assert.equal((await request("login", { email, password, captchaToken })).response.status, 401);
    let confirmation;
    assert.equal((await mailer.runOne({ send: async message => { assert.equal(message.to, email); confirmation = message.text.match(/#token=([a-f0-9]{64})/)[1]; } })).state, "accepted");
    assert.equal((await request("confirm", { token: confirmation })).response.status, 200);
    assert.equal((await request("confirm", { token: confirmation })).response.status, 400);
    const login = await request("login", { email, password, captchaToken });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    const session = await request("session", {}, cookie);
    assert.equal(session.body.user.id, account.id);
    assert.equal(Object.hasOwn(login.body, "token"), false);
    assert.equal((await request("logout", {}, cookie)).response.status, 200);
    assert.equal((await request("session", {}, cookie)).response.status, 401);
    assert.equal(JSON.stringify(events).includes(confirmation), false);
    assert.equal(JSON.stringify(events).includes(email), false);
  });
  await suite.test("production recovery uses durable source job and reset revokes cookies without automatic login", async () => {
    const login = await request("login", { email, password, captchaToken });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    assert.equal((await request("recover", { email, captchaToken })).response.status, 202);
    let token;
    assert.equal((await mailer.runOne({ send: async message => { token = message.text.match(/#token=([a-f0-9]{64})/)[1]; } })).state, "accepted");
    const nextPassword = "Synthetic changed production passphrase!";
    const reset = await request("reset", { token, password: nextPassword, captchaToken });
    assert.equal(reset.response.status, 200);
    assert.equal(reset.response.headers.get("set-cookie"), null);
    assert.deepEqual(reset.body, { status: "password_reset" });
    assert.equal((await request("session", {}, cookie)).response.status, 401);
    assert.equal((await request("reset", { token, password: nextPassword, captchaToken })).response.status, 400);
    assert.equal((await mailer.runOne({ send: async message => assert.equal(message.text.includes("#token="), false) })).state, "accepted");
    assert.equal(JSON.stringify(events).includes(token), false);
    await db.query("delete from app.users where email=$1", [email]);
  });
  await suite.test("production IP/email limits persist across two instances and namespaces without plaintext identifiers", async () => {
    const key = randomBytes(32).toString("hex");
    const first = new AuthRateLimiter(db, key);
    const second = new AuthRateLimiter(db, key);
    const outcomes = await Promise.all(Array.from({ length: 12 }, (_, i) => (i%2 ? first : second).allowProduction("credential", `192.0.2.${i+1}`, "limited-production@example.invalid")));
    assert.equal(outcomes.filter(Boolean).length, 5);
    assert.equal(await new AuthRateLimiter(db, key).allowProduction("credential", "192.0.2.20", "limited-production@example.invalid"), false);
    assert.equal(await second.allowProduction("session", "192.0.2.20"), true);
    const rows = (await db.query("select key_hash from app.auth_rate_limits")).rows;
    assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.key_hash)));
  });
}
