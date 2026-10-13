import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { loadProfileModule } from "./production-profile-module.mjs";
import { loadAdminModule } from "./admin-module.mjs";

const { PostgresProfileStore, ProfileOwnerChangedError, parseProductionProfile } = loadProfileModule("postgres-profile");
const { AppSessionAccessError } = loadAdminModule("app-session-transaction");
const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(64);

function contentHash(profile) {
  const canonical = Object.fromEntries(Object.keys(profile).sort().map(key => [key, profile[key]]));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// Only SQL storage/session responses are substituted. The production store and
// session guard perform authorization, revision comparison and conflict handling.
function databaseFixture(initialProfile = null, options = {}) {
  let stored = initialProfile === null ? null : structuredClone(initialProfile);
  let transactionTail = Promise.resolve();
  const calls = [];
  const db = { transaction(work) {
    const pending = transactionTail.then(async () => {
      let working = stored === null ? null : structuredClone(stored);
      const tx = { async query(sql, values = []) {
        const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
        calls.push({ sql: normalized, values });
        if (normalized.startsWith("select u.id")) {
          const rows = options.missingUser ? [] : [{ id: owner, role: "user", isBlocked: !!options.blocked,
            verified: !options.unverified, authVersion: "0" }];
          return { rows, rowCount: rows.length };
        }
        if (normalized.startsWith("select token_hash from app.sessions")) {
          return { rows: options.missingSession ? [] : [{ token_hash: values[0] }], rowCount: options.missingSession ? 0 : 1 };
        }
        if (normalized.startsWith("update app.sessions")) {
          return { rows: [], rowCount: options.expiredBeforeCommit ? 0 : 1 };
        }
        if (normalized.startsWith("select email")) {
          return { rows: [{ email: "synthetic@example.invalid" }], rowCount: 1 };
        }
        if (normalized.startsWith("select profile from app.cabinet_profiles")) {
          const rows = working === null ? [] : [{ profile: structuredClone(working) }];
          return { rows, rowCount: rows.length };
        }
        if (normalized.startsWith("update app.cabinet_profiles")) {
          assert.equal(values[0], owner);
          if (working === null) return { rows: [], rowCount: 0 };
          working = JSON.parse(values[1]);
          return { rows: normalized.includes("returning user_id") ? [{ user_id: owner }] : [], rowCount: 1 };
        }
        if (normalized.startsWith("insert into app.cabinet_profiles")) {
          assert.equal(values[0], owner);
          if (working !== null && normalized.includes("do nothing")) return { rows: [], rowCount: 0 };
          working = JSON.parse(values[1]);
          return { rows: normalized.includes("returning user_id") ? [{ user_id: owner }] : [], rowCount: 1 };
        }
        throw new Error(`Unexpected profile fixture SQL: ${normalized}`);
      } };
      const result = await work(tx);
      stored = working;
      return result;
    });
    transactionTail = pending.catch(() => {});
    return pending;
  } };
  return { store: new PostgresProfileStore(db), calls, stored: () => structuredClone(stored) };
}

test("a missing production profile exposes null revision", async () => {
  const f = databaseFixture();
  const result = await f.store.read(token, owner);
  assert.equal(result.exists, false);
  assert.equal(result.revision, null);
});

test("stored profile revision is the SHA256 of canonical stored content only", async () => {
  const profile = parseProductionProfile({ name: "Synthetic owner", notifyBookings: false });
  const f = databaseFixture(profile);
  const result = await f.store.read(token, owner);
  assert.equal(result.exists, true);
  assert.equal(result.profile.email, "synthetic@example.invalid");
  assert.equal(result.revision, contentHash(profile));
});

test("a stale production profile save rejects instead of overwriting another tab", async () => {
  const initial = parseProductionProfile({ name: "Initial synthetic profile" });
  const firstEdit = parseProductionProfile({ name: "First tab saved", notifyBookings: false });
  const staleEdit = parseProductionProfile({ name: "Stale second tab" });
  const f = databaseFixture(initial);
  const firstTab = await f.store.read(token, owner);
  const secondTab = await f.store.read(token, owner);
  await f.store.write(token, owner, firstEdit, firstTab.revision);
  await assert.rejects(f.store.write(token, owner, staleEdit, secondTab.revision), { name: "ProfileConflictError" });
  assert.deepEqual(f.stored(), firstEdit);
});

test("two saves based on the same missing row allow one creation and reject the stale creator", async () => {
  const firstEdit = parseProductionProfile({ name: "First creator" });
  const secondEdit = parseProductionProfile({ name: "Stale creator" });
  const f = databaseFixture();
  const outcomes = await Promise.allSettled([
    f.store.write(token, owner, firstEdit, null),
    f.store.write(token, owner, secondEdit, null),
  ]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find(result => result.status === "rejected");
  assert.equal(rejected?.reason.name, "ProfileConflictError");
  assert.deepEqual(f.stored(), firstEdit);
});

test("a matching revision save returns the new content revision", async () => {
  const initial = parseProductionProfile({ name: "Initial synthetic profile" });
  const edit = parseProductionProfile({ name: "Updated synthetic profile" });
  const f = databaseFixture(initial);
  const result = await f.store.write(token, owner, edit, contentHash(initial));
  assert.deepEqual(f.stored(), edit);
  assert.equal(result.revision, contentHash(edit));
  assert.equal((await f.store.read(token, owner)).revision, result.revision);
});

test("identical stored content keeps its revision and permits a save based on that content", async () => {
  const initial = parseProductionProfile({ name: "Unchanged synthetic profile" });
  const f = databaseFixture(initial);
  const revision = contentHash(initial);
  const firstSave = await f.store.write(token, owner, initial, revision);
  const secondSave = await f.store.write(token, owner, initial, revision);
  assert.equal(firstSave.revision, revision);
  assert.equal(secondSave.revision, revision);
  assert.deepEqual(f.stored(), initial);
});

test("profile key order does not change the revision or invalidate an equivalent base", async () => {
  const profile = parseProductionProfile({ name: "Synthetic order", notifyMessages: false });
  const reordered = Object.fromEntries(Object.entries(profile).reverse());
  const first = databaseFixture(profile);
  const second = databaseFixture(reordered);
  const firstRead = await first.store.read(token, owner);
  const secondRead = await second.store.read(token, owner);
  assert.equal(firstRead.revision, contentHash(profile));
  assert.equal(secondRead.revision, firstRead.revision);
  const edit = parseProductionProfile({ ...profile, city: "Synthetic city" });
  const saved = await second.store.write(token, owner, edit, firstRead.revision);
  assert.equal(saved.revision, contentHash(edit));
  assert.deepEqual(second.stored(), edit);
});

test("changed owner is denied before profile reads or writes even with a matching revision", async () => {
  const initial = parseProductionProfile({ name: "Protected owner" });
  const f = databaseFixture(initial);
  await assert.rejects(f.store.read(token, otherOwner), ProfileOwnerChangedError);
  await assert.rejects(f.store.write(token, otherOwner, parseProductionProfile({ name: "Unwanted change" }), contentHash(initial)), ProfileOwnerChangedError);
  assert.deepEqual(f.stored(), initial);
  assert.equal(f.calls.some(call => call.sql.includes("app.cabinet_profiles")), false);
});

for (const [label, options, sessionToken] of [
  ["invalid session token", {}, "invalid"],
  ["missing user", { missingUser: true }, token],
  ["blocked user", { blocked: true }, token],
  ["unverified user", { unverified: true }, token],
  ["missing live session", { missingSession: true }, token],
]) {
  test(`${label} is denied before profile storage or revision checks`, async () => {
    const initial = parseProductionProfile({ name: "Protected profile" });
    const f = databaseFixture(initial, options);
    await assert.rejects(f.store.read(sessionToken, owner), AppSessionAccessError);
    await assert.rejects(f.store.write(sessionToken, owner, parseProductionProfile({ name: "Unwanted change" }), null), AppSessionAccessError);
    assert.deepEqual(f.stored(), initial);
    assert.equal(f.calls.some(call => call.sql.includes("app.cabinet_profiles")), false);
  });
}

test("session expiry before commit rolls back a matching profile save", async () => {
  const initial = parseProductionProfile({ name: "Protected profile" });
  const f = databaseFixture(initial, { expiredBeforeCommit: true });
  await assert.rejects(f.store.write(token, owner, parseProductionProfile({ name: "Rolled back change" }), contentHash(initial)), AppSessionAccessError);
  assert.deepEqual(f.stored(), initial);
});
