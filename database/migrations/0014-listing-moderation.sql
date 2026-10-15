-- Revision-bound review history only. No publication/payment writes or implicit grants.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.listing_moderation (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  listing_id uuid not null references app.listings(id) on delete cascade,
  revision bigint not null check (revision>=1),
  state text not null default 'pending' check (state in ('pending','approved','rejected')),
  submitted_at timestamptz not null default clock_timestamp() check (isfinite(submitted_at)),
  decided_at timestamptz check (isfinite(decided_at) and decided_at>=submitted_at),
  -- Keep the decision if the reviewer's account is later erased, not their identity.
  decided_by uuid references app.users(id) on delete set null,
  decision_note text check (decision_note=btrim(decision_note) and char_length(decision_note) between 1 and 1000),
  unique(listing_id,revision),
  constraint listing_moderation_decision check (
    (state='pending' and decided_at is null and decided_by is null and decision_note is null) or
    (state='approved' and decided_at is not null and decision_note is null) or
    (state='rejected' and decided_at is not null and decision_note is not null)
  )
);
create index listing_moderation_pending_idx on app.listing_moderation(submitted_at,id) where state='pending';
create index listing_moderation_reviewer_idx on app.listing_moderation(decided_by);
revoke all on app.listing_moderation from public;
commit;
