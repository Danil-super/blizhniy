begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create schema app_publication_privacy;
revoke all on schema app_publication_privacy from public;
create table app_publication_privacy.location_withdrawals(
 kind text not null check(kind in ('listing','vacancy','workRequest','specialist','fair')),
 publication_id uuid not null,
 withdrawn_at timestamptz not null default clock_timestamp() check(isfinite(withdrawn_at)),
 primary key(kind,publication_id)
);
revoke all on app_publication_privacy.location_withdrawals from public;

-- A withdrawal is independent of the editable or paid revision.
create function app_publication_privacy.withdraw_location(p_hash text,p_actor uuid,p_kind text,p_publication uuid)
 returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 actor_version bigint;
 session_expires timestamptz;
 session_seen timestamptz;
 receipt timestamptz;
begin
 if session_user<>'blizhniy_runtime' or current_setting('transaction_isolation')<>'read committed'
  or p_hash is null or octet_length(p_hash)<>64 or p_hash !~ '^[a-f0-9]+$' or p_actor is null then
  raise exception using errcode='PDW01',message='Publication owner required';
 end if;
 if p_publication is null or p_kind is null or p_kind not in ('listing','vacancy','workRequest','specialist','fair') then
  raise exception using errcode='PDW02',message='Invalid publication';
 end if;

 select u.auth_version into actor_version from app.users u
  where u.id=p_actor and u.email_verified_at is not null and not u.is_blocked
   and exists(select 1 from app.sessions s where s.token_hash=p_hash and s.user_id=u.id and s.scope='app')
  for update of u;
 if not found then raise exception using errcode='PDW01',message='Publication owner required';end if;
 select s.expires_at,s.last_seen_at into session_expires,session_seen from app.sessions s
  where s.token_hash=p_hash and s.user_id=p_actor and s.auth_version=actor_version and s.scope='app' for update;
 if not found or session_expires<=clock_timestamp() or session_seen<=clock_timestamp()-interval '30 minutes' then
  raise exception using errcode='PDW01',message='Publication owner required';
 end if;

 case
  when p_kind='listing' then
   perform 1 from app.listings l where l.id=p_publication and l.author_id=p_actor and l.status<>'removed' for update;
  when p_kind in ('vacancy','workRequest') then
   perform 1 from app.work_publications w
    where w.id=p_publication and w.author_id=p_actor and w.kind=p_kind and w.deleted_at is null for update;
  else
   perform 1 from app.service_publications s
    where s.id=p_publication and s.author_id=p_actor and s.kind=p_kind and s.deleted_at is null for update;
 end case;
 if not found then raise exception using errcode='PDW02',message='Invalid publication';end if;
 if p_kind='listing' and exists(select 1 from app.listing_owner_removals x where x.listing_id=p_publication) then
  raise exception using errcode='PDW02',message='Invalid publication';
 end if;

 insert into app_publication_privacy.location_withdrawals(kind,publication_id)
  values(p_kind,p_publication) on conflict do nothing;
 select w.withdrawn_at into strict receipt from app_publication_privacy.location_withdrawals w
  where w.kind=p_kind and w.publication_id=p_publication;
 if session_expires<=clock_timestamp() or session_seen<=clock_timestamp()-interval '30 minutes' then
  raise exception using errcode='PDW01',message='Publication owner required';
 end if;
 return to_char(receipt at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
end;
$$;
revoke all on function app_publication_privacy.withdraw_location(text,uuid,text,uuid) from public;
grant usage on schema app_publication_privacy to blizhniy_runtime;
grant select(kind,publication_id) on app_publication_privacy.location_withdrawals to blizhniy_runtime;
grant execute on function app_publication_privacy.withdraw_location(text,uuid,text,uuid) to blizhniy_runtime;
commit;
