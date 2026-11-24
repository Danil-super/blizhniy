-- Separate export-only lookup. It requires the approved reader role and leaves app_stats grants unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $$ begin
 if current_database()<>'blizhniy_prod' or current_user<>session_user
  or not exists(select 1 from pg_namespace where nspname='app_stats' and nspowner=(current_user::regrole)::oid) then
  raise exception 'Listing view export requires the production database owner';
 end if;
end $$;

create schema app_export;
revoke all on schema app_export from public;
create function app_export.match_listing_views(ids uuid[], digests bytea[])
returns table(listing_id uuid)
language sql stable strict security definer set search_path=pg_catalog,pg_temp as $$
 select v.listing_id
 from unnest(ids,digests) as candidate(id,digest)
 join app_stats.listing_views v on v.listing_id=candidate.id and v.viewer_digest=candidate.digest
 where cardinality(ids) between 1 and 500 and cardinality(ids)=cardinality(digests)
 order by v.listing_id
$$;
revoke all on function app_export.match_listing_views(uuid[],bytea[]) from public;
grant usage on schema app_export to blizhniy_account_export_reader;
grant execute on function app_export.match_listing_views(uuid[],bytea[]) to blizhniy_account_export_reader;

-- Default grants on the owning role must not expose this lookup.
do $$ begin
 if exists (
  select 1 from (
   select nspowner as owner,nspacl as grants from pg_namespace where nspname='app_export'
   union all
   select proowner,proacl from pg_proc where oid='app_export.match_listing_views(uuid[],bytea[])'::regprocedure
  ) objects cross join lateral aclexplode(grants) acl
  where acl.grantee<>objects.owner
   and (acl.grantee<>'blizhniy_account_export_reader'::regrole or acl.is_grantable or acl.grantor<>objects.owner)
 ) then raise exception 'Unexpected listing view export permissions'; end if;
end $$;
commit;
