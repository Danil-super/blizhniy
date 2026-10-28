-- Refuse to forget a user's removal decision; rollback is safe only before first use.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $$begin
 if exists(select 1 from app.listing_owner_removals) then
  raise exception 'Listing removal decisions must be preserved' using errcode='23514';
 end if;
end;$$;
drop table app.listing_owner_removals;
drop function app.guard_listing_owner_removal();
commit;
