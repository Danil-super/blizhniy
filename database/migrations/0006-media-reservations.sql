-- Additive metadata only. No files, automatic installer, expiry release or runtime grants.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create table app.media_storage_budget (
  singleton boolean primary key default true check(singleton),
  byte_limit bigint not null default 5000000000 check(byte_limit between 1 and 5000000000),
  object_limit integer not null default 10000 check(object_limit between 1 and 10000),
  charged_bytes bigint not null default 0 check(charged_bytes between 0 and byte_limit),
  charged_objects integer not null default 0 check(charged_objects between 0 and object_limit)
);
insert into app.media_storage_budget(singleton) values(true);

create table app.media_objects (
  id uuid primary key default pg_catalog.gen_random_uuid() check(id::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  owner_id uuid not null references app.users(id) on delete restrict,
  intent_id uuid not null check(intent_id::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  mime_type text not null check(mime_type='image/webp'),
  width integer not null check(width between 1 and 2048),
  height integer not null check(height between 1 and 2048),
  size integer not null check(size between 12 and 2097152),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check(state in ('pending','ready')),
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  unique(owner_id,intent_id),
  check((state='pending' and ready_at is null) or (state='ready' and ready_at is not null and ready_at>=created_at))
);
-- owner_id is the leading column of the unique index, including for the RESTRICT FK.
revoke all on app.media_storage_budget,app.media_objects from public;

create function app.guard_media_record() returns trigger
language plpgsql set search_path = pg_catalog,pg_temp as $$
begin
  if tg_op='DELETE' then
    raise exception 'Media cleanup proof required' using errcode='BL003';
  elsif tg_op='INSERT' then
    if new.state<>'pending' or new.ready_at is not null then
      raise exception 'Media must start pending' using errcode='23514';
    end if;
  else
    if row(new.id,new.owner_id,new.intent_id,new.mime_type,new.width,new.height,new.size,new.sha256,new.created_at)
       is distinct from row(old.id,old.owner_id,old.intent_id,old.mime_type,old.width,old.height,old.size,old.sha256,old.created_at)
       or (old.state='ready' and (new.state<>'ready' or new.ready_at is distinct from old.ready_at)) then
      raise exception 'Media identity and metadata are immutable' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_media_record() from public;
create trigger media_record_guard before insert or update or delete on app.media_objects
for each row execute function app.guard_media_record();

-- Runtime may insert a reservation but must not get direct budget UPDATE authority.
-- AFTER INSERT is essential: BEFORE INSERT would charge rows skipped by ON CONFLICT.
create function app.charge_media_reservation() returns trigger
language plpgsql security definer set search_path = pg_catalog,pg_temp as $$
begin
  update app.media_storage_budget set charged_bytes=charged_bytes+new.size,charged_objects=charged_objects+1
    where singleton and charged_bytes<=byte_limit-new.size and charged_objects<object_limit;
  if not found then
    raise exception 'Media storage capacity unavailable' using errcode='BL001';
  end if;
  return null;
end;
$$;
revoke all on function app.charge_media_reservation() from public;
create trigger media_reservation_charge after insert on app.media_objects
for each row execute function app.charge_media_reservation();
commit;
