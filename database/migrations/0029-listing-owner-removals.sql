-- Local opt-in only. Cabinet deletion is an immutable tombstone, not a financial or moderation mutation.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.listing_owner_removals (
 listing_id uuid primary key references app.listings(id) on delete cascade,
 owner_id uuid not null references app.users(id) on delete cascade,
 removed_revision bigint not null check (removed_revision>=1),
 removed_at timestamptz not null default clock_timestamp() check (isfinite(removed_at))
);
create index listing_owner_removals_owner_idx on app.listing_owner_removals(owner_id);
create function app.guard_listing_owner_removal() returns trigger language plpgsql
set search_path=pg_catalog,app as $$
declare item record;
begin
 if tg_op<>'INSERT' then
  -- The account-erasure cascade may remove this marker; web runtime may not.
  if current_user='blizhniy_runtime' then raise exception 'Listing removal is immutable' using errcode='42501';end if;
  if tg_op='DELETE' then return old;end if;
  raise exception 'Listing removal is immutable' using errcode='42501';
 end if;
 select author_id,revision into item from app.listings where id=new.listing_id for update;
 if not found or item.author_id<>new.owner_id or item.revision<>new.removed_revision
  or not exists(select 1 from app.listing_blocks where listing_id=new.listing_id)
 then raise exception 'Only an owner blocked listing can be removed' using errcode='42501';end if;
 return new;
end;
$$;
revoke all on function app.guard_listing_owner_removal() from public;
create trigger listing_owner_removal_guard before insert or update or delete on app.listing_owner_removals
for each row execute function app.guard_listing_owner_removal();
revoke all on app.listing_owner_removals from public;
commit;
