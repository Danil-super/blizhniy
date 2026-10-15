-- Additive associations only. Ownership/ready-state authorization belongs to the guarded repository.
-- No grants, file operations, quota release or automatic deployment migration.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.listing_photos (
  listing_id uuid not null references app.listings(id) on delete cascade,
  media_id uuid not null references app.media_objects(id) on delete restrict,
  -- Existing global media object budget is 10000; this is not a new product photo-count limit.
  position integer not null check(position between 0 and 9999),
  primary key(listing_id,position),
  unique(listing_id,media_id)
);
create index listing_photos_media_idx on app.listing_photos(media_id);
revoke all on app.listing_photos from public;
commit;
