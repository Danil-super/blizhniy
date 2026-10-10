import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPublicCategoryRows } from '../src/lib/category-contract.ts';

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
