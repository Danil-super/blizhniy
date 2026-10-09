-- Additive registration records, independent of Supabase. Apply after 0001.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

-- Acceptance of the agreement and review of the privacy notice are distinct events.
-- They are not a blanket consent for marketing or third-party data sharing.
create table app.registration_legal (
  user_id uuid not null references app.users(id) on delete cascade,
  document text not null check (document in ('agreement', 'privacy')),
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  recorded_at timestamptz not null default now(),
  primary key (user_id, document)
);

create table app.email_confirmations (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null unique references app.users(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254 and email=lower(btrim(email))),
  auth_version bigint not null check (auth_version >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
create index email_confirmations_expires_at_idx on app.email_confirmations(expires_at);

revoke all on app.registration_legal, app.email_confirmations from public;
commit;
