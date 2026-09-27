import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const FIRST_OWNER = "6633e3d3-889e-4c12-9309-b16ab1234567";
const SECOND_OWNER = "95083575-0d6a-4e89-a496-616b7e009d9a";

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const sellerSource = readFileSync(new URL("../src/lib/seller-profile.ts", import.meta.url), "utf8");
const sellerModule = { exports: {} };
vm.runInNewContext(transpile(sellerSource), { module: sellerModule, exports: sellerModule.exports, require });

test("two accounts with the same display name and phone retain separate seller links", () => {
  const first = { ownerKey: FIRST_OWNER, author: "Продавец", phone: "+79991112233" };
  const second = { ownerKey: SECOND_OWNER, author: "Продавец", phone: "+79991112233" };

  assert.notEqual(sellerModule.exports.sellerProfileHref(first), sellerModule.exports.sellerProfileHref(second));
  assert.equal(sellerModule.exports.isSameSeller(first, SECOND_OWNER), false);
  assert.equal(sellerModule.exports.isSameSeller(first, FIRST_OWNER), true);
});

const storeSource = readFileSync(new URL("../src/lib/listing-store.ts", import.meta.url), "utf8");
const publicListingSource = storeSource.match(/function publicListing\([\s\S]*?(?=\nasync function findCategoryId\()/)?.[0];
const sellerReaderSource = storeSource.match(/export async function listStoredListingsForSeller[\s\S]*?(?=\nexport async function )/)?.[0];
assert.ok(publicListingSource && sellerReaderSource, "Public seller reader should exist");

test("seller profile fetches only owner's paid, unexpired rows across pagination", async () => {
  const calls = [];
  const rows = Array.from({ length: 201 }, (_, id) => ({ id, author_id: FIRST_OWNER, status: "published", is_paid: true }));
  rows.push({ id: 999, author_id: SECOND_OWNER, status: "published", is_paid: true });
  const exports = {};
  vm.runInNewContext(transpile(`${publicListingSource}\n${sellerReaderSource}`), {
    exports,
    Date,
    encodeURIComponent,
    isSupabaseRestConfigured: () => true,
    isUuid: (value) => /^[0-9a-f-]{36}$/.test(value),
    fetchListingRows: async (query) => {
      const params = new URL(`https://example.test/?${query.replace(/^&/, "")}`).searchParams;
      calls.push(params);
      const owner = params.get("author_id")?.slice(3);
      const matching = rows.filter((row) => row.author_id === owner);
      return matching.slice(Number(params.get("offset")), Number(params.get("offset")) + Number(params.get("limit")));
    },
    mapListing: (row) => ({ id: row.id, ownerKey: row.author_id }),
  });

  const listings = await exports.listStoredListingsForSeller(FIRST_OWNER);
  assert.equal(listings.length, 201);
  assert.equal(calls.length, 2);
  assert.ok(listings.every((item) => item.ownerKey === FIRST_OWNER));
  assert.ok(calls.every((params) => params.get("status") === "eq.published" && params.get("is_paid") === "eq.true" && params.get("expires_at")?.startsWith("gt.")));
});

test("seller profile redacts hidden location and retains explicitly public location", async () => {
  const rows = [
    { id: 1, author_id: FIRST_OWNER, address: "Hidden address 18", lat: 45.10101, lng: 38.99999, showExactAddress: false, hasMapPoint: true },
    { id: 2, author_id: FIRST_OWNER, address: "Public address 20", lat: 45.20202, lng: 38.88888, showExactAddress: true, hasMapPoint: true },
  ];
  const exports = {};
  vm.runInNewContext(transpile(`${publicListingSource}\n${sellerReaderSource}`), {
    exports,
    Date,
    encodeURIComponent,
    isSupabaseRestConfigured: () => true,
    isUuid: () => true,
    fetchListingRows: async () => rows,
    mapListing: (row) => ({ ...row, ownerKey: row.author_id }),
  });

  const listings = await exports.listStoredListingsForSeller(FIRST_OWNER);
  assert.equal(listings.length, 2);
  assert.equal(listings[0].address, undefined);
  assert.equal(listings[0].lat, undefined);
  assert.equal(listings[0].lng, undefined);
  assert.equal(listings[0].hasMapPoint, false);
  assert.doesNotMatch(JSON.stringify(listings[0]), /Hidden address|45\.10101|38\.99999/);
  assert.equal(listings[1].address, "Public address 20");
  assert.equal(listings[1].lat, 45.20202);
  assert.equal(listings[1].lng, 38.88888);
});
