import { categories as fallbackCategories } from "@/lib/data";
import { isProductionRuntime, shouldShowFallbackContent } from "@/lib/runtime-mode";
import { isSupabaseRestConfigured, isUuid, supabaseRest } from "@/lib/supabase-rest";
import type { Category } from "@/lib/types";

export type AdminCategoryRow = {
  active: boolean;
  children: Array<{ active: boolean; id: string; name: string; slug: string; sortOrder: number }>;
  href: string;
  id: string;
  name: string;
  parentId?: string;
  parentName?: string;
  slug: string;
  sortOrder: number;
};

type CategoryRow = {
  active: boolean;
  id: string;
  name: string;
  parent_id?: string | null;
  slug: string;
  sort_order?: number | null;
};

type UpdateCategoryInput = {
  active?: boolean;
  id: string;
  name?: string;
  sortOrder?: number;
};

function mapCategoryRows(rows: CategoryRow[]): AdminCategoryRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childrenByParentId = new Map<string, CategoryRow[]>();

  for (const row of rows) {
    if (!row.parent_id) {
      continue;
    }

    childrenByParentId.set(row.parent_id, [...(childrenByParentId.get(row.parent_id) ?? []), row]);
  }

  return rows
    .filter((row) => !row.parent_id)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.name.localeCompare(right.name, "ru"))
    .map((row) => ({
      active: row.active,
      children: [...(childrenByParentId.get(row.id) ?? [])]
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.name.localeCompare(right.name, "ru"))
        .map((child) => ({
          active: child.active,
          id: child.id,
          name: child.name,
          slug: child.slug,
          sortOrder: child.sort_order ?? 0,
        })),
      href: `/katalog/${row.slug}`,
      id: row.id,
      name: row.name,
      parentId: row.parent_id ?? undefined,
      parentName: row.parent_id ? byId.get(row.parent_id)?.name : undefined,
      slug: row.slug,
      sortOrder: row.sort_order ?? 0,
    }));
}

function mapPublicCategoryRows(rows: CategoryRow[]): Category[] {
  const activeRows = rows.filter((row) => row.active);
  const childrenByParentId = new Map<string, CategoryRow[]>();

  for (const row of activeRows) {
    if (!row.parent_id) {
      continue;
    }

    childrenByParentId.set(row.parent_id, [...(childrenByParentId.get(row.parent_id) ?? []), row]);
  }

  return activeRows
    .filter((row) => !row.parent_id)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.name.localeCompare(right.name, "ru"))
    .map((row) => ({
      children: [...(childrenByParentId.get(row.id) ?? [])]
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.name.localeCompare(right.name, "ru"))
        .map((child) => child.name),
      name: row.name,
      slug: row.slug,
    }));
}

export async function listAdminCategories() {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  const rows = await supabaseRest<CategoryRow[]>("/rest/v1/categories?select=id,parent_id,slug,name,sort_order,active&order=sort_order.asc,name.asc");

  return mapCategoryRows(rows);
}

export async function getPublicCategories(): Promise<Category[]> {
  if (!isSupabaseRestConfigured()) {
    return shouldShowFallbackContent() ? fallbackCategories : [];
  }

  try {
    const rows = await supabaseRest<CategoryRow[]>("/rest/v1/categories?select=id,parent_id,slug,name,sort_order,active&order=sort_order.asc,name.asc");
    const categories = mapPublicCategoryRows(rows);

    if (categories.length || !shouldShowFallbackContent()) {
      return categories;
    }
  } catch (error) {
    if (isProductionRuntime()) {
      throw error;
    }
  }

  return fallbackCategories;
}

export async function updateAdminCategory(input: UpdateCategoryInput) {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  if (!isUuid(input.id)) {
    return undefined;
  }

  const body: Record<string, unknown> = {};

  if (typeof input.active === "boolean") {
    body.active = input.active;
  }

  if (typeof input.name === "string") {
    body.name = input.name.trim();
  }

  if (typeof input.sortOrder === "number") {
    body.sort_order = input.sortOrder;
  }

  if (!Object.keys(body).length || body.name === "") {
    return undefined;
  }

  const rows = await supabaseRest<CategoryRow[]>(`/rest/v1/categories?select=id,parent_id,slug,name,sort_order,active&id=eq.${encodeURIComponent(input.id)}`, {
    body,
    method: "PATCH",
    prefer: "return=representation",
  });

  return rows[0];
}

export async function updateAdminCategoryOrder(ids: string[]) {
  if (!isSupabaseRestConfigured()) {
    throw new Error("Supabase env is not configured");
  }

  const validIds = ids.filter(isUuid);

  await Promise.all(
    validIds.map((id, index) =>
      supabaseRest(`/rest/v1/categories?id=eq.${encodeURIComponent(id)}`, {
        body: {
          sort_order: (index + 1) * 10,
        },
        method: "PATCH",
        prefer: "return=minimal",
      }),
    ),
  );

  return listAdminCategories();
}
