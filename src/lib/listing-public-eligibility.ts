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
