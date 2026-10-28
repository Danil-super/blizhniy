-- Opt-in postpublication control. Local rollout only; no automatic grants or financial writes.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
create table app.listing_blocks (
 listing_id uuid primary key references app.listings(id) on delete cascade,
 blocked_by uuid references app.users(id) on delete set null,
 blocked_revision bigint not null check (blocked_revision>=1),
 reason text not null check (reason=btrim(reason) and char_length(reason) between 1 and 1000 and reason !~ '[[:cntrl:]]'),
 blocked_at timestamptz not null default clock_timestamp() check (isfinite(blocked_at))
);
create index listing_blocks_actor_idx on app.listing_blocks(blocked_by);
-- Captured local notices, never an SMTP dispatch queue. FK deletion erases personal content.
create table app.listing_block_mail (
 listing_id uuid primary key references app.listing_blocks(listing_id) on delete cascade,
 user_id uuid not null references app.users(id) on delete cascade,
 subject text not null check (subject='Объявление заблокировано'),
 body text not null check (char_length(body) between 1 and 1400),
 created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
 expires_at timestamptz not null default (clock_timestamp()+interval '30 days') check (isfinite(expires_at) and expires_at>created_at)
);
create index listing_block_mail_owner_idx on app.listing_block_mail(user_id,created_at desc);
create index listing_block_mail_expiry_idx on app.listing_block_mail(expires_at);
revoke all on app.listing_blocks,app.listing_block_mail from public;
commit;
