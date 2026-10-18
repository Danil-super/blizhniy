import assert from "node:assert/strict";
import { test } from "node:test";
import { RegistrationStore } from "./auth-mail-module.mjs";
import { loadProfileModule } from "./production-profile-module.mjs";
import { REGISTRATION_LEGAL_VERSIONS } from "../src/lib/registration-legal.ts";

const { PostgresProfileStore, parseProductionProfile } = loadProfileModule("postgres-profile");
const owner = "11111111-1111-4111-8111-111111111111";
const email = "signup-profile-name@example.invalid";
const token = "a".repeat(64);
const input = { name: "  Тестовое имя  ", email, password: "Synthetic profile password!",
  acceptedAgreement: true, acknowledgedPrivacy: true,
  agreementVersion: REGISTRATION_LEGAL_VERSIONS.agreement, privacyVersion: REGISTRATION_LEGAL_VERSIONS.privacy };

// Substitute only the SQL boundary. Both business stores, name normalization,
// session authorization, profile serialization and revision checks remain real.
function fixture({ existing = false, initialProfile = null } = {}) {
  let userExists = existing;
  let stored = initialProfile;
  const db = { transaction: async work => work({ query: async (sql, values = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.startsWith("insert into app.users")) {
      if (userExists) return { rows: [], rowCount: 0 };
      userExists = true;
      return { rows: [{ id: owner, authVersion: "0" }], rowCount: 1 };
    }
    if (normalized.startsWith("insert into app.cabinet_profiles") || normalized.startsWith("update app.cabinet_profiles")) {
      stored = JSON.parse(values[1]);
      return { rows: [{ user_id: owner }], rowCount: 1 };
    }
    if (normalized.startsWith("insert into app.registration_legal")) return { rows: [], rowCount: 2 };
    if (normalized.startsWith("insert into app.email_confirmations")) {
      return { rows: [{ createdAt: new Date("2026-10-18T00:00:00Z"), expiresAt: new Date("2026-10-18T01:00:00Z") }], rowCount: 1 };
    }
    // The authorized read begins after confirmation/login, covered against real
    // PostgreSQL separately in profile-integration.mjs.
    if (normalized.startsWith("select u.id")) return { rows: [{ id: owner, role: "user", isBlocked: false, verified: true, authVersion: "0" }], rowCount: 1 };
    if (normalized.startsWith("select token_hash from app.sessions")) return { rows: [{ token_hash: values[0] }], rowCount: 1 };
    if (normalized.startsWith("update app.sessions")) return { rows: [], rowCount: 1 };
    if (normalized.startsWith("select email from app.users")) return { rows: [{ email }], rowCount: 1 };
    if (normalized.startsWith("select profile from app.cabinet_profiles")) return { rows: stored ? [{ profile: structuredClone(stored) }] : [], rowCount: stored ? 1 : 0 };
    throw new Error("Unexpected signup/profile fixture SQL");
  } }) };
  return { registration: new RegistrationStore(db), profiles: new PostgresProfileStore(db), stored: () => structuredClone(stored) };
}

test("a newly registered name reaches the authorized cabinet read unchanged instead of the generic fallback", async () => {
  const f = fixture();
  assert.ok(await f.registration.register(input));
  const snapshot = await f.profiles.read(token, owner);
  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.profile.name, "Тестовое имя");
  assert.equal(snapshot.profile.email, email);
  assert.equal(Object.hasOwn(f.stored(), "email"), false);
  assert.equal(Object.hasOwn(f.stored(), "phoneVerified"), false);
  assert.match(snapshot.revision, /^[a-f0-9]{64}$/);
});

test("duplicate signup cannot silently replace the existing cabinet name", async () => {
  const profile = parseProductionProfile({ name: "Сохранённое имя" });
  const f = fixture({ existing: true, initialProfile: profile });
  assert.equal(await f.registration.register(input), null);
  assert.equal((await f.profiles.read(token, owner)).profile.name, "Сохранённое имя");
  assert.deepEqual(f.stored(), profile);
});

test("an older account without a profile can set its name through an authenticated profile save", async () => {
  const f = fixture({ existing: true });
  assert.equal(await f.registration.register(input), null);
  const snapshot = await f.profiles.read(token, owner);
  assert.equal(snapshot.exists, false);
  const saved = await f.profiles.write(token, owner, parseProductionProfile({ name: "Имя владельца" }), snapshot.revision);
  assert.equal(saved.profile.name, "Имя владельца");
  assert.equal((await f.profiles.read(token, owner)).profile.name, "Имя владельца");
});
