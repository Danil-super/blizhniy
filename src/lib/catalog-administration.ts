import { withAdminTransaction } from "./admin-authorization";
import type { CategoryRow } from "./category-contract";
import type { PostgresDatabase } from "./postgres";

export class CategoryEditInputError extends Error {
  constructor() { super("Invalid category edit"); this.name = "CategoryEditInputError"; }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function edit(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CategoryEditInputError();
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (!Object.hasOwn(value, "id") || typeof value.id !== "string" || !uuid.test(value.id) || keys.length < 2 ||
      keys.some(key => !["id", "name", "sortOrder", "active"].includes(key))) throw new CategoryEditInputError();
  let name: string | null = null;
  let sortOrder: number | null = null;
  let active: boolean | null = null;
  if (Object.hasOwn(value, "name")) {
    if (typeof value.name !== "string" || !value.name.isWellFormed() || /[\x00-\x1f\x7f]/.test(value.name)) throw new CategoryEditInputError();
    name = value.name.trim();
    if (!name || name.length > 200) throw new CategoryEditInputError();
  }
  if (Object.hasOwn(value, "sortOrder")) {
    if (typeof value.sortOrder !== "number" || !Number.isSafeInteger(value.sortOrder) || value.sortOrder < 0 || value.sortOrder > 1000000) throw new CategoryEditInputError();
    sortOrder = value.sortOrder;
  }
  if (Object.hasOwn(value, "active")) {
    if (typeof value.active !== "boolean") throw new CategoryEditInputError();
    active = value.active;
  }
  return { id: value.id, name, sortOrder, active };
}

/** Existing rows only. Stable slugs, hierarchy and identities cannot be changed here. */
export class CatalogAdministration {
  constructor(private readonly db: Pick<PostgresDatabase, "transaction">) {
    if (typeof window !== "undefined") throw new Error("Category administration is server-only");
  }

  async updateCategory(token: string, input: unknown): Promise<CategoryRow | undefined> {
    const value = edit(input);
    return withAdminTransaction(this.db, token, async tx => {
      const { rows } = await tx.query<CategoryRow>(`update app.categories
        set name=coalesce($2::text,name),sort_order=coalesce($3::integer,sort_order),active=coalesce($4::boolean,active)
        where id=$1 returning id,parent_id,slug,name,sort_order,active`, [value.id, value.name, value.sortOrder, value.active]);
      return rows[0];
    });
  }

  async reorderCategories(token: string, input: unknown): Promise<void> {
    if (!Array.isArray(input) || input.length < 1 || input.length > 1000 ||
        [...input].some(id => typeof id !== "string" || !uuid.test(id)) || new Set(input).size !== input.length) throw new CategoryEditInputError();
    // Copy before the first await so the caller cannot mutate the validated order.
    const ids: string[] = [...input];
    await withAdminTransaction(this.db, token, async tx => {
      const { rows } = await tx.query<{ id: string }>("select id from app.categories where parent_id is null order by id for update");
      const roots = new Set(rows.map(row => row.id));
      if (roots.size !== ids.length || ids.some(id => !roots.has(id))) throw new CategoryEditInputError();
      await tx.query(`update app.categories c set sort_order=(ordered.rank*10)::integer
        from unnest($1::uuid[]) with ordinality as ordered(id,rank) where c.id=ordered.id`, [ids]);
    });
  }
}
