begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create schema app_publication_privacy;
revoke all on schema app_publication_privacy from public;
create table app_publication_privacy.location_withdrawals(
 kind text not null check(kind in ('listing','vacancy','workRequest','specialist','fair','marquee')),
 publication_id uuid not null,
 withdrawn_at timestamptz not null default clock_timestamp() check(isfinite(withdrawn_at)),
 scope text not null default 'location' check(scope='publication' or scope='location' and kind<>'marquee'
  or scope='avatar' and kind='specialist'
  or kind in ('listing','vacancy','workRequest','fair') and scope ~ '^photo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 primary key(kind,publication_id,scope)
);
revoke all on app_publication_privacy.location_withdrawals from public;

-- A withdrawal is independent of the editable or paid revision.
create function app_publication_privacy.withdraw_location(p_hash text,p_actor uuid,p_kind text,p_publication uuid,p_apply boolean default true,p_scope text default 'location')
 returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 actor_version bigint;
 session_expires timestamptz;
 session_seen timestamptz;
 receipt timestamptz;
 photos jsonb;
begin
 if session_user<>'blizhniy_runtime' or current_setting('transaction_isolation')<>'read committed'
  or p_hash is null or octet_length(p_hash)<>64 or p_hash !~ '^[a-f0-9]+$' or p_actor is null then
  raise exception using errcode='PDW01',message='Publication owner required';
 end if;
 if p_publication is null or p_apply is null or p_kind is null or p_kind not in ('listing','vacancy','workRequest','specialist','fair','marquee')
  or p_scope is null or not (p_scope='publication' or p_scope='location' and p_kind<>'marquee'
   or p_scope='photos' and not p_apply and p_kind<>'marquee'
   or p_scope='avatar' and p_kind='specialist'
   or p_kind in ('listing','vacancy','workRequest','fair') and p_scope ~ '^photo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
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

 if p_scope='photos' or p_scope='avatar' or p_scope like 'photo:%' then
  select coalesce(jsonb_agg(jsonb_build_object('id',item.id,'withdrawnAt',
   to_char(hidden.withdrawn_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by item.position),'[]'::jsonb)
  into photos
  from (
   select m.id::text as id,position,'photo:'||m.id::text as scope
    from app.listing_photos p join app.media_objects m on m.id=p.media_id and m.owner_id=p_actor and m.state='ready'
    where p_kind='listing' and p.listing_id=p_publication
   union all
   select m.id::text,position,'photo:'||m.id::text
    from app.work_publication_photos p join app.media_objects m on m.id=p.media_id and m.owner_id=p_actor and m.state='ready'
    where p_kind in ('vacancy','workRequest') and p.publication_id=p_publication
   union all
   select m.id::text,position,'photo:'||m.id::text
    from app.service_publication_photos p join app.media_objects m on m.id=p.media_id and m.owner_id=p_actor and m.state='ready'
    where p_kind='fair' and p.publication_id=p_publication
   union all
   select 'avatar',0,'avatar' where p_kind='specialist' and (
    exists(select 1 from app.cabinet_profiles p where p.user_id=p_actor and coalesce(p.profile->>'avatarDataUrl','')<>'')
    or exists(select 1 from app_publication_privacy.location_withdrawals a where a.kind=p_kind and a.publication_id=p_publication and a.scope='avatar'))
  ) item
  left join app_publication_privacy.location_withdrawals hidden
   on hidden.kind=p_kind and hidden.publication_id=p_publication and hidden.scope=item.scope
  where p_scope='photos' or p_scope=item.scope;
  if jsonb_array_length(photos)>10000 then
   raise exception using errcode='PDW02',message='Invalid publication';
  end if;
  if p_scope<>'photos' and jsonb_array_length(photos)=0 and not exists(
   select 1 from app_publication_privacy.location_withdrawals w where w.kind=p_kind and w.publication_id=p_publication and w.scope=p_scope
  ) then raise exception using errcode='PDW02',message='Invalid publication photo';end if;
 end if;
 if p_apply then
  insert into app_publication_privacy.location_withdrawals(kind,publication_id,scope)
   values(p_kind,p_publication,p_scope) on conflict do nothing;
 end if;
 select w.withdrawn_at into receipt from app_publication_privacy.location_withdrawals w
  where w.kind=p_kind and w.publication_id=p_publication and w.scope=p_scope;
 if session_expires<=clock_timestamp() or session_seen<=clock_timestamp()-interval '30 minutes' then
  raise exception using errcode='PDW01',message='Publication owner required';
 end if;
 if p_scope='photos' then return jsonb_build_object('photos',photos);end if;
 return jsonb_build_object('withdrawnAt',to_char(receipt at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
revoke all on function app_publication_privacy.withdraw_location(text,uuid,text,uuid,boolean,text) from public;
grant usage on schema app_publication_privacy to blizhniy_runtime;
grant select(kind,publication_id,scope) on app_publication_privacy.location_withdrawals to blizhniy_runtime;
grant execute on function app_publication_privacy.withdraw_location(text,uuid,text,uuid,boolean,text) to blizhniy_runtime;
commit;
