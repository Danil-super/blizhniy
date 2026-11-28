import type { PostgresQueries } from './postgres';
import {hasLocationWithdrawalSchema,publicationWithdrawalEligibility} from './publication-location-withdrawal';

/** Fixed SQL fragments shared by public cards and booking admission. Never accept SQL or names from callers. */
export const publicListingSource=`from app.listings l
 join app.users author on author.id=l.author_id and not author.is_blocked and author.email_verified_at is not null
 join app.categories c on c.id=l.category_id and c.active left join app.categories parent on parent.id=c.parent_id
 join app.cities city on city.id=l.city_id
 join app.listing_moderation review on review.listing_id=l.id and review.revision=l.revision and review.state='approved'`;
export const publicListingLive=`l.status='published' and l.is_paid and l.published_at<=clock_timestamp() and l.expires_at>clock_timestamp()
 and (c.parent_id is null or parent.active is true)`;
// Every caller binds the existing per-listing byte budget at $2; incomplete or foreign photo sets fail as a whole.
export const publicListingPhotos=`not exists(select 1 from app.listing_photos p left join app.media_objects m on m.id=p.media_id
 where p.listing_id=l.id and (m.id is null or m.owner_id<>l.author_id or m.state<>'ready'))
 and (select count(*)<=10000 and coalesce(sum(m.size),0)<=$2 from app.listing_photos p join app.media_objects m on m.id=p.media_id where p.listing_id=l.id)`;
/** Schema0026 is opt-in. The old public gate remains the default on existing deployments. */
export const postmoderationListingSource=`from app.listings l
 join app.users author on author.id=l.author_id and not author.is_blocked and author.email_verified_at is not null
 join app.categories c on c.id=l.category_id and c.active left join app.categories parent on parent.id=c.parent_id
 join app.cities city on city.id=l.city_id`;
export const postmoderationListingLive=`${publicListingLive} and not exists(select 1 from app.listing_blocks block where block.listing_id=l.id)`;


export type ListingVisibilityPolicy = { postmoderation?: boolean; enforceBlocks?: boolean; enforceLocationWithdrawals?: boolean };

export function listingVisibility({ postmoderation, enforceBlocks, enforceLocationWithdrawals }: ListingVisibilityPolicy) {
 return {
  source: postmoderation ? postmoderationListingSource : publicListingSource,
  eligible: `${postmoderation || enforceBlocks ? postmoderationListingLive : publicListingLive} and ${publicListingPhotos}${publicationWithdrawalEligibility('l',enforceLocationWithdrawals)}`,
 };
}

// Older schemas have no block table. Once installed, the record takes precedence in either workflow.
export async function readListingVisibilityPolicy(db: PostgresQueries, postmoderation: boolean): Promise<ListingVisibilityPolicy> {
 const enforceLocationWithdrawals=await hasLocationWithdrawalSchema(db);
 if (postmoderation) return { postmoderation, enforceBlocks: true, enforceLocationWithdrawals };
 const row = (await db.query<{ installed: boolean }>(
  "select to_regclass('app.listing_blocks') is not null as installed", [], "bounded-read",
 )).rows[0];
 if (typeof row?.installed !== 'boolean') throw new Error('Listing block capability unavailable');
 return { postmoderation, enforceBlocks: row.installed, enforceLocationWithdrawals };
}
