-- Candidate only. Enrollment, role grants and production entry points are separate.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create schema app_admin_passkey;
revoke all on schema app_admin_passkey from public;

create table app_admin_passkey.credentials (
  id text primary key check (length(id) between 1 and 1364 and id ~ '^[A-Za-z0-9_-]+$'),
  admin_id uuid not null references app.users(id) on delete cascade,
  user_handle text not null check (user_handle ~ '^[A-Za-z0-9_-]{1,86}$'),
  public_key bytea not null check (octet_length(public_key) between 1 and 4096),
  counter bigint not null check (counter between 0 and 4294967295),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= created_at)
);
create index admin_passkey_credentials_admin_idx on app_admin_passkey.credentials(admin_id);

create table app_admin_passkey.challenges (
  session_hash text primary key references app.sessions(token_hash) on delete cascade,
  auth_version bigint not null check (auth_version >= 0),
  kind text not null check (kind in ('archive', 'user-access', 'refund')),
  command_digest text not null check (command_digest ~ '^[a-f0-9]{64}$'),
  credential_ids text[] not null check (cardinality(credential_ids) between 1 and 16),
  challenge text not null unique check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz not null
);
revoke all on all tables in schema app_admin_passkey from public;

commit;
