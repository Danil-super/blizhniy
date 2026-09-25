import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const FIXED_NOW = "2026-09-25T12:00:00.000Z";
const OWNER_ID = "6633e3d3-889e-4c12-9309-b16ab1234567";
const OTHER_ID = "95083575-0d6a-4e89-a496-616b7e009d9a";
const VACANCY_ID = "d0d82ac4-d8ba-43a8-b481-b05d4fa38eaf";

const source = readFileSync(new URL("../src/lib/vacancy-store.ts", import.meta.url), "utf8");
const restoreSource = source.match(/export async function restoreStoredVacancyForUser[\s\S]*?(?=\nexport async function deleteStoredVacancyForUser)/)?.[0];
assert.ok(restoreSource, "Restoration function should exist");
const restoreJavaScript = ts.transpileModule(restoreSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function makeRow(overrides = {}) {
  return {
    id: VACANCY_ID,
    author_id: OWNER_ID,
    status: "archived",
    is_paid: true,
    expires_at: "2026-09-26T12:00:00.000Z",
    published_at: null,
    ...overrides,
  };
}

function createRestorationHarness(row) {
  const exports = {};
  const calls = [];
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
    static now() { return new Date(FIXED_NOW).getTime(); }
  };

  async function supabaseRest(path, options) {
    calls.push({ path, options });
    assert.equal(options.method, "PATCH");
    const params = new URL(path, "https://example.test").searchParams;
    const expiresAfter = params.get("expires_at")?.replace(/^gt\./, "");
    const match =
      params.get("id") === `eq.${row.id}` &&
      params.get("author_id") === `eq.${row.author_id}` &&
      params.get("is_paid") === `eq.${row.is_paid}` &&
      params.get("status") === `eq.${row.status}` &&
      expiresAfter && row.expires_at &&
      new Date(row.expires_at).getTime() > new Date(expiresAfter).getTime();

    if (!match) return [];
    Object.assign(row, options.body);
    return [{ id: row.id }];
  }

  vm.runInNewContext(restoreJavaScript, {
    exports,
    Date: FixedDate,
    encodeURIComponent,
    isSupabaseRestConfigured: () => true,
    isUuid: (value) => /^[0-9a-f-]{36}$/.test(value),
    supabaseRest,
  });

  return { restore: exports.restoreStoredVacancyForUser, calls };
}

test("expired archived vacancy cannot receive another free publication window", async () => {
  const row = makeRow({ expires_at: FIXED_NOW });
  const { restore, calls } = createRestorationHarness(row);

  assert.equal(await restore(row.id, OWNER_ID), false);
  assert.equal(row.status, "archived");
  assert.equal(row.expires_at, FIXED_NOW);
  assert.equal(row.published_at, null);
  assert.equal(calls[0].options.body.expires_at, undefined);
});

test("active paid archive can be restored without extending its original deadline", async () => {
  const row = makeRow();
  const deadline = row.expires_at;
  const { restore } = createRestorationHarness(row);

  assert.equal(await restore(row.id, OWNER_ID), true);
  assert.equal(row.status, "published");
  assert.equal(row.expires_at, deadline);
  assert.equal(row.published_at, FIXED_NOW);
});

test("other user, unpaid archive and expired status cannot restore a vacancy", async () => {
  for (const row of [makeRow(), makeRow({ is_paid: false }), makeRow({ status: "expired" })]) {
    const { restore } = createRestorationHarness(row);
    const userId = row.is_paid && row.status === "archived" ? OTHER_ID : OWNER_ID;

    assert.equal(await restore(row.id, userId), false);
    assert.notEqual(row.status, "published");
  }
});
