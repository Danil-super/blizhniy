import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { createTimewebMailer, readTimewebMailConfig, MailError } from "../src/lib/timeweb-mail.ts";
import { loadPrivateSmtpConfig } from "../scripts/check-timeweb-mail.mjs";

const sender = "notifications@xn----9sbphbgks4a4a.xn--p1ai";
const env = { BLIZHNIY_MAIL_MODE: "timeweb", BLIZHNIY_SMTP_USER: "notifications@ближний-ру.рф",
  BLIZHNIY_SMTP_PASSWORD: "synthetic-only+)* password" };
const message = { id: "10000000-0000-4000-8000-000000000001", to: "test@example.invalid",
  subject: "БЛИЖНИЙ: подтверждение email", text: "Синтетическое письмо, без настоящих токенов." };

test("mail is disabled by default, with no legacy/environment fallback", () => {
  assert.equal(readTimewebMailConfig({}), null);
  assert.equal(createTimewebMailer({}), null);
  assert.throws(() => readTimewebMailConfig({ SMTP_PASSWORD: "legacy", BLIZHNIY_SMTP_PASSWORD: "partial" }), /configuration/);
});

test("explicit Timeweb configuration preserves password bytes and accepts the IDN mailbox", () => {
  const config = readTimewebMailConfig(env);
  assert.equal(config.user, env.BLIZHNIY_SMTP_USER);
  assert.equal(config.password, env.BLIZHNIY_SMTP_PASSWORD);
  assert.equal(readTimewebMailConfig({ ...env, BLIZHNIY_SMTP_USER: sender }).user, sender);
});

for (const [key, value] of [
  ["BLIZHNIY_MAIL_MODE", "smtp"], ["BLIZHNIY_SMTP_USER", "attacker@example.invalid"],
  ["BLIZHNIY_SMTP_USER", "notifications@ближний-ру.рф\r\nBcc: attacker@example.invalid"],
  ["BLIZHNIY_SMTP_PASSWORD", ""], ["BLIZHNIY_SMTP_PASSWORD", "x".repeat(1025)],
  ["BLIZHNIY_SMTP_PASSWORD", "sensitive\nvalue"], ["NODE_TLS_REJECT_UNAUTHORIZED", "0"],
]) {
  test(`invalid ${key} fails closed without echoing a secret`, () => {
    assert.throws(() => readTimewebMailConfig({ ...env, [key]: value }), { message: "Invalid mail configuration" });
  });
}

test("the mail configuration and factory refuse browser use", () => {
  globalThis.window = {};
  try {
    assert.throws(() => readTimewebMailConfig(env), /server/);
    assert.throws(() => createTimewebMailer(env), /server/);
  } finally { delete globalThis.window; }
});

function fixture(behavior = {}) {
  const sent = [];
  let options;
  const mailer = createTimewebMailer(env, (config) => {
    options = config;
    return {
      verify: async () => true,
      sendMail: async (mail) => { sent.push(mail); return { accepted: mail.envelope.to, rejected: [] }; },
      ...behavior,
    };
  });
  return { mailer, sent, options };
}

test("Timeweb transport enforces verified implicit TLS, bounded waits and no content/file/protocol logging", async () => {
  const { mailer, options, sent } = fixture();
  assert.equal(options.host, "smtp.timeweb.ru");
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.tls.servername, "smtp.timeweb.ru");
  assert.equal(options.tls.minVersion, "TLSv1.2");
  assert.equal(options.debug, false);
  assert.equal(options.logger, false);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.equal(options.pool, false);
  assert.equal(options.forceAuth, true, "verify must never bypass authentication");
  assert.equal(options.socketTimeout, 15000);
  assert.equal(options.connectionTimeout, 5000);
  assert.equal(options.greetingTimeout, 5000);
  assert.equal(options.dnsTimeout, 5000);
  assert.equal(options.auth.pass, env.BLIZHNIY_SMTP_PASSWORD);
  assert.equal(options.auth.user, sender, "IDN login is canonicalized for SMTP");
  await mailer.verify();
  assert.equal(sent.length, 0, "verification must not send mail");
});

test("send uses one canonical recipient, a fixed sender and a stable message ID", async () => {
  const { mailer, sent } = fixture();
  await mailer.send({ ...message, to: "user+tag@пример.рф" });
  assert.deepEqual(sent[0].envelope, { from: sender, to: ["user+tag@xn--e1afmkfd.xn--p1ai"] });
  assert.equal(sent[0].from.address, sender);
  assert.equal(sent[0].messageId, `<${message.id}@xn----9sbphbgks4a4a.xn--p1ai>`);
  assert.equal(sent[0].text, message.text);
  assert.equal(sent[0].attachments, undefined);
});

for (const patch of [
  { to: "victim@example.invalid,attacker@example.invalid" }, { to: "Test <victim@example.invalid>" },
  { to: "test@example.invalid\nBcc: attacker@example.invalid" }, { to: "test@localhost" },
  { to: ".test@example.invalid" }, { to: "test..name@example.invalid" },
  { to: "test@пример.рф/path" }, { to: "test@пример.рф:465" }, { to: "test@пример.рф#fragment" },
  { subject: "Title\r\nBcc: attacker@example.invalid" }, { subject: "x".repeat(201) },
  { text: "x".repeat(16385) }, { text: "bad\0content" }, { id: "arbitrary-message-id" },
  { from: "attacker@example.invalid" }, { attachments: [{ path: "/etc/passwd" }] },
]) {
  test(`invalid mail input is rejected before sending (${Object.keys(patch)[0]})`, async () => {
    const { mailer, sent } = fixture();
    await assert.rejects(mailer.send({ ...message, ...patch }), { message: "Invalid mail message" });
    assert.equal(sent.length, 0);
  });
}

test("verification and send sanitize provider errors, never retaining response/body/credential causes", async () => {
  const raw = Object.assign(new Error("secret-password, token and email in provider response"), { code: "EAUTH", responseCode: 535 });
  const { mailer } = fixture({ verify: async () => { throw raw; }, sendMail: async () => { throw raw; } });
  for (const work of [() => mailer.verify(), () => mailer.send(message)]) {
    await assert.rejects(work(), (error) => {
      assert.ok(error instanceof MailError);
      assert.equal(error.message, "Mail operation failed");
      assert.equal(error.code, "AUTH_FAILED");
      assert.equal(error.cause, undefined);
      assert.equal(JSON.stringify(error).includes("secret-password"), false);
      return true;
    });
  }
});

test("temporary SMTP errors and an unknown outcome are distinct; the transport never retries", async () => {
  for (const [raw, code] of [[{ responseCode: 451 }, "TEMPORARY"], [{ responseCode: 550 }, "REJECTED"],
    [{ code: "ETIMEDOUT" }, "UNKNOWN"], [{ code: "malicious-code-secret" }, "UNKNOWN"]]) {
    let attempts = 0;
    const { mailer } = fixture({ sendMail: async () => { attempts++; throw raw; } });
    await assert.rejects(mailer.send(message), (error) => { assert.equal(error.code, code); return true; });
    assert.equal(attempts, 1);
  }
});

test("a resolved driver response without acceptance of the intended recipient is not success", async () => {
  for (const result of [{ accepted: [], rejected: [message.to] }, { accepted: ["other@example.invalid"], rejected: [] },
    {}, { accepted: [message.to], rejected: [message.to] }]) {
    const { mailer } = fixture({ sendMail: async () => result });
    await assert.rejects(mailer.send(message), { code: "UNKNOWN" });
  }
});

test("a real Nodemailer MIME compilation keeps Cyrillic content and canonicalizes the envelope", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  let compiled;
  const mailer = createTimewebMailer(env, () => ({
    verify: async () => true,
    sendMail: async (input) => {
      compiled = await transport.sendMail(input);
      return { accepted: compiled.envelope.to, rejected: [] };
    },
  }));
  await mailer.send(message);
  assert.equal(compiled.envelope.from, sender);
  assert.deepEqual(compiled.envelope.to, [message.to]);
  const mime = compiled.message.toString();
  assert.match(mime, /Content-Type: text\/plain; charset=utf-8/i);
  // RFC-compliant folding is formatting, not a change to the identifier.
  assert.match(mime.replace(/\r\n[ \t]+/g, " "), /Message-ID: <10000000-0000-4000-8000-000000000001@xn----9sbphbgks4a4a.xn--p1ai>/i);
  assert.match(mime, /Content-Transfer-Encoding: base64/i);
  assert.equal(Buffer.from(mime.split("\r\n\r\n")[1], "base64").toString("utf8").trimEnd(), message.text);
  assert.equal(mime.includes(env.BLIZHNIY_SMTP_PASSWORD), false);
});

test("the operator check reads only a bounded, owned, private, non-symlink credential file", () => {
  const directory = mkdtempSync(join(tmpdir(), "blizhniy-smtp-test-"));
  const file = join(directory, "smtp.json");
  try {
    writeFileSync(file, JSON.stringify(env), { mode: 0o600 });
    assert.deepEqual(loadPrivateSmtpConfig(file), env);
    symlinkSync(file, join(directory, "link.json"));
    assert.throws(() => loadPrivateSmtpConfig(join(directory, "link.json")), { message: "Invalid private mail configuration" });
    chmodSync(file, 0o644);
    assert.throws(() => loadPrivateSmtpConfig(file), { message: "Invalid private mail configuration" });
    chmodSync(file, 0o600);
    for (const content of [JSON.stringify({ ...env, NODE_OPTIONS: "--inspect" }), "invalid-json", "x".repeat(4097),
      JSON.stringify({ ...env, BLIZHNIY_SMTP_PASSWORD: 123 }), "{}", "[]"]) {
      writeFileSync(file, content);
      assert.throws(() => loadPrivateSmtpConfig(file), { message: "Invalid private mail configuration" });
    }
    assert.throws(() => loadPrivateSmtpConfig("relative-file.json"), { message: "Invalid private mail configuration" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
