-- Candidate only. The issuer's database access remains separate from the enrollment handler.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create table app_admin_passkey.enrollments (
  admin_id uuid primary key references app.users(id) on delete cascade,
  auth_version bigint not null check (auth_version >= 0),
  origin text not null check (length(origin) between 9 and 512),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  mode text not null check (mode in ('add', 'replace')),
  expires_at timestamptz not null check (isfinite(expires_at)),
  session_hash text references app.sessions(token_hash) on delete cascade,
  user_handle text check (user_handle ~ '^[A-Za-z0-9_-]{1,86}$'),
  challenge text unique check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  challenge_expires_at timestamptz check (challenge_expires_at <= expires_at),
  check (num_nonnulls(session_hash, user_handle, challenge, challenge_expires_at) in (0, 4))
);
revoke all on app_admin_passkey.enrollments from public;

commit;
