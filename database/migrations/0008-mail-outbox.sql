-- Additive storage foundation only; not yet in the production bootstrap manifest.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.mail_outbox (
  id uuid primary key,
  user_id uuid not null references app.users(id) on delete cascade,
  purpose text not null check (purpose in ('confirm','recover','reset_notice')),
  key_id text not null check (key_id ~ '^[a-f0-9]{32}$'),
  payload bytea not null check (octet_length(payload) between 30 and 2048 and get_byte(payload,0)=1),
  -- pg Date decoding loses microseconds; both authenticated timestamps have millisecond precision.
  created_at timestamptz(3) not null,
  expires_at timestamptz(3) not null,
  check (expires_at > created_at and expires_at <= created_at + case purpose
    when 'confirm' then interval '1 hour' when 'recover' then interval '30 minutes' else interval '24 hours' end)
);
create index mail_outbox_user_idx on app.mail_outbox(user_id);
create index mail_outbox_expiry_idx on app.mail_outbox(expires_at,id);
revoke all on app.mail_outbox from public;
commit;
