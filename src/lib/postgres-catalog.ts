import { mapPublicCategoryRows } from "./category-contract";
import type { CategoryRow, PublicCategoryWithListingScope } from "./category-contract";
import type { PostgresQueries } from "./postgres";
import type { Category } from "./types";

const categoryColumns = "id, parent_id, slug, name, sort_order, active";

export class CatalogInputError extends Error {
  constructor() { super("Invalid catalog input"); this.name = "CatalogInputError"; }
}

/** Server-side reads only. No writes, hidden legacy fallback or startup connection. */
export class PostgresCatalogRepository {
  private readonly db: PostgresQueries;

  constructor(db: PostgresQueries) {
    if (typeof window !== "undefined") throw new Error("Catalog is server-only");
    this.db = db;
  }

  async getPublicCategoriesWithListingScope(): Promise<PublicCategoryWithListingScope[]> {
    // All direct children are needed for listingScope, including inactive ones.
    const { rows } = await this.db.query<CategoryRow>(`select ${categoryColumns} from app.categories`);
    return mapPublicCategoryRows(rows);
  }

  async getPublicCategories(): Promise<Category[]> {
    return (await this.getPublicCategoriesWithListingScope())
      .map(({ children, name, slug }) => ({ children, name, slug }));
  }

  async getPublicCategoryWithListingScope(slug: string): Promise<PublicCategoryWithListingScope | undefined> {
    if (typeof slug !== "string" || slug.length > 150 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      throw new CatalogInputError();
    }
    // Resolve the public root and its children in one statement/snapshot.
    const { rows } = await this.db.query<CategoryRow>(`with root as (
      select id from app.categories where slug=$1 and parent_id is null and active
    ) select ${categoryColumns} from app.categories
      where id in (select id from root) or parent_id in (select id from root)`, [slug]);
    return mapPublicCategoryRows(rows)[0];
  }
}
