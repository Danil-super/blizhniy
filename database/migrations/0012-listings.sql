-- Additive storage only. No import, runtime grants, public view or application cutover.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create table app.listings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  author_id uuid not null references app.users(id) on delete cascade,
  listing_type text not null check (listing_type in ('sell','buy','free','rent')),
  category_id uuid references app.categories(id),
  city_id uuid references app.cities(id),
  title text not null default '' check (title=btrim(title) and char_length(title)<=160),
  description text not null default '' check (char_length(description)<=10000),
  price numeric(12,2) check (price>=0 and price<>'NaN'::numeric),
  district text check (district=btrim(district) and char_length(district)<=160),
  address text check (address=btrim(address) and char_length(address)<=300),
  latitude numeric check (latitude between -90 and 90),
  longitude numeric check (longitude between -180 and 180),
  show_exact_address boolean not null default false,
  contact_phone text check (contact_phone=btrim(contact_phone) and char_length(contact_phone)<=40),
  messenger_url text check (messenger_url=btrim(messenger_url) and char_length(messenger_url)<=500),
  booking jsonb check (jsonb_typeof(booking)='object' and octet_length(booking::text)<=20000),
  status text not null default 'draft' check (status in
    ('draft','pending_payment','paid','published','sold','archived','expired','rejected')),
  is_paid boolean not null default false,
  view_count integer not null default 0 check (view_count>=0),
  revision bigint not null default 1 check (revision>=1),
  created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
  updated_at timestamptz not null default clock_timestamp() check (isfinite(updated_at)),
  published_at timestamptz check (isfinite(published_at)),
  expires_at timestamptz check (isfinite(expires_at)),
  constraint listings_coordinates_pair check ((latitude is null)=(longitude is null)),
  constraint listings_exact_location check (not show_exact_address or latitude is not null),
  constraint listings_publication_dates check (
    (published_at is null)=(expires_at is null) and
    (published_at is null or expires_at>published_at)
  ),
  constraint listings_published_complete check (status<>'published' or (
    is_paid and published_at is not null and category_id is not null and city_id is not null
    and char_length(title)>0 and char_length(btrim(description))>0
  )),
  constraint listings_unpaid_draft check (
    status not in ('draft','pending_payment') or (not is_paid and published_at is null)
  )
);

-- Owner pagination and FK operations have bounded/indexed lookup paths.
create index listings_author_updated_idx on app.listings(author_id,updated_at desc,id desc);
create index listings_category_idx on app.listings(category_id);
create index listings_city_idx on app.listings(city_id);
create index listings_public_created_idx on app.listings(created_at desc,id desc) where status='published';
revoke all on app.listings from public;
commit;
