begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

create schema app_publication_restriction;
revoke all on schema app_publication_restriction from public;

-- Keep moderation decisions independent of the paid publication window and financial schema.
create table app_publication_restriction.restrictions (
 kind text not null check (kind in ('vacancy','workRequest','specialist','fair','marquee')),
 publication_id uuid not null,
 restricted_revision bigint not null check (restricted_revision > 0),
 case_id uuid not null unique,
 restricted_at timestamptz not null default clock_timestamp() check (isfinite(restricted_at)),
 primary key (kind,publication_id)
);
revoke all on app_publication_restriction.restrictions from public;
grant usage on schema app_publication_restriction to blizhniy_runtime;
grant select(kind,publication_id) on app_publication_restriction.restrictions to blizhniy_runtime;
commit;
