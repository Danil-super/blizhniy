import { createHmac } from "node:crypto";
import type { PostgresQueries } from "./postgres";

export function listingViewDigest(secret: string, listingId: string, viewer: string): Buffer {
  return createHmac("sha256", secret).update(`listing-view:${listingId.toLowerCase()}:${viewer}`).digest();
}

/** 0066 keys include the listing ID, so look up each listing in one bounded snapshot. */
export async function readAccountListingViews(tx: PostgresQueries, ownerId: string, secret: string | undefined,
  access: "direct" | "approved-export" = "direct",
) {
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new Error("Listing view key unavailable");
  const size = 500;
  const views: Array<{ listing_id: string }> = [];
  let after: string | undefined;
  for (;;) {
    const page = await tx.query<{ id: string }>(after
      ? "select id from app.listings where id>$1 order by id limit $2"
      : "select id from app.listings order by id limit $1", after ? [after, size] : [size]);
    const ids = page.rows.map(row => row.id);
    if (ids.length === 0) return views;
    const digests = ids.map(id => listingViewDigest(secret, id, "user:" + ownerId));
    const matches = await tx.query<{ listing_id: string }>(access === "approved-export"
      ? "select listing_id from app_export.match_listing_views($1,$2)"
      : `select candidate.id as listing_id
        from unnest($1::uuid[],$2::bytea[]) as candidate(id,digest)
        where exists(select 1 from app_stats.listing_views v where v.listing_id=candidate.id and v.viewer_digest=candidate.digest)
        order by candidate.id`, [ids, digests]);
    views.push(...matches.rows);
    if (ids.length < size) return views;
    after = ids.at(-1);
  }
}
