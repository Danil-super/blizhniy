begin;
set local lock_timeout='3s';
revoke update(status) on app.listings from blizhniy_runtime;
drop trigger listing_owner_visibility_guard on app.listings;
drop function app.guard_listing_owner_visibility();
commit;
