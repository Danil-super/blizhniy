-- Additive phone attestations in the existing Russian PostgreSQL contour.
-- No automatic activation, legacy import, provider request or production grants.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
create table app.phone_verification_policy (
 singleton boolean primary key default true check(singleton),
 available boolean not null default false,
 required boolean not null default false check(not required or available)
);
insert into app.phone_verification_policy(singleton) values(true);
create table app.telegram_phone_bindings (
 user_id uuid primary key references app.users(id) on delete cascade,
 phone text not null unique check(phone ~ '^\+[1-9][0-9]{6,14}$'),
 telegram_subject text not null unique check(char_length(telegram_subject) between 1 and 128 and telegram_subject !~ '[[:space:][:cntrl:]]'),
 source text not null default 'telegram' check(source='telegram'),
 confirmed_at timestamptz not null default clock_timestamp() check(isfinite(confirmed_at))
);
create table app.telegram_phone_attempts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references app.users(id) on delete cascade,
 session_hash text not null references app.sessions(token_hash) on delete cascade,
 state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'),
 client_id text not null check(client_id ~ '^[1-9][0-9]{4,19}$'),
 nonce text not null check(nonce ~ '^[a-f0-9]{64}$'),
 verifier text not null check(verifier ~ '^[A-Za-z0-9_-]{43,128}$'),
 return_path text not null check(char_length(return_path)<=2048 and return_path like '/%' and return_path not like '//%' and position(chr(92) in return_path)=0),
 state text not null default 'pending' check(state in ('pending','exchanging','review','confirmed','failed','cancelled')),
 candidate_phone text check(candidate_phone ~ '^\+[1-9][0-9]{6,14}$'),
 candidate_subject text check(char_length(candidate_subject) between 1 and 128 and candidate_subject !~ '[[:space:][:cntrl:]]'),
 token_hash text unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
 check(isfinite(created_at) and isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '10 minutes 1 second'),
 check((state in ('review','confirmed') and candidate_phone is not null and candidate_subject is not null and token_hash is not null)
  or (state not in ('review','confirmed') and candidate_phone is null and candidate_subject is null and token_hash is null))
);
create index telegram_phone_attempt_owner on app.telegram_phone_attempts(user_id,created_at desc);
create index telegram_phone_attempt_expiry on app.telegram_phone_attempts(expires_at);
create function app.normalize_profile_phone(value text) returns text language sql immutable set search_path=pg_catalog as $$
 with input as(select regexp_replace(value,'[^0-9]','','g') as digits), canonical as(
 select case when left(value,1)<>'+' and length(digits)=10 then '7'||digits
  when left(value,1)<>'+' and length(digits)=11 and left(digits,1)='8' then '7'||substr(digits,2) else digits end as digits from input)
 select case when value ~ '^[+0-9 ().-]{1,40}$' and value !~ '.+[+]' and (left(value,1)='+' or length(regexp_replace(value,'[^0-9]','','g'))=10 or regexp_replace(value,'[^0-9]','','g') ~ '^[78][0-9]{10}$') and digits ~ '^[1-9][0-9]{6,14}$' then '+'||digits else null end from canonical
$$;
create function app.phone_is_confirmed(owner_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app.telegram_phone_bindings b join app.cabinet_profiles p on p.user_id=b.user_id
  join app.users u on u.id=b.user_id where b.user_id=owner_id and not u.is_blocked and u.email_verified_at is not null
   and b.phone=app.normalize_profile_phone(p.profile->>'phone'))
$$;
create function app.guard_phone_publication() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if new.status='published' and (tg_op='INSERT' or old.status is distinct from new.status)
   and (select required from app.phone_verification_policy where singleton) then
   perform 1 from app.users where id=new.author_id for update;
   if not app.phone_is_confirmed(new.author_id) then
    raise exception using errcode='P7601',message='Phone confirmation required';
   end if;
  end if;
  return new;
 end $$;
create trigger listing_phone_publication before insert or update on app.listings for each row execute function app.guard_phone_publication();
create trigger work_phone_publication before insert or update on app.work_publications for each row execute function app.guard_phone_publication();
create trigger service_phone_publication before insert or update on app.service_publications for each row execute function app.guard_phone_publication();
create function app.guard_phone_checkout() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 begin
  if new.target_type<>'application' and (select required from app.phone_verification_policy where singleton) then
   perform 1 from app.users where id=new.owner_id for update;
   if not app.phone_is_confirmed(new.owner_id) then raise exception using errcode='P7601',message='Phone confirmation required';end if;
  end if;
  return new;
 end $$;
create trigger checkout_phone_required before insert on app.payment_checkout_intents for each row execute function app.guard_phone_checkout();
revoke all on function app.guard_phone_checkout() from public;
create function app.guard_profile_phone() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
 begin
  perform 1 from app.users where id=new.user_id for update;
  if coalesce(new.profile->>'phone','')='' then delete from app.telegram_phone_bindings where user_id=new.user_id; end if;
  return new;
 end $$;
create trigger cabinet_profile_phone before insert or update on app.cabinet_profiles for each row execute function app.guard_profile_phone();
create function app.guard_phone_attempt() returns trigger language plpgsql set search_path=pg_catalog as $$
 begin
  if tg_op='INSERT' then
   if new.state<>'pending' or not exists(select 1 from app.sessions where token_hash=new.session_hash and user_id=new.user_id
     and scope='app' and expires_at>clock_timestamp()) then raise exception using errcode='23514',message='Invalid phone attempt';end if;
  elsif new.id<>old.id or new.user_id<>old.user_id or new.session_hash<>old.session_hash or new.state_hash<>old.state_hash
   or new.nonce<>old.nonce or new.verifier<>old.verifier or new.client_id<>old.client_id or new.return_path<>old.return_path
   or new.created_at<>old.created_at or new.expires_at<>old.expires_at
   or not ((old.state='pending' and new.state in ('exchanging','cancelled','failed'))
    or (old.state='exchanging' and new.state in ('review','failed','cancelled'))
    or (old.state='review' and new.state in ('confirmed','cancelled'))) then
   raise exception using errcode='23514',message='Invalid phone attempt transition';
  end if;
  return new;
 end $$;
create trigger telegram_attempt_guard before insert or update on app.telegram_phone_attempts for each row execute function app.guard_phone_attempt();
alter table app.telegram_phone_bindings enable row level security;
alter table app.telegram_phone_attempts enable row level security;
revoke all on app.phone_verification_policy,app.telegram_phone_bindings,app.telegram_phone_attempts from public;
revoke all on function app.normalize_profile_phone(text),app.phone_is_confirmed(uuid),app.guard_phone_publication(),app.guard_profile_phone(),app.guard_phone_attempt() from public;
commit;
