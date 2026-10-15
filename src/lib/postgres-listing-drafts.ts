import { createHash } from "node:crypto";
import { withAppSessionTransaction } from "./app-session-transaction";
import { ListingDraftInputError, parseListingDraft, parseListingDraftCursor, parseListingDraftId, parseListingDraftRevision } from "./listing-draft-contract";
import type { ListingDraftInput, ListingDraftSnapshot, ListingDraftPage } from "./listing-draft-contract";
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
  /** Stable blank-resource intent only: editable content is saved separately using revision CAS. */
  async createEmpty(token: string, expectedOwnerId: string, creationKey: unknown): Promise<ListingDraftSnapshot> {
    return withAppSessionTransaction(this.db, token, async (tx, user) => {
      if (user.id !== expectedOwnerId) throw new ListingDraftAccessError();
      const key = parseListingDraftId(creationKey);
      // RFC9562 UUIDv8 with a versioned, owner-scoped SHA256 namespace. Not an authorization capability.
      const bytes = createHash("sha256").update(`blizhniy-listing-creation:v1\0${user.id}\0${key}`).digest().subarray(0, 16);
      bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
      const hex = bytes.toString("hex");
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const inserted = await tx.query<DraftRow>(`insert into app.listings(id,author_id,listing_type) values($1,$2,'sell')
        on conflict(id) do nothing returning ${columns}`, [id, user.id]);
      const row = inserted.rows[0] ?? (await tx.query<DraftRow>(`select ${columns} from app.listings
        where id=$1 and author_id=$2 and status='draft'`, [id, user.id])).rows[0];
      if (!row) throw new ListingDraftAccessError();
      return snapshot(row);
    });
  }
  async list(token: string, expectedOwnerId: string, after: unknown): Promise<ListingDraftPage> {
    return withAppSessionTransaction(this.db, token, async (tx, user) => {
      if (user.id !== expectedOwnerId) throw new ListingDraftAccessError();
      const cursor = parseListingDraftCursor(after);
      type SummaryRow = Pick<DraftRow, "id" | "revision" | "listingType" | "title" | "price"> & { updatedAt: string };
      const rows = (await tx.query<SummaryRow>(`select id,revision::text as revision,listing_type as "listingType",title,price::text as price,
        to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt" from app.listings
        where author_id=$1 and status='draft' ${cursor ? "and (updated_at,id)<($2::timestamptz,$3::uuid)" : ""}
        order by updated_at desc,id desc limit 21`, cursor ? [user.id, cursor.updatedAt, cursor.id] : [user.id])).rows;
      const page = rows.slice(0, 20), last = page.at(-1);
      return { items: page.map(row => ({ id: row.id, revision: row.revision, kind: kinds[row.listingType], title: row.title, price: row.price })),
        nextCursor: rows.length > 20 && last ? { id: last.id, updatedAt: last.updatedAt } : null };
    });
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
