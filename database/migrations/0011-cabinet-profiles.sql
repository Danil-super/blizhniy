-- Private profile data in the Russian PostgreSQL contour; no legacy import.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create table app.cabinet_profiles (
  user_id uuid primary key references app.users(id) on delete cascade,
  profile jsonb not null check (
    jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 500000
    and not (profile ?| array['email','phoneVerified','verifiedPhone','user_id','userId','role','isBlocked'])
  ),
  updated_at timestamptz not null default clock_timestamp()
);
revoke all on app.cabinet_profiles from public;
commit;
