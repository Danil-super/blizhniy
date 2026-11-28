begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create table app_publication_privacy.publication_consents(
 id bigint generated always as identity primary key,
 kind text not null check(kind in ('listing','vacancy','workRequest','specialist','fair')),
 publication_id uuid not null,
 category text not null check(category='location' or kind='listing' and category in ('phone','messenger')
  or category='name' and kind in ('listing','specialist') or category='avatar' and kind='specialist'),
 subject_id uuid not null references app.users(id) on delete cascade,
 subject_name text not null,
 subject_email text not null,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 offer text not null check(offer ~ '^[a-f0-9]{64}$'),
 notice jsonb not null,
 value jsonb not null,
 retired boolean not null default false,
 accepted_at timestamptz not null check(isfinite(accepted_at)),
 expires_at timestamptz not null check(isfinite(expires_at) and expires_at>accepted_at)
);
create index publication_consents_publication_idx on app_publication_privacy.publication_consents(kind,publication_id,category,id desc);
create index publication_consents_subject_idx on app_publication_privacy.publication_consents(subject_id);
revoke all on app_publication_privacy.publication_consents from public,blizhniy_runtime;

create function app_publication_privacy.location_facts(p_city text,p_address text,p_lat jsonb,p_lng jsonb,p_exact boolean)
 returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case when p_exact and p_city<>'' and jsonb_typeof(p_lat)='number' and jsonb_typeof(p_lng)='number'
  then case when p_lat::numeric between -90 and 90 and p_lng::numeric between -180 and 180
   then jsonb_build_object('city',p_city,'address',p_address,'latitude',trim_scale(p_lat::numeric),'longitude',trim_scale(p_lng::numeric))
  end end
 $$;

create function app_publication_privacy.publication_consent_notice(p_kind text,p_publication uuid,p_category text)
 returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object(
  'version',p_category||'-2026-11-draft-v1',
  'operator','ООО «БЛИЖНИЙ», ИНН 2370010092, ОГРН 1202300009746, 353584, Краснодарский край, Славянский район, п. Целинный, ул. Зеленая, д. 24, оф. 6',
  'purpose','Показ '||case p_category when 'phone' then 'номера телефона' when 'messenger' then 'ссылки на мессенджер'
   when 'name' then 'имени из профиля' when 'avatar' then 'фото профиля'
   else 'точного адреса и координат' end||' этой публикации всем посетителям БЛИЖНЕГО, в том числе без входа в аккаунт.',
  'resource','https://xn----9sbphbgks4a4a.xn--p1ai'||case p_kind
   when 'listing' then '/obyavlenie/'||p_publication::text
   when 'vacancy' then '/vakansiya/'||p_publication::text
   when 'workRequest' then '/rabota/zakazy/'||p_publication::text
   when 'specialist' then '/specialist/'||p_publication::text
   when 'fair' then '/yarmarka-masterov' end,
  'term','90 суток с момента подтверждения. Согласие можно отозвать раньше в кабинете или через поддержку.',
  'statement',case p_category when 'phone' then 'Разрешаю оператору публиковать указанный номер телефона в этом объявлении.'
   when 'messenger' then 'Разрешаю оператору публиковать указанную ссылку на мессенджер в этом объявлении.'
   when 'name' then 'Разрешаю оператору публиковать указанное имя в этой публикации.'
   when 'avatar' then 'Разрешаю оператору публиковать показанное фото профиля в этой анкете.'
   else 'Разрешаю оператору публиковать указанные ниже точный адрес и координаты этой публикации.' end)
 $$;

-- Store a fingerprint of the photo rather than a copy of the image in the consent record.
create function app_publication_privacy.avatar_facts(p_value text)
 returns jsonb language sql immutable strict set search_path=pg_catalog,pg_temp as $$
 select case when char_length(p_value) between 1 and 409623
    and p_value ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'
  then to_jsonb(encode(sha256(convert_to(p_value,'UTF8')),'hex')) end
 $$;

create function app_publication_privacy.publication_consent_fingerprint(p_notice jsonb,p_facts jsonb)
 returns text language sql immutable strict set search_path=pg_catalog,pg_temp as $$
 select encode(sha256(convert_to(jsonb_build_array(p_notice,p_facts)::text,'UTF8')),'hex')
 $$;

-- Expose only the current decision. A superseded receipt never authorizes a publication.
create function app_publication_privacy.publication_is_consented(p_kind text,p_publication uuid,p_subject uuid,p_category text,p_facts jsonb)
 returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce((
  select c.subject_id=p_subject and not c.retired and c.expires_at>statement_timestamp()
   and c.fingerprint=app_publication_privacy.publication_consent_fingerprint(
   app_publication_privacy.publication_consent_notice(p_kind,p_publication,p_category),p_facts)
  from app_publication_privacy.publication_consents c
  where c.kind=p_kind and c.publication_id=p_publication and c.category=p_category order by c.id desc limit 1
 ),false)
 $$;

create function app_publication_privacy.location_is_consented(p_kind text,p_publication uuid,p_subject uuid,p_facts jsonb)
 returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
 select app_publication_privacy.publication_is_consented(p_kind,p_publication,p_subject,'location',p_facts)
 $$;

create function app_publication_privacy.publication_consent(
 p_hash text,p_actor uuid,p_kind text,p_publication uuid,p_category text,p_expected text,p_name text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 decision jsonb;
 facts jsonb;
 form jsonb;
 notice jsonb;
 current_fingerprint text;
 current_offer text;
 last_offer text;
 last_id bigint;
 email text;
 deadline timestamptz;
 confirmed_at timestamptz;
 field_name text;
 profile_value text;
begin
 if p_category is null or not (p_category='location' or p_kind='listing' and p_category in ('phone','messenger')
  or p_category='name' and p_kind in ('listing','specialist') or p_category='avatar' and p_kind='specialist') then
  raise exception using errcode='PDW04',message='Invalid consent category';
 end if;
 if (p_expected is null)<>(p_name is null) or p_expected is not null and (
  octet_length(p_expected)<>64 or p_expected !~ '^[a-f0-9]+$'
  or char_length(p_name) not between 2 and 160 or p_name<>btrim(p_name) or p_name ~ '[[:cntrl:]]'
  or p_name !~ '[[:alpha:]]'
 ) then raise exception using errcode='PDW04',message='Invalid location consent';end if;

 -- The existing command checks the verified owner and locks the session and publication.
 field_name:=case when p_category='location' then 'location' when p_category in ('name','avatar') then 'profileValue' else 'contact' end;
 decision:=app_publication_privacy.withdraw_location(p_hash,p_actor,p_kind,p_publication,false,p_category);
 if decision->>'withdrawnAt' is not null or exists(
  select 1 from app_publication_privacy.location_withdrawals where kind=p_kind and publication_id=p_publication and scope='publication'
 ) then
  if p_expected is not null then raise exception using errcode='PDW05',message='Location unavailable';end if;
  if field_name<>'location' then
   return jsonb_build_object(field_name,null,'withdrawnAt',decision->>'withdrawnAt');
  end if;
  return jsonb_build_object('location',null);
 end if;

 case
  when p_category in ('name','avatar') then
   select nullif(profile->>case p_category when 'name' then 'name' else 'avatarDataUrl' end,'')
   into profile_value from app.cabinet_profiles where user_id=p_actor for share;
   facts:=case when p_category='avatar' then app_publication_privacy.avatar_facts(profile_value) else to_jsonb(profile_value) end;
  when p_category in ('phone','messenger') then
   select to_jsonb(nullif(case p_category when 'phone' then l.contact_phone else l.messenger_url end,''))
   into facts from app.listings l where l.id=p_publication;
  when p_kind='listing' then
   select app_publication_privacy.location_facts(city.name,l.address,to_jsonb(l.latitude::float8),to_jsonb(l.longitude::float8),l.show_exact_address)
   into facts from app.listings l join app.cities city on city.id=l.city_id where l.id=p_publication;
  when p_kind in ('vacancy','workRequest') then select w.form into form from app.work_publications w where w.id=p_publication;
  else select s.form into form from app.service_publications s where s.id=p_publication;
 end case;
 if p_category='location' and p_kind<>'listing' then
  facts:=app_publication_privacy.location_facts(form->>'cityName',form->>'address',form->'latitude',form->'longitude',
   form->'showExactAddress'='true'::jsonb);
 end if;
 if facts is null then
  if p_expected is not null then raise exception using errcode='PDW05',message='Location unavailable';end if;
  return jsonb_build_object(field_name,null);
 end if;

 notice:=app_publication_privacy.publication_consent_notice(p_kind,p_publication,p_category);
 current_fingerprint:=app_publication_privacy.publication_consent_fingerprint(notice,facts);
 select u.email into email from app.users u where u.id=p_actor;
 confirmed_at:=clock_timestamp();
 select c.id,c.offer,
  case when not c.retired and c.fingerprint=current_fingerprint and c.subject_id=p_actor and c.expires_at>confirmed_at then c.expires_at end
 into last_id,last_offer,deadline from app_publication_privacy.publication_consents c
 where c.kind=p_kind and c.publication_id=p_publication and c.category=p_category order by c.id desc limit 1;
 current_offer:=encode(sha256(convert_to(jsonb_build_array(p_hash,current_fingerprint,last_id)::text,'UTF8')),'hex');
 if p_expected is not null then
  if p_expected<>current_offer and (deadline is null or p_expected is distinct from last_offer) then
   raise exception using errcode='PDW05',message='Location changed';
  end if;
  if deadline is null then
   deadline:=confirmed_at+interval '2160 hours';
   insert into app_publication_privacy.publication_consents(kind,publication_id,category,subject_id,subject_name,subject_email,fingerprint,offer,notice,value,accepted_at,expires_at)
    values(p_kind,p_publication,p_category,p_actor,p_name,email,current_fingerprint,current_offer,notice,facts,confirmed_at,deadline);
   last_offer:=current_offer;
  end if;
 end if;
 if not exists(select 1 from app.sessions where token_hash=p_hash and user_id=p_actor
   and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes') then
  raise exception using errcode='PDW01',message='Publication owner required';
 end if;
 return jsonb_build_object(field_name,case when p_category='avatar' then to_jsonb(profile_value) else facts end,
  'notice',notice,'email',email,'fingerprint',case when deadline is null then current_offer else last_offer end,
  'expiresAt',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;

revoke all on function app_publication_privacy.location_facts(text,text,jsonb,jsonb,boolean) from public;
revoke all on function app_publication_privacy.avatar_facts(text) from public;
revoke all on function app_publication_privacy.publication_consent_notice(text,uuid,text) from public;
revoke all on function app_publication_privacy.publication_consent_fingerprint(jsonb,jsonb) from public;
revoke all on function app_publication_privacy.location_is_consented(text,uuid,uuid,jsonb) from public;
revoke all on function app_publication_privacy.publication_is_consented(text,uuid,uuid,text,jsonb) from public;
revoke all on function app_publication_privacy.publication_consent(text,uuid,text,uuid,text,text,text) from public;
grant execute on function app_publication_privacy.location_facts(text,text,jsonb,jsonb,boolean) to blizhniy_runtime;
grant execute on function app_publication_privacy.avatar_facts(text) to blizhniy_runtime;
grant execute on function app_publication_privacy.location_is_consented(text,uuid,uuid,jsonb) to blizhniy_runtime;
grant execute on function app_publication_privacy.publication_is_consented(text,uuid,uuid,text,jsonb) to blizhniy_runtime;
grant execute on function app_publication_privacy.publication_consent(text,uuid,text,uuid,text,text,text) to blizhniy_runtime;
commit;
