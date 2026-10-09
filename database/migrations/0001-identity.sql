-- Additive plain PostgreSQL identity schema. Apply once with migration credentials.
-- No production installer or automatic application at server startup.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create schema app;
revoke all on schema app from public;

create table app.users (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email text not null unique check (
    char_length(email) between 3 and 254 and email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  password_hash text not null check (
    password_hash ~ '^scrypt[$]131072[$]8[$]1[$][a-f0-9]{32}[$][a-f0-9]{128}$'
  ),
  role text not null default 'user' check (role in ('user', 'admin')),
  is_blocked boolean not null default false,
  email_verified_at timestamptz,
  auth_version bigint not null default 0 check (auth_version >= 0),
  created_at timestamptz not null default now()
);

create table app.sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references app.users(id) on delete cascade,
  auth_version bigint not null check (auth_version >= 0),
  scope text not null default 'app' check (scope in ('app', 'data-subject')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '8 hours',
  last_seen_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '8 hours'),
  check (last_seen_at >= created_at and last_seen_at <= expires_at)
);
create index sessions_user_id_idx on app.sessions(user_id);
create index sessions_expires_at_idx on app.sessions(expires_at);

-- Credentials cannot silently revive old sessions, including through direct SQL.
create function app.guard_auth_version() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.auth_version < old.auth_version then
    raise exception 'Auth version must not decrease' using errcode = '23514';
  end if;
  if new.password_hash is distinct from old.password_hash
     or new.email is distinct from old.email
     or (old.email_verified_at is not null and new.email_verified_at is null) then
    new.auth_version := greatest(new.auth_version, old.auth_version + 1);
  end if;
  return new;
end;
$$;
revoke all on function app.guard_auth_version() from public;
create trigger users_guard_auth_version before update on app.users
for each row execute function app.guard_auth_version();

revoke all on app.users, app.sessions from public;
commit;
