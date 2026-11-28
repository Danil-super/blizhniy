begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create schema app_publication_privacy;
revoke all on schema app_publication_privacy from public;
create function app_publication_privacy.is_text_field(kind text,field text)
 returns boolean language sql immutable strict set search_path=pg_catalog,pg_temp as $$
  select case kind
   when 'listing' then field in ('title','description')
   when 'vacancy' then field in ('title','description','organization','schedule','workFormat','requirements','responsibilities','conditions')
   when 'workRequest' then field in ('title','description')
   when 'specialist' then field in ('description','skills','experience')
   when 'fair' then field in ('title','description')
   when 'marquee' then field='title'
   else false end
 $$;
create table app_publication_privacy.location_withdrawals(
 kind text not null check(kind in ('listing','vacancy','workRequest','specialist','fair','marquee')),
 publication_id uuid not null,
 withdrawn_at timestamptz not null default clock_timestamp() check(isfinite(withdrawn_at)),
 scope text not null default 'location' check(scope='publication' or scope='location' and kind<>'marquee'
  or scope in ('phone','messenger') and kind='listing'
  or scope='name' and kind in ('listing','specialist')
  or scope='avatar' and kind='specialist'
  or kind in ('listing','vacancy','workRequest','fair') and scope ~ '^photo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or scope ~ '^text:[a-zA-Z]+:[0-9a-f]{64}:(0|[1-9][0-9]{0,3}):[1-9][0-9]{0,3}$'
     and app_publication_privacy.is_text_field(kind,split_part(scope,':',2))),
 primary key(kind,publication_id,scope)
);
revoke all on app_publication_privacy.location_withdrawals from public;

-- NULL denotes no withdrawal. An empty value suppresses a changed field in full.
create function app_publication_privacy.public_text(p_kind text,p_publication uuid,p_field text,p_value text)
 returns text language plpgsql stable strict set search_path=pg_catalog,pg_temp as $$
declare
 mask record;
 current_hash text;
 rendered text := '';
 cursor_at integer := 0;
begin
 for mask in select split_part(scope,':',3) as fingerprint,
     split_part(scope,':',4)::integer as start_at,split_part(scope,':',5)::integer as end_at
    from app_publication_privacy.location_withdrawals
    where kind=p_kind and publication_id=p_publication and scope like 'text:'||p_field||':%'
    order by start_at,end_at
 loop
  if current_hash is null then current_hash:=encode(sha256(convert_to(p_value,'UTF8')),'hex');end if;
  if mask.fingerprint<>current_hash or mask.end_at<=mask.start_at or mask.end_at>char_length(p_value) then return '';end if;
  if cursor_at=0 or mask.start_at>cursor_at then
   rendered:=rendered||substr(p_value,cursor_at+1,mask.start_at-cursor_at)||'…';
  end if;
  cursor_at:=greatest(cursor_at,mask.end_at);
 end loop;
 if current_hash is null then return null;end if;
 return rendered||substr(p_value,cursor_at+1);
end;
$$;

-- A withdrawal is independent of the editable or paid revision.
create function app_publication_privacy.withdraw_location(p_hash text,p_actor uuid,p_kind text,p_publication uuid,p_apply boolean default true,p_scope text default 'location')
 returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 actor_version bigint;
 session_expires timestamptz;
 session_seen timestamptz;
 receipt timestamptz;
 photos jsonb;
 fields jsonb;
 texts jsonb;
 field_name text;
 original text;
 start_at integer;
 end_at integer;
begin
 if session_user<>'blizhniy_runtime' or current_setting('transaction_isolation')<>'read committed'
  or p_hash is null or octet_length(p_hash)<>64 or p_hash !~ '^[a-f0-9]+$' or p_actor is null then
  raise exception using errcode='PDW01',message='Publication owner required';
 end if;
 if p_publication is null or p_apply is null or p_kind is null or p_kind not in ('listing','vacancy','workRequest','specialist','fair','marquee')
  or p_scope is null or not (p_scope='publication' or p_scope='location' and p_kind<>'marquee'
   or p_scope in ('phone','messenger') and p_kind='listing'
   or p_scope='name' and p_kind in ('listing','specialist')
   or p_scope='photos' and not p_apply and p_kind<>'marquee'
   or p_scope='avatar' and p_kind='specialist'
   or p_kind in ('listing','vacancy','workRequest','fair') and p_scope ~ '^photo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   or p_scope='texts' and not p_apply
   or p_scope ~ '^text:[a-zA-Z]+:[0-9a-f]{64}:(0|[1-9][0-9]{0,3}):[1-9][0-9]{0,3}$'
      and app_publication_privacy.is_text_field(p_kind,split_part(p_scope,':',2))) then
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
  if p_scope<>'photos' and (p_apply or p_scope<>'avatar') and jsonb_array_length(photos)=0 and not exists(
   select 1 from app_publication_privacy.location_withdrawals w where w.kind=p_kind and w.publication_id=p_publication and w.scope=p_scope
  ) then raise exception using errcode='PDW02',message='Invalid publication photo';end if;
 end if;
 if p_scope='texts' or p_scope like 'text:%' then
  case
   when p_kind='listing' then
    select jsonb_build_object('title',l.title,'description',l.description) into fields from app.listings l where l.id=p_publication;
   when p_kind in ('vacancy','workRequest') then
    select w.form into fields from app.work_publications w where w.id=p_publication;
   else
    select s.form into fields from app.service_publications s where s.id=p_publication;
  end case;
  if p_scope='texts' then
   select coalesce(jsonb_agg(jsonb_build_object('field',value.key,'text',value.val,
    'fingerprint',encode(sha256(convert_to(value.val,'UTF8')),'hex'),
    'visible',coalesce(app_publication_privacy.public_text(p_kind,p_publication,value.key,value.val),value.val)) order by value.key),'[]'::jsonb)
   into texts from jsonb_each_text(fields) as value(key,val)
   where app_publication_privacy.is_text_field(p_kind,value.key) and value.val<>'';
  elsif not exists(select 1 from app_publication_privacy.location_withdrawals
    where kind=p_kind and publication_id=p_publication and scope=p_scope) then
   field_name:=split_part(p_scope,':',2);
   original:=fields->>field_name;
   start_at:=split_part(p_scope,':',4)::integer;
   end_at:=split_part(p_scope,':',5)::integer;
   if original is null or encode(sha256(convert_to(original,'UTF8')),'hex')<>split_part(p_scope,':',3) then
    raise exception using errcode='PDW03',message='Publication text changed';
   end if;
   if end_at<=start_at or end_at>char_length(original) then
    raise exception using errcode='PDW02',message='Invalid publication text range';
   end if;
  end if;
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
 if p_scope='texts' then return jsonb_build_object('texts',texts);end if;
 return jsonb_build_object('withdrawnAt',to_char(receipt at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
revoke all on function app_publication_privacy.withdraw_location(text,uuid,text,uuid,boolean,text) from public;
revoke all on function app_publication_privacy.is_text_field(text,text) from public;
revoke all on function app_publication_privacy.public_text(text,uuid,text,text) from public;
grant usage on schema app_publication_privacy to blizhniy_runtime;
grant select(kind,publication_id,scope) on app_publication_privacy.location_withdrawals to blizhniy_runtime;
grant execute on function app_publication_privacy.withdraw_location(text,uuid,text,uuid,boolean,text) to blizhniy_runtime;
grant execute on function app_publication_privacy.public_text(text,uuid,text,text) to blizhniy_runtime;
commit;
