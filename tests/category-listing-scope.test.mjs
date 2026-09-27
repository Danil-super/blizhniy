import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/lib/category-store.ts', import.meta.url), 'utf8');
const start = source.indexOf('type CategoryRow =');
const end = source.indexOf('\nfunction withRequiredFallbackCategories', start);
assert.ok(start >= 0 && end > start, 'public category mapper should be present');
const mapper = `${source.slice(start, end)}\nexports.mapPublicCategoryRows = mapPublicCategoryRows;`;

function mapPublicCategoryRows(rows) {
  const exports = {};
  const js = ts.transpileModule(mapper, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports, Map });
  return exports.mapPublicCategoryRows(rows);
}

test('public category scope preserves parent and every direct child ID while visible children stay public', () => {
  const categories = mapPublicCategoryRows([
    { id: 'root', slug: 'target', name: 'Target', active: true, sort_order: 10 },
    { id: 'active-child', slug: 'active', name: 'Active', parent_id: 'root', active: true, sort_order: 10 },
    { id: 'inactive-child', slug: 'inactive', name: 'Inactive', parent_id: 'root', active: false, sort_order: 20 },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(categories)), [
    {
      children: ['Active'],
      listingScope: {
        children: [
          { id: 'active-child', name: 'Active' },
          { id: 'inactive-child', name: 'Inactive' },
        ],
        id: 'root',
      },
      name: 'Target',
      slug: 'target',
    },
  ]);
});
