-- Additive plain PostgreSQL recovery, after 0001/0002. Never run automatically at startup.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create table app.password_recoveries (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null unique references app.users(id) on delete cascade,
  email text not null check (
    char_length(email) between 3 and 254 and email=lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  auth_version bigint not null check (auth_version >= 0),
  -- statement_timestamp is consistent across defaults and starts after the user lock.
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '30 minutes',
  check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
);
create index password_recoveries_expires_at_idx on app.password_recoveries(expires_at);
revoke all on app.password_recoveries from public;
commit;
