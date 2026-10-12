import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadProductionAuth } from "./production-auth-module.mjs";
const { readProductionAuthConfig, readMailEncryptionKey, renderProductionAuthMail, productionAuthOrigin } = loadProductionAuth("production-auth-config");
const env = { NODE_ENV: "production", BLIZHNIY_AUTH_MODE: "postgres", BLIZHNIY_AUTH_ORIGIN: productionAuthOrigin,
  BLIZHNIY_DB_HOST: "17e86f80f26733d39ef4b84d.twc1.net", BLIZHNIY_DB_PORT: "5432", BLIZHNIY_DB_NAME: "default_db",
  BLIZHNIY_DB_USER: "blizhniy_runtime", BLIZHNIY_DB_PASSWORD: "synthetic-driver-password", BLIZHNIY_DB_SSL_MODE: "verify-full",
  BLIZHNIY_DB_CA_FILE: "/etc/blizhniy/auth/root.crt", BLIZHNIY_AUTH_RATE_SECRET: "r".repeat(64),
  BLIZHNIY_AUTH_MAIL_KEY_FILE: "/etc/blizhniy/auth/mail-key.bin", BLIZHNIY_MAIL_MODE: "timeweb",
  BLIZHNIY_SMTP_USER: "notifications@ближний-ру.рф", BLIZHNIY_SMTP_PASSWORD: "synthetic-smtp-password",
  TURNSTILE_SECRET_KEY: "synthetic-captcha-secret-value" };

test("production Auth is explicitly opted in to the approved Russian database, verified TLS and restricted role", () => {
  assert.equal(readProductionAuthConfig({}), null);
  assert.equal(readProductionAuthConfig({ BLIZHNIY_AUTH_MODE: "local" }), null);
  assert.deepEqual(readProductionAuthConfig(env), { origin: productionAuthOrigin, rateSecret: env.BLIZHNIY_AUTH_RATE_SECRET,
    mailKeyFile: env.BLIZHNIY_AUTH_MAIL_KEY_FILE });
  for (const changes of [{ NODE_ENV: "development" }, { BLIZHNIY_AUTH_MODE: "unexpected" },
    { BLIZHNIY_DB_HOST: "127.0.0.1" }, { BLIZHNIY_DB_HOST: "foreign.invalid" }, { BLIZHNIY_DB_NAME: "blizhniy_staging" },
    { BLIZHNIY_DB_USER: "gen_user" }, { BLIZHNIY_DB_PORT: "5433" }, { BLIZHNIY_DB_SSL_MODE: "disable" },
    { BLIZHNIY_DB_PASSWORD: "" }, { BLIZHNIY_DB_CA_FILE: "relative.crt" }, { BLIZHNIY_AUTH_RATE_SECRET: "short" },
    { BLIZHNIY_AUTH_MAIL_KEY_FILE: "relative.key" }, { BLIZHNIY_MAIL_MODE: "" }, { BLIZHNIY_SMTP_PASSWORD: "" },
    { TURNSTILE_SECRET_KEY: "" }, { BLIZHNIY_LOCAL_MAIL_URL: "http://127.0.0.1:3001/messages" },
    { BLIZHNIY_AUTH_ORIGIN: `${productionAuthOrigin}/` }, { BLIZHNIY_AUTH_ORIGIN: "https://attacker.invalid" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { PGHOST: "foreign.invalid" }]) {
    assert.throws(() => readProductionAuthConfig({ ...env, ...changes }), /Invalid production auth configuration/);
  }
});
test("mail key reader requires an exact private owned regular 32-byte file and does not follow symlinks", () => {
  const directory = mkdtempSync(join(tmpdir(), "blizhniy-auth-key-test-"));
  const file = join(directory, "key.bin");
  const key = randomBytes(32);
  try {
    writeFileSync(file, key, { mode: 0o600 });
    assert.deepEqual(readMailEncryptionKey(file), key);
    symlinkSync(file, join(directory, "link.bin"));
    assert.throws(() => readMailEncryptionKey(join(directory, "link.bin")), /Invalid mail encryption key file/);
    chmodSync(file, 0o644);
    assert.throws(() => readMailEncryptionKey(file), /Invalid mail encryption key file/);
    chmodSync(file, 0o600);
    for (const size of [0, 31, 33]) {
      writeFileSync(file, Buffer.alloc(size));
      assert.throws(() => readMailEncryptionKey(file), /Invalid mail encryption key file/);
    }
    assert.throws(() => readMailEncryptionKey("relative.bin"), /Invalid mail encryption key file/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("mail rendering uses fixed same-origin fragment links and never query tokens or a local capture page", () => {
  const intent = { id: "40000000-0000-4000-8000-000000000001", expiresAt: new Date("2026-10-12T16:00:00Z") };
  const payload = { email: "synthetic@example.invalid", token: "a".repeat(64) };
  for (const [purpose, route] of [["confirm", "confirm"], ["recover", "reset"]]) {
    const message = renderProductionAuthMail({ ...intent, purpose }, payload);
    assert.equal(message.id, intent.id);
    assert.equal(message.to, payload.email);
    assert.ok(message.text.includes(`${productionAuthOrigin}/auth/${route}#token=${payload.token}`));
    assert.equal(message.text.includes("?token="), false);
    assert.equal(message.text.includes("/local/"), false);
    assert.ok(message.text.includes(intent.expiresAt.toISOString()));
  }
  const notice = renderProductionAuthMail({ ...intent, purpose: "reset_notice" }, { email: payload.email, token: null });
  assert.equal(notice.text.includes("token="), false);
});
