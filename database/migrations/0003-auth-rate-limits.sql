begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
-- Shared counters contain only HMAC keys, never plaintext IP/email/token/password.
create table app.auth_rate_limits (
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check (attempts between 1 and 61),
  primary key (key_hash, window_start)
);
create index auth_rate_limits_window_start_idx on app.auth_rate_limits(window_start);
revoke all on app.auth_rate_limits from public;
commit;
