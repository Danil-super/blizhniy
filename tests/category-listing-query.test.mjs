import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/lib/listing-store.ts', import.meta.url), 'utf8');
const reader = source.match(/export async function listStoredListingsForCategory\([\s\S]*?(?=\nexport async function listStoredListingsForAdmin\()/)?.[0];
assert.ok(reader);

function createReader(taxonomy) {
  const calls = [];
  const exports = {};
  const js = ts.transpileModule(reader, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, {
    exports,
    console,
    Date,
    encodeURIComponent,
    isSupabaseRestConfigured: () => true,
    supabaseRest: async (path) => {
      calls.push(path);
      if (path.includes('limit=1000')) return taxonomy;
      if (path.includes('parent_id=is.null')) return [{ id: 'root', slug: 'target', name: 'Target' }];
      if (path.includes('parent_id=eq.root')) return taxonomy.filter((row) => row.parent_id === 'root');
      throw new Error(`Unexpected query: ${path}`);
    },
    fetchListingRows: async (suffix) => {
      calls.push(suffix);
      return [{ id: 'listing' }];
    },
    mapListing: (row) => row,
    publicListing: (row) => row,
  });
  return { ...exports, calls };
}

test('category and subcategory each resolve with one taxonomy read', async () => {
  const taxonomy = [
    { id: 'root', slug: 'target', parent_id: null },
    { id: 'first', name: 'First', parent_id: 'root' },
    { id: 'second', name: 'Second', parent_id: 'root' },
    { id: 'other', name: 'First', parent_id: 'other-root' },
  ];
  const parent = createReader(taxonomy);
  assert.equal((await parent.listStoredListingsForCategory('target', { page: 2, pageSize: 24 })).length, 1);
  assert.equal(parent.calls.length, 2, 'one taxonomy read and one listings read');
  assert.match(parent.calls[1], /category_id=in\.\(root,first,second\)/);
  assert.match(parent.calls[1], /status=eq\.published&is_paid=eq\.true/);
  assert.match(parent.calls[1], /&limit=25&offset=24/);

  const child = createReader(taxonomy);
  assert.equal((await child.listStoredListingsForCategory('target', { subcategoryName: 'First' })).length, 1);
  assert.match(child.calls[1], /category_id=in\.\(first\)/);

  const missing = createReader(taxonomy);
  assert.equal((await missing.listStoredListingsForCategory('target', { subcategoryName: 'Absent' })).length, 0);
  assert.equal(missing.calls.length, 1);
});

test('when taxonomy reaches 1,000 rows the targeted lookups preserve completeness', async () => {
  const taxonomy = Array.from({ length: 1000 }, (_, index) => ({ id: `unrelated-${index}`, parent_id: null }));
  taxonomy.push({ id: 'first', name: 'First', parent_id: 'root' });
  const store = createReader(taxonomy.slice(1));
  await store.listStoredListingsForCategory('target', { subcategoryName: 'First' });
  assert.equal(store.calls.length, 4);
  assert.match(store.calls[1], /slug=eq\.target&parent_id=is\.null/);
  assert.match(store.calls[2], /parent_id=eq\.root/);
  assert.match(store.calls[3], /category_id=in\.\(first\)/);
});
