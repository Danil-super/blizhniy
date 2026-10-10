-- One-shot local write journal, not an expiring lease or proof a writer has stopped.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.media_write_attempts (
  id uuid primary key default pg_catalog.gen_random_uuid() check(id::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  media_id uuid not null unique references app.media_objects(id) on delete restrict,
  claimed_at timestamptz not null default clock_timestamp()
);
-- The UNIQUE index also covers the FK. No owner/path/marker duplication.
revoke all on app.media_write_attempts from public;
create function app.guard_media_write_attempt() returns trigger
language plpgsql set search_path = pg_catalog,pg_temp as $$
declare media_state text;
begin
  if tg_op<>'INSERT' then
    raise exception 'Media write attempt is immutable; cleanup proof required' using errcode='BL003';
  end if;
  select state into media_state from app.media_objects where id=new.media_id for update;
  if media_state is distinct from 'pending' then
    raise exception 'Media write requires a pending reservation' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_media_write_attempt() from public;
create trigger media_write_attempt_guard before insert or update or delete on app.media_write_attempts
for each row execute function app.guard_media_write_attempt();
commit;
