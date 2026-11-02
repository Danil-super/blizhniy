-- Operator-only local rollback. Removing this fence reopens concurrent editing;
-- never invoke it automatically or while checkout traffic is admitted.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
drop trigger work_checkout_photo_fence on app.work_publication_photos;
drop trigger listing_checkout_photo_fence on app.listing_photos;
drop function app.guard_checkout_photo_edit();
drop trigger work_checkout_edit_fence on app.work_publications;
drop trigger listing_checkout_edit_fence on app.listings;
drop function app.guard_checkout_edit();
commit;
