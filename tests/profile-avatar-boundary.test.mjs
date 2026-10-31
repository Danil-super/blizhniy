import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { loadLocalPrimaryModule } from "../scripts/local-primary-modules.cjs";

const { PostgresProfileStore, parseProductionProfile } = loadLocalPrimaryModule("postgres-profile");
const { hashSessionToken } = loadLocalPrimaryModule("identity");
const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(64);
const forgedAvatar = `data:image/png;base64,${Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]).toString("base64")}`;
const normalizedAvatar = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

function revision(profile) {
  if (profile === null) return null;
  const sorted = Object.fromEntries(Object.entries(profile).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}
function equalProfile(actual, expected) {
  // Avoid dumping even synthetic avatar data into test output on failure.
  assert.ok(JSON.stringify(actual) === JSON.stringify(expected), "stored profile matches expected content");
}

// Only SQL persistence is replaced; the real store and session guard enforce
// authorization/CAS. Transaction-local state commits only after work succeeds.
function fixture(initial, normalizeAvatar, policy = {}) {
  let stored = structuredClone(initial), activeTransactions = 0;
  let live = true, refreshes = 0;
  const state = {
    stored: () => structuredClone(stored),
    replace: profile => { stored = structuredClone(profile); },
    revoke: () => { live = false; },
    activeTransactions: () => activeTransactions,
  };
  const db = { async transaction(work) {
    activeTransactions++;
    let working = structuredClone(stored);
    const tx = { async query(sql, values = []) {
      const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
      if (query.startsWith("select u.id")) {
        const rows = policy.missingUser || values[0] !== hashSessionToken(token) ? [] : [{
          id: owner, role: "user", isBlocked: Boolean(policy.blocked), verified: !policy.unverified, authVersion: "0",
        }];
        return { rows, rowCount: rows.length };
      }
      if (query.startsWith("select token_hash from app.sessions")) {
        const allowed = live && !policy.missingSession && values[0] === hashSessionToken(token);
        return { rows: allowed ? [{ token_hash: values[0] }] : [], rowCount: allowed ? 1 : 0 };
      }
      if (query.startsWith("update app.sessions")) {
        refreshes++;
        return { rows: [], rowCount: live && refreshes !== policy.failRefreshAt ? 1 : 0 };
      }
      if (query.startsWith("select email")) return { rows: [{ email: "synthetic@example.invalid" }], rowCount: 1 };
      if (query.startsWith("select profile from app.cabinet_profiles")) {
        const rows = working === null ? [] : [{ profile: structuredClone(working) }];
        return { rows, rowCount: rows.length };
      }
      if (query.startsWith("update app.cabinet_profiles") || query.startsWith("insert into app.cabinet_profiles")) {
        if (policy.storageFailure) throw new Error("Synthetic storage failure");
        if (query.startsWith("insert") && working !== null) return { rows: [], rowCount: 0 };
        working = JSON.parse(values[1]);
        return { rows: [{ user_id: owner }], rowCount: 1 };
      }
      throw new Error("Unexpected avatar fixture SQL");
    } };
    try {
      const result = await work(tx);
      stored = working;
      return result;
    } finally { activeTransactions--; }
  } };
  return { ...state, store: new PostgresProfileStore(db, { normalizeAvatar }) };
}

test("a signature-only avatar rejected by the decoder never replaces the stored profile", async () => {
  const initial = parseProductionProfile({ name: "Synthetic owner", avatarDataUrl: normalizedAvatar });
  const f = fixture(initial, async () => { throw new Error("Synthetic decoder rejection"); });
  const input = parseProductionProfile({ name: "Changed owner", avatarDataUrl: forgedAvatar });
  await assert.rejects(f.store.write(token, owner, input, revision(initial)), /Synthetic decoder rejection/);
  equalProfile(f.stored(), initial);
});

test("a rejected avatar cannot create a missing profile", async () => {
  const f = fixture(null, async () => { throw new Error("Synthetic decoder rejection"); });
  await assert.rejects(f.store.write(token, owner, parseProductionProfile({ avatarDataUrl: forgedAvatar }), null), /Synthetic decoder rejection/);
  assert.equal(f.stored(), null);
});

test("changed avatars are decoded outside transactions and saved/returned without mutating input", async () => {
  const initial = parseProductionProfile({ name: "Synthetic owner" });
  let calls = 0;
  const f = fixture(initial, async value => {
    calls++;
    assert.ok(value === forgedAvatar, "decoder receives submitted avatar");
    assert.equal(f.activeTransactions(), 0, "decoding holds no database transaction or locks");
    return normalizedAvatar;
  });
  const input = Object.freeze(parseProductionProfile({ name: "Changed owner", avatarDataUrl: forgedAvatar }));
  const result = await f.store.write(token, owner, input, revision(initial));
  const expected = { ...input, avatarDataUrl: normalizedAvatar };
  assert.equal(calls, 1);
  assert.ok(input.avatarDataUrl === forgedAvatar, "caller input remains unchanged");
  equalProfile(f.stored(), expected);
  assert.ok(result.profile.avatarDataUrl === normalizedAvatar, "response contains normalized avatar");
  assert.equal(result.revision, revision(expected));
});

test("caller edits while decoding cannot alter the admitted profile snapshot", async () => {
  const initial = parseProductionProfile({ name: "Synthetic owner" });
  const input = parseProductionProfile({ name: "Admitted edit", avatarDataUrl: forgedAvatar });
  const expected = { ...input, avatarDataUrl: normalizedAvatar };
  const f = fixture(initial, async () => {
    input.name = "Caller changed after admission";
    input.avatarDataUrl = "";
    return normalizedAvatar;
  });
  const result = await f.store.write(token, owner, input, revision(initial));
  equalProfile(f.stored(), expected);
  assert.equal(result.profile.name, expected.name);
  assert.equal(result.revision, revision(expected));
});

test("an unchanged historical signature-only avatar is preserved byte for byte", async () => {
  const initial = parseProductionProfile({ name: "Synthetic owner", avatarDataUrl: forgedAvatar });
  const f = fixture(initial, async () => { throw new Error("Unchanged historical avatar must not decode"); });
  const input = parseProductionProfile({ ...initial, city: "Synthetic city" });
  const result = await f.store.write(token, owner, input, revision(initial));
  equalProfile(f.stored(), input);
  assert.ok(result.profile.avatarDataUrl === forgedAvatar, "historical avatar is unchanged");
});

for (const [label, avatarDataUrl] of [["unchanged", normalizedAvatar], ["removed", ""]]) {
  test(`${label} avatar bypasses decoding and still saves profile changes`, async () => {
    const initial = parseProductionProfile({ name: "Synthetic owner", avatarDataUrl: normalizedAvatar });
    let calls = 0;
    const f = fixture(initial, async () => { calls++; throw new Error("Decoder must not run"); });
    const input = parseProductionProfile({ ...initial, name: "Changed owner", avatarDataUrl });
    const saved = await f.store.write(token, owner, input, revision(initial));
    equalProfile(f.stored(), input);
    assert.ok(saved.profile.avatarDataUrl === avatarDataUrl, "requested avatar retained");
    assert.equal(calls, 0);
  });
}

for (const [label, policy, suppliedToken, expectedOwner, expectedRevision, error] of [
  ["absent user", { missingUser: true }, token, owner, "current", "AppSessionAccessError"],
  ["blocked user", { blocked: true }, token, owner, "current", "AppSessionAccessError"],
  ["unverified user", { unverified: true }, token, owner, "current", "AppSessionAccessError"],
  ["absent session", { missingSession: true }, token, owner, "current", "AppSessionAccessError"],
  ["wrong session", {}, "b".repeat(64), owner, "current", "AppSessionAccessError"],
  ["invalid session", {}, "invalid", owner, "current", "AppSessionAccessError"],
  ["wrong owner", {}, token, otherOwner, "current", "ProfileOwnerChangedError"],
  ["stale revision", {}, token, owner, "0".repeat(64), "ProfileConflictError"],
  ["invalid revision", {}, token, owner, "invalid", "ProfileInputError"],
]) {
  test(`${label} is refused before avatar decoding`, async () => {
    const initial = parseProductionProfile({ name: "Synthetic owner" });
    let calls = 0;
    const f = fixture(initial, async () => { calls++; return normalizedAvatar; }, policy);
    const input = parseProductionProfile({ avatarDataUrl: forgedAvatar });
    await assert.rejects(f.store.write(suppliedToken, expectedOwner, input,
      expectedRevision === "current" ? revision(initial) : expectedRevision), { name: error });
    assert.equal(calls, 0);
    equalProfile(f.stored(), initial);
  });
}

test("a profile changed during decoding cannot be overwritten by the completed avatar", async () => {
  const initial = parseProductionProfile({ name: "Synthetic owner" });
  const concurrent = parseProductionProfile({ name: "Concurrent change", avatarDataUrl: normalizedAvatar });
  let decoded = false;
  const f = fixture(initial, async () => {
    assert.equal(f.activeTransactions(), 0);
    f.replace(concurrent);
    decoded = true;
    return normalizedAvatar;
  });
  await assert.rejects(f.store.write(token, owner, parseProductionProfile({ avatarDataUrl: forgedAvatar }), revision(initial)), { name: "ProfileConflictError" });
  assert.equal(decoded, true);
  equalProfile(f.stored(), concurrent);
});

test("a profile created during decoding cannot be replaced by a stale first save", async () => {
  const concurrent = parseProductionProfile({ name: "Concurrent creator" });
  let decoded = false;
  const f = fixture(null, async () => {
    f.replace(concurrent);
    decoded = true;
    return normalizedAvatar;
  });
  await assert.rejects(f.store.write(token, owner, parseProductionProfile({ avatarDataUrl: forgedAvatar }), null), { name: "ProfileConflictError" });
  assert.equal(decoded, true);
  equalProfile(f.stored(), concurrent);
});

test("a session revoked during decoding cannot write the completed avatar", async () => {
  const initial = parseProductionProfile({ name: "Synthetic owner" });
  let decoded = false;
  const f = fixture(initial, async () => {
    assert.equal(f.activeTransactions(), 0);
    f.revoke();
    decoded = true;
    return normalizedAvatar;
  });
  await assert.rejects(f.store.write(token, owner, parseProductionProfile({ avatarDataUrl: forgedAvatar }), revision(initial)), { name: "AppSessionAccessError" });
  assert.equal(decoded, true);
  equalProfile(f.stored(), initial);
});

for (const [label, policy, error] of [
  ["storage failure", { storageFailure: true }, /Synthetic storage failure/],
  ["final session refresh failure", { failRefreshAt: 2 }, { name: "AppSessionAccessError" }],
]) {
  test(`${label} retains the previous avatar in the transaction fixture`, async () => {
    const initial = parseProductionProfile({ name: "Synthetic owner", avatarDataUrl: normalizedAvatar });
    let calls = 0;
    const f = fixture(initial, async () => { calls++; return normalizedAvatar; }, policy);
    await assert.rejects(f.store.write(token, owner, parseProductionProfile({ avatarDataUrl: forgedAvatar }), revision(initial)), error);
    assert.equal(calls, 1);
    equalProfile(f.stored(), initial);
  });
}
