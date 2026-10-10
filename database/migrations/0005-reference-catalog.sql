-- Reference data only: no demo accounts, publications, media or payments.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create table app.regions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 150),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 200)
);
create table app.cities (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  region_id uuid not null references app.regions(id),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 150),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 200)
);
create index cities_region_id_idx on app.cities(region_id);
create table app.categories (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  parent_id uuid references app.categories(id),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 150),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 200),
  sort_order integer not null default 0 check (sort_order between 0 and 1000000),
  active boolean not null default true,
  check (parent_id <> id)
);
create index categories_parent_sort_idx on app.categories(parent_id, sort_order, id);
create table app.specialist_categories (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 150),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 200),
  parent_name text not null check (parent_name=btrim(parent_name) and char_length(parent_name) between 1 and 200),
  active boolean not null default true
);
create table app.tariffs (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 100),
  action text not null unique check (action in ('listing_publication', 'vacancy_publication',
    'work_request_publication', 'specialist_publication', 'ad_marquee', 'job_response', 'fair_participation')),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 200),
  price numeric(12,2) not null check (price >= 0 and price <> 'NaN'::numeric),
  duration_days integer check (duration_days between 1 and 3650),
  active boolean not null default true
);
revoke all on app.regions, app.cities, app.categories, app.specialist_categories, app.tariffs from public;
commit;
