import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/listing-store.ts', import.meta.url), 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} should have an end marker`);
  return source.slice(from, to);
}

const selectedSource = [
  section('function publicListing(', '\nasync function findCategoryId('),
  section('export async function getStoredListingById(', '\nexport async function getStoredListingForUser('),
  section('export async function listStoredListings(', '\nexport async function listStoredListingsForCategory('),
  section('export async function listStoredListingsForCategory(', '\nexport async function listStoredListingsForAdmin('),
].join('\n');

function harness(showExactAddress) {
  const exports = {};
  const raw = {
    id: '17c75a95-4667-47be-9a4d-74a3cdd5446b',
    address: 'Synthetic Street, 18',
    lat: 45.10101,
    lng: 38.99999,
    showExactAddress,
    hasMapPoint: showExactAddress,
    title: 'Synthetic listing',
  };
  const calls = [];
  const supabaseRest = async (path) => {
    calls.push(path);
    if (path.startsWith('/rest/v1/categories?')) {
      return path.includes('parent_id=is.null') || path.includes('limit=1000')
        ? [{ id: 'cat-1', slug: 'test', name: 'Test', parent_id: null }]
        : [];
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const js = ts.transpileModule(selectedSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, {
    exports,
    console,
    Date,
    encodeURIComponent,
    isSupabaseRestConfigured: () => true,
    isUuid: () => true,
    fetchListingRows: async (path) => { calls.push(path); return [raw]; },
    mapListing: (row) => ({ ...row }),
    supabaseRest,
  });
  return { ...exports, raw, calls };
}

test('public detail, feed and category strip hidden address and coordinates before serialization', async () => {
  const store = harness(false);
  const values = [
    await store.getStoredListingById(store.raw.id, { publicOnly: true }),
    ...(await store.listStoredListings(24)),
    ...(await store.listStoredListingsForCategory('test')),
  ];
  assert.equal(values.length, 3);
  for (const value of values) {
    assert.equal(value.address, undefined);
    assert.equal(value.lat, undefined);
    assert.equal(value.lng, undefined);
    assert.equal(value.hasMapPoint, false);
    assert.doesNotMatch(JSON.stringify(value), /Synthetic Street|45\.10101|38\.99999/);
  }
  assert.equal(store.raw.address, 'Synthetic Street, 18');
  assert.equal((await store.getStoredListingById(store.raw.id)).address, store.raw.address);
});

test('published exact address remains available when the author opted to show it', async () => {
  const store = harness(true);
  const values = [
    await store.getStoredListingById(store.raw.id, { publicOnly: true }),
    ...(await store.listStoredListings(24)),
    ...(await store.listStoredListingsForCategory('test')),
  ];
  assert.equal(values.length, 3);
  for (const value of values) {
    assert.equal(value.address, store.raw.address);
    assert.equal(value.lat, store.raw.lat);
    assert.equal(value.lng, store.raw.lng);
  }
});
