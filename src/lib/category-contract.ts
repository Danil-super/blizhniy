import type { Category } from "./types";

export type CategoryRow = {
  active: boolean;
  id: string;
  name: string;
  parent_id?: string | null;
  slug: string;
  sort_order?: number | null;
};

export type PublicCategoryListingScope = {
  children: Array<{ id: string; name: string }>;
  id: string;
};

export type PublicCategoryWithListingScope = Category & {
  listingScope?: PublicCategoryListingScope;
};

// Shared by the old store and the PostgreSQL replacement during migration.
export function mapPublicCategoryRows(rows: CategoryRow[]): PublicCategoryWithListingScope[] {
  const activeRows = rows.filter((row) => row.active);
  const activeChildrenByParentId = new Map<string, CategoryRow[]>();
  const allChildrenByParentId = new Map<string, CategoryRow[]>();

  for (const row of rows) {
    if (!row.parent_id) {
      continue;
    }

    allChildrenByParentId.set(row.parent_id, [...(allChildrenByParentId.get(row.parent_id) ?? []), row]);
  }

  for (const row of activeRows) {
    if (!row.parent_id) {
      continue;
    }

    activeChildrenByParentId.set(row.parent_id, [...(activeChildrenByParentId.get(row.parent_id) ?? []), row]);
  }

  return activeRows
    .filter((row) => !row.parent_id)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.name.localeCompare(right.name, "ru"))
    .map((row) => ({
      children: Array.from(new Set(
        [...(activeChildrenByParentId.get(row.id) ?? [])]
          .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.name.localeCompare(right.name, "ru"))
          .map((child) => child.name),
      )),
      // Search includes hidden direct children; the visible menu does not.
      listingScope: {
        children: [...(allChildrenByParentId.get(row.id) ?? [])]
          .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.name.localeCompare(right.name, "ru"))
          .map((child) => ({ id: child.id, name: child.name })),
        id: row.id,
      },
      name: row.name,
      slug: row.slug,
    }));
}
