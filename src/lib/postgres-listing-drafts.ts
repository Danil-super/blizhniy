import { withAppSessionTransaction } from "./app-session-transaction";
import { ListingDraftInputError, parseListingDraft, parseListingDraftId, parseListingDraftRevision } from "./listing-draft-contract";
import type { ListingDraftInput, ListingDraftSnapshot } from "./listing-draft-contract";
import type { PostgresDatabase } from "./postgres";

export class ListingDraftAccessError extends Error {
  constructor() { super("Listing draft access required"); this.name = "ListingDraftAccessError"; }
}
export class ListingDraftConflictError extends Error {
  constructor() { super("Listing draft changed"); this.name = "ListingDraftConflictError"; }
}
const dbKinds = { prodam: "sell", kuplyu: "buy", "otdam-darom": "free", arenda: "rent" } as const;
const kinds = { sell: "prodam", buy: "kuplyu", free: "otdam-darom", rent: "arenda" } as const;
type DraftRow = Omit<ListingDraftInput, "kind"> & { id: string; revision: string; listingType: keyof typeof kinds };
const columns = `id,revision::text as revision,listing_type as "listingType",category_id as "categoryId",
  city_id as "cityId",title,description,price::text as price`;
function snapshot(row: DraftRow): ListingDraftSnapshot {
  return { id: row.id, revision: row.revision, draft: { kind: kinds[row.listingType],
    title: row.title, description: row.description, categoryId: row.categoryId, cityId: row.cityId, price: row.price } };
}
async function withReferenceErrors<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23503") throw new ListingDraftInputError();
    throw error;
  }
}

/** Owner-only draft core. No public reads, billing writes, fallback or automatic retries. */
export class PostgresListingDraftStore {
  constructor(private readonly db: Pick<PostgresDatabase, "transaction">) {
    if (typeof window !== "undefined") throw new Error("Listing draft storage is server-only");
  }
  /** Creates a server-generated ID. A lost COMMIT reply is unknown; this operation is unsafe to retry. */
  async create(token: string, expectedOwnerId: string, input: unknown): Promise<ListingDraftSnapshot> {
    return withReferenceErrors(() => withAppSessionTransaction(this.db, token, async (tx, user) => {
      if (user.id !== expectedOwnerId) throw new ListingDraftAccessError();
      const draft = parseListingDraft(input);
      const saved = await tx.query<DraftRow>(`insert into app.listings
        (author_id,listing_type,category_id,city_id,title,description,price) values($1,$2,$3,$4,$5,$6,$7) returning ${columns}`,
      [user.id, dbKinds[draft.kind], draft.categoryId, draft.cityId, draft.title, draft.description, draft.price]);
      if (saved.rowCount !== 1 || !saved.rows[0]) throw new Error("Listing draft creation unavailable");
      return snapshot(saved.rows[0]);
    }));
  }
  async read(token: string, expectedOwnerId: string, listingId: unknown): Promise<ListingDraftSnapshot> {
    return withAppSessionTransaction(this.db, token, async (tx, user) => {
      if (user.id !== expectedOwnerId) throw new ListingDraftAccessError();
      const id = parseListingDraftId(listingId);
      const row = (await tx.query<DraftRow>(`select ${columns} from app.listings
        where id=$1 and author_id=$2 and status='draft'`, [id, user.id])).rows[0];
      if (!row) throw new ListingDraftAccessError();
      return snapshot(row);
    });
  }
  /** Replaces only core fields; requires explicit readback after conflict or unknown outcome. */
  async update(token: string, expectedOwnerId: string, listingId: unknown, expectedRevision: unknown, input: unknown): Promise<ListingDraftSnapshot> {
    return withReferenceErrors(() => withAppSessionTransaction(this.db, token, async (tx, user) => {
      if (user.id !== expectedOwnerId) throw new ListingDraftAccessError();
      const id = parseListingDraftId(listingId), revision = parseListingDraftRevision(expectedRevision), draft = parseListingDraft(input);
      const current = (await tx.query<DraftRow>(`select ${columns} from app.listings
        where id=$1 and author_id=$2 and status='draft' for update`, [id, user.id])).rows[0];
      if (!current) throw new ListingDraftAccessError();
      if (current.revision !== revision || revision === "9223372036854775807") throw new ListingDraftConflictError();
      const saved = await tx.query<DraftRow>(`update app.listings set listing_type=$3,category_id=$4,city_id=$5,
        title=$6,description=$7,price=$8,revision=revision+1,updated_at=clock_timestamp()
        where id=$1 and author_id=$2 and status='draft' and revision=$9::bigint returning ${columns}`,
      [id, user.id, dbKinds[draft.kind], draft.categoryId, draft.cityId, draft.title, draft.description, draft.price, revision]);
      if (saved.rowCount !== 1 || !saved.rows[0]) throw new ListingDraftConflictError();
      return snapshot(saved.rows[0]);
    }));
  }
}
